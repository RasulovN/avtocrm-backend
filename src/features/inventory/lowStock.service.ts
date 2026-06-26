import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { emitToUsers } from '../../realtime/io.js';

// Django: apps/inventory/services/low_stock_service.py
//
// ProductBatch quantity <= Product.minStock bo'lganda LowStockItem (status=open)
// yaratadi/RESOLVE qiladi va bir martalik Notification yozadi.
//
//   action_type:
//     store.type == 'b' (BASE)  -> 'purchase'
//     store.type == 's' (STORE) -> 'transfer'
//
//   Lifecycle:
//     OPEN     -> stock <= min_stock
//     RESOLVED -> stock recovered above min_stock
//
//   (store, product) bo'yicha bitta OPEN yozuv — DB darajasidagi partial unique
//   constraint (uniq_open_low_stock_per_store_product) source of truth;
//   application check best-effort.

type Db = PrismaClient | Prisma.TransactionClient;

// store.type konstantalari (schema: 'b'=Base, 's'=Store)
const STORE_TYPE_BASE = 'b';

// LowStockItem.actionType
const ACTION_PURCHASE = 'purchase';
const ACTION_TRANSFER = 'transfer';

// LowStockItem.status
const STATUS_OPEN = 'open';
const STATUS_RESOLVED = 'resolved';

// Notification.type (schema izohi: tc/ta/tr/lp/lt)
const NOTIF_LOW_STOCK_PURCHASE = 'lp';
const NOTIF_LOW_STOCK_TRANSFER = 'lt';

function actionTypeFor(storeType: string): string {
  return storeType === STORE_TYPE_BASE ? ACTION_PURCHASE : ACTION_TRANSFER;
}

function normalizeIds(productIds: Array<number | { id: number }>): number[] {
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (const raw of productIds) {
    const pid = typeof raw === 'object' ? raw.id : raw;
    if (!seen.has(pid)) {
      seen.add(pid);
      ordered.push(pid);
    }
  }
  return ordered;
}

/**
 * Bitta store uchun ko'p mahsulotni baholaydi (evaluate_batch ekvivalenti).
 * Threshold (Product.minStock) ostidagilar uchun OPEN yaratadi, qaytib
 * tiklanganlar uchun OPEN ni RESOLVE qiladi. Notification faqat haqiqatan
 * yaratilgan OPEN yozuvlar uchun bir marta jo'natiladi.
 *
 * `db` — transaction client berilsa o'sha tranzaksiya ichida ishlaydi
 * (chaqiruvchi modul atomicity'ni boshqaradi). Berilmasa global prisma.
 */
export async function evaluateLowStock(params: {
  store: number;
  productIds: Array<number | { id: number }>;
  db?: Db;
}): Promise<Array<{ id: number; productId: number; currentQuantity: number; minStock: number }>> {
  const ids = normalizeIds(params.productIds);
  if (ids.length === 0) return [];

  const client = params.db ?? prisma;

  const storeObj = await client.store.findUnique({ where: { id: params.store } });
  if (!storeObj) return [];

  // companyId ni store'dan ICHKARIDA derive qilamiz — chaqiruvchilar (sales/transfer/
  // contract) imzosini buzmaslik uchun. LowStockItem va Notification (ikkalasida ham
  // companyId BOR) shu qiymat bilan yoziladi/filtrlanadi.
  const companyId = storeObj.companyId;

  // 1 query: (store, product) bo'yicha joriy qoldiq + product-level threshold.
  const stockRows = await client.productBatch.groupBy({
    by: ['productId'],
    where: { storeId: storeObj.id, productId: { in: ids }, companyId },
    _sum: { quantity: true },
  });

  // min_stock Product'da — bir query bilan olib map qilamiz (tenant doirasida).
  const products = await client.product.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, minStock: true },
  });
  const minStockMap = new Map<number, number>(products.map((p) => [p.id, p.minStock]));

  const stockMap = new Map<number, number>(
    stockRows.map((r) => [r.productId, r._sum.quantity ?? 0]),
  );

  // 1 query: mavjud OPEN yozuvlar product bo'yicha (tenant doirasida).
  const openItems = await client.lowStockItem.findMany({
    where: { storeId: storeObj.id, productId: { in: ids }, status: STATUS_OPEN, companyId },
  });
  const openMap = new Map<number, (typeof openItems)[number]>(
    openItems.map((it) => [it.productId, it]),
  );

  const actionType = actionTypeFor(storeObj.type);

  const toCreate: Array<{ productId: number; currentQuantity: number; minStock: number }> = [];
  const toResolve: number[] = [];

  for (const productId of ids) {
    if (!stockMap.has(productId)) {
      // Bu mahsulot/store uchun batch yo'q -> kuzatiladigan narsa yo'q.
      continue;
    }
    const threshold = minStockMap.get(productId) ?? 0;
    const quantity = stockMap.get(productId) ?? 0;

    if (threshold === 0) {
      // Monitoring o'chirilgan -> hech narsa qilmaymiz.
      continue;
    }

    const existing = openMap.get(productId);

    if (quantity <= threshold) {
      if (!existing) {
        toCreate.push({ productId, currentQuantity: quantity, minStock: threshold });
      }
    } else if (existing) {
      toResolve.push(existing.id);
    }
  }

  // RESOLVE: tiklanganlarni yopamiz.
  if (toResolve.length > 0) {
    await client.lowStockItem.updateMany({
      where: { id: { in: toResolve } },
      data: { status: STATUS_RESOLVED, resolvedAt: new Date() },
    });
  }

  const created = await persistCreated(client, companyId, storeObj.id, actionType, toCreate);

  // Notification faqat yangi yaratilganlar uchun.
  if (created.length > 0) {
    await dispatchNotifications(client, companyId, storeObj, actionType, created);
  }

  return created;
}

async function persistCreated(
  client: Db,
  companyId: number,
  storeId: number,
  actionType: string,
  toCreate: Array<{ productId: number; currentQuantity: number; minStock: number }>,
): Promise<Array<{ id: number; productId: number; currentQuantity: number; minStock: number }>> {
  const created: Array<{ id: number; productId: number; currentQuantity: number; minStock: number }> = [];
  // Partial unique constraint source of truth: konflikt bo'lsa o'tkazib yuboramiz
  // (concurrent yaratilgan yozuvni qayta-notify qilmaymiz).
  for (const obj of toCreate) {
    try {
      const row = await client.lowStockItem.create({
        data: {
          companyId,
          storeId,
          productId: obj.productId,
          currentQuantity: obj.currentQuantity,
          minStock: obj.minStock,
          actionType,
          status: STATUS_OPEN,
        },
      });
      created.push({
        id: row.id,
        productId: row.productId,
        currentQuantity: row.currentQuantity,
        minStock: row.minStock,
      });
    } catch (err) {
      // P2002 = unique constraint — allaqachon OPEN yozuv bor, o'tkazib yuboramiz.
      if ((err as { code?: string }).code === 'P2002') continue;
      throw err;
    }
  }
  return created;
}

async function dispatchNotifications(
  client: Db,
  companyId: number,
  store: { id: number; type: string },
  _actionType: string,
  createdItems: Array<{ id: number; productId: number; currentQuantity: number; minStock: number }>,
): Promise<void> {
  const isBase = store.type === STORE_TYPE_BASE;
  const notifType = isBase ? NOTIF_LOW_STOCK_PURCHASE : NOTIF_LOW_STOCK_TRANSFER;

  // 1 query: faqat shu store'ning aktiv foydalanuvchilari.
  const recipients = await client.storeUser.findMany({
    where: { storeId: store.id, isActive: true },
    select: { userId: true },
  });
  const userIds = recipients.map((r) => r.userId);
  if (userIds.length === 0) return;

  const title = isBase ? 'Mahsulot tugayapti' : "Mahsulotni to'ldirish kerak";
  const data = createdItems.flatMap((item) => {
    const message =
      `#${item.productId} mahsulot zaxirasi ${item.currentQuantity} <= ${item.minStock}. ` +
      (isBase ? 'Yetkazib beruvchidan xarid qiling.' : 'Bazadan transfer qiling.');
    return userIds.map((userId) => ({ companyId, userId, type: notifType, title, message }));
  });

  await client.notification.createMany({ data });

  // socket.io orqali jonli yetkazish
  emitToUsers(userIds, 'notification:new', {
    type: notifType,
    title,
    message: isBase ? 'Mahsulot zaxirasi tugayapti' : "Mahsulotni to'ldirish kerak",
    link: null,
    created_at: new Date().toISOString(),
  });
}

/**
 * Bitta mahsulot uchun (LowStockService.evaluate ekvivalenti).
 */
export async function evaluateLowStockSingle(params: {
  store: number;
  product: number | { id: number };
  db?: Db;
}) {
  const productId = typeof params.product === 'object' ? params.product.id : params.product;
  return evaluateLowStock({ store: params.store, productIds: [productId], db: params.db });
}

/**
 * Product-level min_stock o'zgarganda shu mahsulotni saqlovchi HAR bir store
 * bo'yicha qayta baholash (reevaluate_product ekvivalenti).
 */
export async function reevaluateProductLowStock(params: {
  product: number | { id: number };
  db?: Db;
}) {
  const productId = typeof params.product === 'object' ? params.product.id : params.product;
  const client = params.db ?? prisma;
  const rows = await client.productBatch.findMany({
    where: { productId },
    select: { storeId: true },
    distinct: ['storeId'],
  });
  const out: Array<{ id: number; productId: number; currentQuantity: number; minStock: number }> = [];
  for (const r of rows) {
    const created = await evaluateLowStock({ store: r.storeId, productIds: [productId], db: params.db });
    out.push(...created);
  }
  return out;
}

// ── List serializatsiya (LowStockItemSerializer) ──

export interface LowStockRow {
  id: number;
  storeId: number;
  productId: number;
  currentQuantity: number;
  minStock: number;
  actionType: string;
  status: string;
  resolvedAt: Date | null;
  createdAt: Date;
  store?: { name: string } | null;
  product?: { name: string } | null;
}

export function serializeLowStockItem(it: LowStockRow) {
  return {
    id: it.id,
    store: it.storeId,
    store_name: it.store?.name ?? null,
    product: it.productId,
    product_name: it.product?.name ?? null,
    current_quantity: it.currentQuantity,
    min_stock: it.minStock,
    action_type: it.actionType,
    status: it.status,
    resolved_at: it.resolvedAt,
    created_at: it.createdAt,
  };
}

// LowStockItemFilter + ordering (ListAPIView)
export interface LowStockListParams {
  companyId: number;
  status: string;
  action_type?: string;
  store?: number;
  product?: number;
  ordering?: string;
  skip: number;
  take: number;
}

const LOW_STOCK_ORDERING_FIELDS: Record<string, keyof Prisma.LowStockItemOrderByWithRelationInput> = {
  created_at: 'createdAt',
  current_quantity: 'currentQuantity',
  resolved_at: 'resolvedAt',
};

function buildLowStockOrderBy(
  ordering: string | undefined,
  fallback: Prisma.LowStockItemOrderByWithRelationInput[],
): Prisma.LowStockItemOrderByWithRelationInput[] {
  if (!ordering) return fallback;
  const parts = ordering.split(',').map((p) => p.trim()).filter(Boolean);
  const result: Prisma.LowStockItemOrderByWithRelationInput[] = [];
  for (const part of parts) {
    const desc = part.startsWith('-');
    const key = desc ? part.slice(1) : part;
    const field = LOW_STOCK_ORDERING_FIELDS[key];
    if (field) result.push({ [field]: desc ? 'desc' : 'asc' });
  }
  return result.length > 0 ? result : fallback;
}

export async function listLowStock(params: LowStockListParams) {
  // companyId scope: faqat shu tenant low-stock yozuvlari.
  const where: Prisma.LowStockItemWhereInput = { companyId: params.companyId, status: params.status };
  if (params.action_type) where.actionType = params.action_type;
  if (params.store !== undefined) where.storeId = params.store;
  if (params.product !== undefined) where.productId = params.product;

  // OPEN ro'yxati default `-created_at`; RESOLVED tarixi `-resolved_at, -created_at`.
  const fallback: Prisma.LowStockItemOrderByWithRelationInput[] =
    params.status === STATUS_RESOLVED
      ? [{ resolvedAt: 'desc' }, { createdAt: 'desc' }]
      : [{ createdAt: 'desc' }];

  const orderBy = buildLowStockOrderBy(params.ordering, fallback);

  const [rows, count] = await Promise.all([
    prisma.lowStockItem.findMany({
      where,
      include: { store: { select: { name: true } }, product: { select: { name: true } } },
      orderBy,
      skip: params.skip,
      take: params.take,
    }),
    prisma.lowStockItem.count({ where }),
  ]);

  return { results: rows.map(serializeLowStockItem), count };
}

export const LOW_STOCK_STATUS = { OPEN: STATUS_OPEN, RESOLVED: STATUS_RESOLVED } as const;
