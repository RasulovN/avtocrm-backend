import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { evaluateLowStock } from './lowStock.service.js';

// Django: apps/inventory/services/inventory_hooks_service.py
//
// Boshqa modullar (sales, transfer, contract/stock-entry) chaqiradigan reusable
// hooklar. Faol InventorySession (status='active') bo'lsa InventoryMovement
// yozadi. Imkon qadar `tx` (Prisma transaction client) qabul qiladi — chaqiruvchi
// modulning atomicity'iga qo'shiladi.
//
//   InventoryMovement.type:
//     's'  -> SALE
//     'to' -> TRANSFER_OUT
//     'r'  -> RETURN
//     'ti' -> TRANSFER_IN
//     'e'  -> ENTRY

type Db = PrismaClient | Prisma.TransactionClient;

export const MOVEMENT_TYPE = {
  SALE: 's',
  TRANSFER_OUT: 'to',
  RETURN: 'r',
  TRANSFER_IN: 'ti',
  ENTRY: 'e',
} as const;

export type MovementType = (typeof MOVEMENT_TYPE)[keyof typeof MOVEMENT_TYPE];

const SESSION_ACTIVE = 'active';

/**
 * Berilgan store uchun faol (active) InventorySession ni qaytaradi yoki null.
 */
export async function getActiveSession(db: Db, storeId: number) {
  return db.inventorySession.findFirst({
    where: { storeId, status: SESSION_ACTIVE },
  });
}

interface MovementLine {
  productId: number;
  quantity: number;
}

/**
 * Past darajadagi reusable yozuvchi: agar store'da faol session bo'lsa, har bir
 * (product, quantity) uchun berilgan turdagi InventoryMovement yaratadi.
 * Faol session bo'lmasa indamay qaytadi (Django: `if not session: return`).
 *
 *   recordMovement(tx, sessionFor, { type, refId, lines })
 *
 * @param db          Prisma client yoki transaction client.
 * @param sessionFor  Movement yoziladigan store id (sale.store / transfer.fromStore ...).
 */
export async function recordMovement(
  db: Db,
  sessionFor: number,
  params: { type: MovementType; refId: number; lines: MovementLine[] },
): Promise<void> {
  if (params.lines.length === 0) return;
  const session = await getActiveSession(db, sessionFor);
  if (!session) return;

  await db.inventoryMovement.createMany({
    data: params.lines.map((line) => ({
      sessionId: session.id,
      productId: line.productId,
      quantity: line.quantity,
      type: params.type,
      refId: params.refId,
    })),
  });
}

// ── Yuqori darajali, Django funksiya nomlari bilan mos hooklar ──

/**
 * Sotuv qatori (handle_sale_item). saleStoreId = sale.store, refId = sale.id.
 */
export async function handleSaleItem(
  params: { storeId: number; productId: number; quantity: number; saleId: number },
  db: Db = prisma,
): Promise<void> {
  await recordMovement(db, params.storeId, {
    type: MOVEMENT_TYPE.SALE,
    refId: params.saleId,
    lines: [{ productId: params.productId, quantity: params.quantity }],
  });
}

/**
 * Sotuv qaytarish (handle_sale_return). returnStoreId = return.store, refId = return.id.
 */
export async function handleSaleReturn(
  params: { storeId: number; productId: number; quantity: number; returnId: number },
  db: Db = prisma,
): Promise<void> {
  await recordMovement(db, params.storeId, {
    type: MOVEMENT_TYPE.RETURN,
    refId: params.returnId,
    lines: [{ productId: params.productId, quantity: params.quantity }],
  });
}

/**
 * Transfer tasdiqlandi — manba do'kon (handle_transfer_approved).
 * fromStore qoldig'i kamayadi: low-stock baholash + (faol session bo'lsa) TRANSFER_OUT.
 */
export async function handleTransferApproved(
  params: { fromStoreId: number; transferId: number; lines: MovementLine[] },
  db: Db = prisma,
): Promise<void> {
  // Low-stock: manba do'kon qoldig'i kamaydi -> threshold kesib o'tishi mumkin.
  await evaluateLowStock({
    store: params.fromStoreId,
    productIds: params.lines.map((l) => l.productId),
    db,
  });

  await recordMovement(db, params.fromStoreId, {
    type: MOVEMENT_TYPE.TRANSFER_OUT,
    refId: params.transferId,
    lines: params.lines,
  });
}

/**
 * Transfer qabul qilindi — qabul qiluvchi do'kon (handle_transfer_in).
 * toStore qoldig'i oshadi: low-stock RESOLVE bo'lishi mumkin + TRANSFER_IN.
 */
export async function handleTransferIn(
  params: { toStoreId: number; transferId: number; lines: MovementLine[] },
  db: Db = prisma,
): Promise<void> {
  await evaluateLowStock({
    store: params.toStoreId,
    productIds: params.lines.map((l) => l.productId),
    db,
  });

  await recordMovement(db, params.toStoreId, {
    type: MOVEMENT_TYPE.TRANSFER_IN,
    refId: params.transferId,
    lines: params.lines,
  });
}

/**
 * Kirim (stock entry) — qoldiq oshadi (handle_stock_entry).
 * Low-stock RESOLVE bo'lishi mumkin + (faol session bo'lsa) ENTRY.
 */
export async function handleStockEntry(
  params: { storeId: number; entryId: number; lines: MovementLine[] },
  db: Db = prisma,
): Promise<void> {
  await evaluateLowStock({
    store: params.storeId,
    productIds: params.lines.map((l) => l.productId),
    db,
  });

  await recordMovement(db, params.storeId, {
    type: MOVEMENT_TYPE.ENTRY,
    refId: params.entryId,
    lines: params.lines,
  });
}
