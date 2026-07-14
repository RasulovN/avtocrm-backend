import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound } from '../../common/errors.js';

// Django: apps/inventory/services/inventory_count_service.py (InventoryResultService)
//         + serializers/inventory_count_serializer.py (InventoryCountSerializer)
//
// Ko'p chiqqan (status='m') va kam chiqqan (status='l') mahsulotlar ro'yxati.
//   system_quantity = shu (store, product) bo'yicha aktiv ProductBatch qoldiqlari Sum
//   diff            = counted_quantity - system_quantity

const COUNT_STATUS_MORE = 'm';
const COUNT_STATUS_LESS = 'l';
const SESSION_COMPLETED = 'completed';

interface CountRowWithProduct {
  id: number;
  productId: number;
  countedQuantity: number;
  status: string;
  isCheck: boolean;
  createdAt: Date;
  product: {
    name: string;
    category: { name: string } | null;
    unitMeasurement: { measurement: string } | null;
  };
}

function serializeCount(
  c: CountRowWithProduct,
  systemQuantity: number,
) {
  return {
    id: c.id,
    product: c.productId,
    product_name: c.product.name,
    category_name: c.product.category?.name ?? null,
    unit_measurement: c.product.unitMeasurement?.measurement ?? null,
    counted_quantity: c.countedQuantity,
    system_quantity: systemQuantity,
    diff: c.countedQuantity - systemQuantity,
    status: c.status,
    is_check: c.isCheck,
    created_at: c.createdAt,
  };
}

export interface ResultListParams {
  companyId: number;
  sessionId: number;
  search?: string;
  category?: number;
  is_check?: boolean;
  ordering?: string;
  skip: number;
  take: number;
}

// _InventoryResultBaseView: ordering_fields=[diff, counted_quantity, system_quantity, created_at]
// default ordering = ["-diff"]. diff/system_quantity DB'da hisoblanadi (Python'da saralanadi),
// counted_quantity/created_at esa to'g'ridan-to'g'ri ustun.
type SortKey = 'diff' | 'counted_quantity' | 'system_quantity' | 'created_at';
const ALLOWED_SORTS: SortKey[] = ['diff', 'counted_quantity', 'system_quantity', 'created_at'];

async function listResultCounts(status: string, params: ResultListParams) {
  // Django InventoryCountFilter: category -> product.category.id, is_check -> is_check
  const where: Prisma.InventoryCountWhereInput = {
    sessionId: params.sessionId,
    status,
  };
  if (params.category !== undefined) {
    where.product = { categoryId: params.category };
  }
  if (params.is_check !== undefined) {
    where.isCheck = params.is_check;
  }
  if (params.search) {
    // SearchFilter search_fields=["product__name"] (icontains)
    where.product = {
      ...(where.product as Prisma.ProductWhereInput | undefined),
      name: { contains: params.search, mode: 'insensitive' },
    };
  }

  // session -> store_id (system_quantity uchun kerak). Cross-tenant himoya:
  // session shu tenant'ga tegishli bo'lishi shart.
  const session = await prisma.inventorySession.findFirst({
    where: { id: params.sessionId, companyId: params.companyId },
    select: { storeId: true, status: true },
  });
  if (!session) throw new NotFound();
  const storeId = session.storeId;

  // Yakunlangan sessiyada joriy ProductBatch qoldig'i allaqachon inventarizatsiya
  // natijasiga tenglashtirilgan bo'ladi. Tarixiy kamomat/ortiqchani adjustment va
  // sessiya boshidagi snapshotdan olamiz, aks holda diff noto'g'ri 0 chiqadi.
  if (session.status === SESSION_COMPLETED) {
    const productWhere: Prisma.ProductWhereInput = {};
    if (params.category !== undefined) productWhere.categoryId = params.category;
    if (params.search) productWhere.name = { contains: params.search, mode: 'insensitive' };

    const adjustments = await prisma.inventoryAdjustment.findMany({
      where: {
        sessionId: params.sessionId,
        difference: status === COUNT_STATUS_LESS ? { lt: 0 } : { gt: 0 },
        ...(Object.keys(productWhere).length ? { product: productWhere } : {}),
      },
      include: {
        product: {
          select: {
            name: true,
            category: { select: { name: true } },
            unitMeasurement: { select: { measurement: true } },
          },
        },
      },
    });
    const productIds = adjustments.map((item) => item.productId);
    const [snapshots, counts] = await Promise.all([
      prisma.inventorySnapshot.findMany({
        where: { sessionId: params.sessionId, productId: { in: productIds } },
        select: { productId: true, expectedQuantity: true },
      }),
      prisma.inventoryCount.findMany({
        where: { sessionId: params.sessionId, productId: { in: productIds } },
        select: { productId: true, countedQuantity: true, isCheck: true },
      }),
    ]);
    const snapshotMap = new Map(snapshots.map((item) => [item.productId, item.expectedQuantity]));
    const countMap = new Map(counts.map((item) => [item.productId, item]));
    const rows = adjustments.map((item) => ({
      id: item.id,
      product: item.productId,
      product_name: item.product.name,
      category_name: item.product.category?.name ?? null,
      unit_measurement: item.product.unitMeasurement?.measurement ?? null,
      counted_quantity: countMap.get(item.productId)?.countedQuantity ?? 0,
      system_quantity: snapshotMap.get(item.productId) ?? 0,
      diff: item.difference,
      status,
      is_check: countMap.get(item.productId)?.isCheck ?? false,
      created_at: item.createdAt,
    })).filter((item) => params.is_check === undefined || item.is_check === params.is_check);

    const orderingRaw = (params.ordering ?? '-diff').split(',')[0]?.trim() ?? '-diff';
    const desc = orderingRaw.startsWith('-');
    const keyRaw = (desc ? orderingRaw.slice(1) : orderingRaw) as SortKey;
    const key: SortKey = ALLOWED_SORTS.includes(keyRaw) ? keyRaw : 'diff';
    rows.sort((a, b) => {
      const av = a[key] as number | Date;
      const bv = b[key] as number | Date;
      const an = av instanceof Date ? av.getTime() : av;
      const bn = bv instanceof Date ? bv.getTime() : bv;
      return desc ? bn - an : an - bn;
    });
    return { results: rows.slice(params.skip, params.skip + params.take), count: rows.length };
  }

  const counts = await prisma.inventoryCount.findMany({
    where,
    include: {
      product: {
        select: {
          name: true,
          category: { select: { name: true } },
          unitMeasurement: { select: { measurement: true } },
        },
      },
    },
  });

  // system_quantity: aktiv batch qoldiqlari Sum (bitta groupBy query).
  const productIds = counts.map((c) => c.productId);
  const stockRows =
    productIds.length > 0
      ? await prisma.productBatch.groupBy({
          by: ['productId'],
          where: { storeId, productId: { in: productIds }, isActive: true, companyId: params.companyId },
          _sum: { quantity: true },
        })
      : [];
  const stockMap = new Map<number, number>(
    stockRows.map((r) => [r.productId, r._sum.quantity ?? 0]),
  );

  const rows = counts.map((c) => {
    const systemQuantity = stockMap.get(c.productId) ?? 0;
    return serializeCount(c as CountRowWithProduct, systemQuantity);
  });

  // ordering (OrderingFilter). default -diff.
  const orderingRaw = (params.ordering ?? '-diff').split(',')[0]?.trim() ?? '-diff';
  const desc = orderingRaw.startsWith('-');
  const keyRaw = (desc ? orderingRaw.slice(1) : orderingRaw) as SortKey;
  const key: SortKey = ALLOWED_SORTS.includes(keyRaw) ? keyRaw : 'diff';
  rows.sort((a, b) => {
    const av = a[key] as number | Date;
    const bv = b[key] as number | Date;
    const an = av instanceof Date ? av.getTime() : av;
    const bn = bv instanceof Date ? bv.getTime() : bv;
    return desc ? bn - an : an - bn;
  });

  const count = rows.length;
  const paged = rows.slice(params.skip, params.skip + params.take);
  return { results: paged, count };
}

// status='m' (MORE) — counted > system
export function overCounts(params: ResultListParams) {
  return listResultCounts(COUNT_STATUS_MORE, params);
}

// status='l' (LESS) — counted < system
export function shortCounts(params: ResultListParams) {
  return listResultCounts(COUNT_STATUS_LESS, params);
}
