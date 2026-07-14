import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { ValidationError, NotFound } from '../../common/errors.js';
import { evaluateLowStock } from './lowStock.service.js';

// Django: apps/inventory/services/inventory_service.py (InventoryService)
//         + inventory_selector.py (InventorySelector)
//         + serializers/inventory_serializer.py
//
// Atomicity: har bir yozish operatsiyasi prisma.$transaction ichida.

const SESSION_ACTIVE = 'active';
const SESSION_COMPLETED = 'completed';
const SESSION_CANCELLED = 'cancelled';

const COUNT_PENDING = 'p';
const COUNT_EQUAL = 'e';
const COUNT_LESS = 'l';
const COUNT_MORE = 'm';

const MV_SALE = 's';
const MV_RETURN = 'r';
const MV_TRANSFER_OUT = 'to';
const MV_TRANSFER_IN = 'ti';
const MV_ENTRY = 'e';

// ============================================================
//  START SESSION
// ============================================================
// Django: start_session — active session bo'lsa xato; snapshot + count bulk_create.
export async function startSession(params: { companyId: number; userId: number; storeId: number }) {
  return prisma.$transaction(async (tx) => {
    // Store tenant doirasida bo'lishini tekshiramiz (cross-tenant store'da session ochib bo'lmaydi).
    const store = await tx.store.findFirst({
      where: { id: params.storeId, companyId: params.companyId },
      select: { id: true },
    });
    if (!store) throw new NotFound();

    const existing = await tx.inventorySession.findFirst({
      where: { storeId: params.storeId, status: SESSION_ACTIVE, companyId: params.companyId },
    });
    if (existing) {
      throw new ValidationError('Active session mavjud');
    }

    const session = await tx.inventorySession.create({
      data: { companyId: params.companyId, storeId: params.storeId, startedById: params.userId },
    });

    // start vaqtidagi stock: (product) bo'yicha barcha batch qoldiqlari Sum (tenant doirasida).
    const batches = await tx.productBatch.groupBy({
      by: ['productId'],
      where: { storeId: params.storeId, companyId: params.companyId },
      _sum: { quantity: true },
    });

    if (batches.length > 0) {
      await tx.inventorySnapshot.createMany({
        data: batches.map((b) => ({
          sessionId: session.id,
          productId: b.productId,
          storeId: params.storeId,
          expectedQuantity: b._sum.quantity ?? 0,
        })),
      });
      await tx.inventoryCount.createMany({
        data: batches.map((b) => ({
          sessionId: session.id,
          productId: b.productId,
          countedQuantity: 0,
          status: COUNT_PENDING,
        })),
      });
    }

    return session;
  });
}

// ============================================================
//  SET COUNT  (PUT /scan/)  — Django: set_count + scan_product
// ============================================================
// Django view: set_count(...) keyin scan_product(...) — ikkalasi ham counted_quantity
// ni quantity ga o'rnatadi; set_count qo'shimcha status hisoblaydi va is_check=true qiladi.
export async function setCount(params: { companyId: number; sessionId: number; productId: number; quantity: number }) {
  return prisma.$transaction(async (tx) => {
    // Session tenant doirasida — child (count/snapshot) shu orqali scope qilinadi.
    const session = await tx.inventorySession.findFirst({
      where: { id: params.sessionId, companyId: params.companyId },
    });
    if (!session) throw new NotFound();
    if (session.status !== SESSION_ACTIVE) {
      throw new ValidationError('Session yopilgan');
    }

    const count = await tx.inventoryCount.findUnique({
      where: { sessionId_productId: { sessionId: params.sessionId, productId: params.productId } },
    });
    if (!count) throw new NotFound();

    const snapshot = await tx.inventorySnapshot.findUnique({
      where: { sessionId_productId: { sessionId: params.sessionId, productId: params.productId } },
    });
    if (!snapshot) throw new NotFound();

    // status recalculation snapshot.expected_quantity ga nisbatan.
    let status: string;
    if (params.quantity === snapshot.expectedQuantity) {
      status = COUNT_EQUAL;
    } else if (params.quantity < snapshot.expectedQuantity) {
      status = COUNT_LESS;
    } else {
      status = COUNT_MORE;
    }

    await tx.inventoryCount.update({
      where: { id: count.id },
      data: { countedQuantity: params.quantity, status, isCheck: true },
    });
  });
}

// ============================================================
//  SCAN  (POST /scan/ — InventoryScanAPIView; urls.py'da 'scan/' PUT'ga bog'langan,
//  ammo scan_product alohida ham mavjud) — counted_quantity ni o'rnatadi.
// ============================================================
export async function scanProduct(params: { companyId: number; sessionId: number; productId: number; quantity: number }) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findFirst({
      where: { id: params.sessionId, companyId: params.companyId },
    });
    if (!session) throw new NotFound();
    if (session.status !== SESSION_ACTIVE) {
      throw new ValidationError('Session yopilgan');
    }
    // Django: get_or_create(session, product) keyin counted_quantity = quantity.
    await tx.inventoryCount.upsert({
      where: { sessionId_productId: { sessionId: params.sessionId, productId: params.productId } },
      update: { countedQuantity: params.quantity },
      create: {
        sessionId: params.sessionId,
        productId: params.productId,
        countedQuantity: params.quantity,
      },
    });
  });
}

// ============================================================
//  FINALIZE  (POST /finalize/)
// ============================================================
// Django: snapshot bo'yicha yuriladi.
//   final = counted - sold_out - transfer_out + transfer_in + entry + returned
//   final < 0 -> xato (Negative stock).
//   diff = final - expected; diff != 0 bo'lsa ProductBatch.quantity = final.
// Qo'shimcha: diff != 0 uchun InventoryAdjustment yoziladi (difference=diff).
export async function finalize(params: { companyId: number; sessionId: number }) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findFirst({
      where: { id: params.sessionId, companyId: params.companyId },
    });
    if (!session) throw new NotFound();
    if (session.status !== SESSION_ACTIVE) {
      throw new ValidationError('Session yopilgan');
    }

    // movement aggregatlari (type bo'yicha) bitta query.
    const movements = await tx.inventoryMovement.groupBy({
      by: ['productId', 'type'],
      where: { sessionId: session.id },
      _sum: { quantity: true },
    });
    const movementMap = new Map<number, Record<string, number>>();
    for (const m of movements) {
      const entry = movementMap.get(m.productId) ?? {};
      entry[m.type] = m._sum.quantity ?? 0;
      movementMap.set(m.productId, entry);
    }

    // counts map (product -> counted_quantity).
    const counts = await tx.inventoryCount.findMany({
      where: { sessionId: session.id },
      select: { productId: true, countedQuantity: true },
    });
    const countsMap = new Map<number, number>(counts.map((c) => [c.productId, c.countedQuantity]));

    // snapshots map (product -> expected_quantity) — finalize shu bo'yicha yuradi.
    const snapshots = await tx.inventorySnapshot.findMany({
      where: { sessionId: session.id },
      select: { productId: true, expectedQuantity: true },
    });

    const adjustments: Prisma.InventoryAdjustmentCreateManyInput[] = [];

    for (const snap of snapshots) {
      const productId = snap.productId;
      const expected = snap.expectedQuantity;
      const counted = countsMap.get(productId) ?? 0;
      const data = movementMap.get(productId) ?? {};

      const soldOut = data[MV_SALE] ?? 0;
      const returned = data[MV_RETURN] ?? 0;
      const transferOut = data[MV_TRANSFER_OUT] ?? 0;
      const transferIn = data[MV_TRANSFER_IN] ?? 0;
      const entry = data[MV_ENTRY] ?? 0;

      const final = counted - soldOut - transferOut + transferIn + entry + returned;

      if (final < 0) {
        throw new ValidationError(`Negative stock: product_id=${productId}`);
      }

      const diff = final - expected;

      if (diff !== 0) {
        // ProductBatch qoldig'ini final ga to'g'rilaymiz (Django: .update(quantity=final)).
        await tx.productBatch.updateMany({
          where: { storeId: session.storeId, productId, companyId: params.companyId },
          data: { quantity: final },
        });
        adjustments.push({ sessionId: session.id, productId, difference: diff });
      }
    }

    if (adjustments.length > 0) {
      await tx.inventoryAdjustment.createMany({ data: adjustments });
      await evaluateLowStock({
        store: session.storeId,
        productIds: adjustments.map((item) => item.productId),
        db: tx,
      });
    }

    await tx.inventorySession.update({
      where: { id: session.id },
      data: { status: SESSION_COMPLETED },
    });
  });
}

// ============================================================
//  CANCEL  (POST /cancel/)
// ============================================================
// Django: status=cancelled + movement/count/snapshot delete.
export async function cancel(params: { companyId: number; sessionId: number }) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.inventorySession.findFirst({
      where: { id: params.sessionId, companyId: params.companyId },
    });
    if (!session) throw new NotFound();
    if (session.status !== SESSION_ACTIVE) {
      throw new ValidationError('Cancel qilib bo‘lmaydi');
    }

    await tx.inventorySession.update({
      where: { id: session.id },
      data: { status: SESSION_CANCELLED },
    });
    await tx.inventoryMovement.deleteMany({ where: { sessionId: session.id } });
    await tx.inventoryCount.deleteMany({ where: { sessionId: session.id } });
    await tx.inventorySnapshot.deleteMany({ where: { sessionId: session.id } });
  });
}

// ============================================================
//  LIST  (GET /list/)  — InventoryListAPIView
// ============================================================
// superuser -> barcha session; aks holda foydalanuvchining aktiv store-link
// orqali bog'langan storelar sessionlari. -started_at.
interface SessionRow {
  id: number;
  storeId: number;
  startedById: number | null;
  startedAt: Date;
  status: string;
  snapshotTaken: boolean;
  store: { name: string };
  adjustments: Array<{ difference: number }>;
  _count: { snapshots: number };
}

function serializeSession(s: SessionRow) {
  const shortageAdjustments = s.adjustments.filter((item) => item.difference < 0);
  const shortageItems = shortageAdjustments.length;
  const mismatchItems = s.adjustments.length;
  return {
    id: s.id,
    store: s.storeId,
    store_name: s.store.name,
    started_by: s.startedById,
    started_at: s.startedAt,
    status: s.status,
    snapshot_taken: s.snapshotTaken,
    total_items: s._count.snapshots,
    matched_items: Math.max(0, s._count.snapshots - mismatchItems),
    mismatched_items: mismatchItems,
    shortage_items: shortageItems,
    shortage_quantity: shortageAdjustments.reduce((total, item) => total + Math.abs(item.difference), 0),
  };
}

export async function listSessions(params: {
  companyId: number;
  isSuperuser: boolean;
  userId: number;
  status?: string;
  skip: number;
  take: number;
}) {
  // companyId scope hamisha qo'llanadi; superuser ham faqat shu tenant sessiyalarini ko'radi.
  const accessWhere: Prisma.InventorySessionWhereInput = params.isSuperuser
    ? { companyId: params.companyId }
    : {
        companyId: params.companyId,
        store: { userLinks: { some: { userId: params.userId, isActive: true } } },
      };
  const where: Prisma.InventorySessionWhereInput = {
    ...accessWhere,
    ...(params.status ? { status: params.status } : {}),
  };

  const [rows, count] = await Promise.all([
    prisma.inventorySession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: params.skip,
      take: params.take,
      include: {
        store: { select: { name: true } },
        adjustments: { select: { difference: true } },
        _count: { select: { snapshots: true } },
      },
    }),
    prisma.inventorySession.count({ where }),
  ]);

  return { results: rows.map(serializeSession), count };
}

// ============================================================
//  DETAIL  (GET /list/:session_id/)  — InventoryDetailAPIView
// ============================================================
// InventorySelector.get_inventory_list: snapshot bo'yicha, har product uchun
// counted / movement turlari aggregatlari, is_check, status. statuses filtri.
// final = counted - sold_out - transfer_out + transfer_in + entry + returned
// difference = final - expected_quantity
export async function getInventoryDetail(params: { companyId: number; sessionId: number; statuses?: string[] }) {
  // Cross-tenant himoya: session shu tenant'ga tegishli bo'lishini oldindan tekshiramiz.
  const session = await prisma.inventorySession.findFirst({
    where: { id: params.sessionId, companyId: params.companyId },
    select: { id: true },
  });
  if (!session) throw new NotFound();

  const snapshots = await prisma.inventorySnapshot.findMany({
    where: { sessionId: params.sessionId },
    include: { product: { select: { id: true, name: true, barcode: true } } },
  });

  const productIds = snapshots.map((s) => s.productId);

  // counts (product -> counted, is_check, status) bitta query.
  const counts = await prisma.inventoryCount.findMany({
    where: { sessionId: params.sessionId, productId: { in: productIds } },
    select: { productId: true, countedQuantity: true, isCheck: true, status: true },
  });
  const countMap = new Map(counts.map((c) => [c.productId, c]));

  // movement turlari bo'yicha aggregat (product, type) bitta query.
  const movements = await prisma.inventoryMovement.groupBy({
    by: ['productId', 'type'],
    where: { sessionId: params.sessionId },
    _sum: { quantity: true },
  });
  const movementMap = new Map<number, Record<string, number>>();
  for (const m of movements) {
    const entry = movementMap.get(m.productId) ?? {};
    entry[m.type] = m._sum.quantity ?? 0;
    movementMap.set(m.productId, entry);
  }

  let products = snapshots.map((snap) => {
    const c = countMap.get(snap.productId);
    const counted = c?.countedQuantity ?? 0;
    const isCheck = c?.isCheck ?? false;
    const status = c?.status ?? COUNT_PENDING;
    const mv = movementMap.get(snap.productId) ?? {};

    const soldOut = mv[MV_SALE] ?? 0;
    const returned = mv[MV_RETURN] ?? 0;
    const transferOut = mv[MV_TRANSFER_OUT] ?? 0;
    const transferIn = mv[MV_TRANSFER_IN] ?? 0;
    const entry = mv[MV_ENTRY] ?? 0;

    const final = counted - soldOut - transferOut + transferIn + entry + returned;
    const difference = final - snap.expectedQuantity;

    return {
      product_id: snap.product.id,
      product_name: snap.product.name,
      barcode: snap.product.barcode,
      declared: snap.expectedQuantity,
      scanned: counted,
      sold_out: soldOut,
      returned,
      transfer_out: transferOut,
      transfer_in: transferIn,
      entry,
      status,
      is_check: isCheck,
      final,
      difference,
    };
  });

  if (params.statuses && params.statuses.length > 0) {
    const set = new Set(params.statuses);
    products = products.filter((p) => set.has(p.status));
  }

  const checked = products.filter((p) => p.is_check);
  return { products, checked };
}

// ============================================================
//  MOVEMENT LIST  (GET /movement-list/:session_id/)
// ============================================================
interface MovementRow {
  id: number;
  sessionId: number;
  productId: number;
  quantity: number;
  type: string;
  refId: number;
  createdAt: Date;
  product?: { name: string } | null;
}

function serializeMovement(m: MovementRow) {
  return {
    id: m.id,
    session: m.sessionId,
    product: m.productId,
    product_name: m.product?.name ?? '',
    quantity: m.quantity,
    type: m.type,
    ref_id: m.refId,
    created_at: m.createdAt,
  };
}

export async function listMovements(params: { companyId: number; sessionId: number }) {
  const session = await prisma.inventorySession.findFirst({
    where: { id: params.sessionId, companyId: params.companyId },
  });
  if (!session) throw new NotFound();

  const rows = await prisma.inventoryMovement.findMany({
    where: { sessionId: params.sessionId },
    include: { product: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(serializeMovement);
}
