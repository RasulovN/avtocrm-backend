import type { Prisma, PurchaseSession } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { BadRequest, NotFound, ValidationError } from '../../common/errors.js';
import { stockEntryCreateSchema } from './contract.schemas.js';
import type {
  PurchaseSessionCreateInput,
  PurchaseSessionItemInput,
  PurchaseSessionUpdateInput,
} from './contract.schemas.js';
import { createEntry, validateEntryRelations } from './stockEntry.service.js';

// Django apps/contract/views/purchase_session_view.py ekvivalenti.
// Oqim: in_progress → received (qabul qilingan, tasdiqlanmagan) → completed / cancelled.
// Sessiya omborga/qarzga TA'SIR QILMAYDI — faqat confirm bosqichida createEntry chaqiriladi.

const ACTIVE_STATUSES = ['in_progress', 'received'];

type SessionWithNames = PurchaseSession & {
  supplier?: { name: string } | null;
  store?: { name: string } | null;
};

interface SessionItemJson {
  product: number | null;
  product_name: string;
  quantity: string;
  purchase_price: string;
  selling_price: string;
  wholesale_price: string;
}

// JSON'dan o'qilgan itemlarni normalizatsiya qiladi (draft — qiymatlar chala bo'lishi mumkin)
function sessionItems(session: PurchaseSession): SessionItemJson[] {
  const raw = session.items;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((item) => {
    const it = (item ?? {}) as Record<string, unknown>;
    return {
      product: typeof it.product === 'number' ? it.product : null,
      product_name: typeof it.product_name === 'string' ? it.product_name : '',
      quantity: String(it.quantity ?? 0),
      purchase_price: String(it.purchase_price ?? 0),
      selling_price: String(it.selling_price ?? 0),
      wholesale_price: String(it.wholesale_price ?? 0),
    };
  });
}

// PurchaseSessionSerializer javobi (Django bilan bir xil maydonlar)
export function serializePurchaseSession(session: SessionWithNames) {
  const items = sessionItems(session);
  const total = items.reduce(
    (sum, item) => sum + (Number(item.purchase_price) || 0) * (Number(item.quantity) || 0),
    0,
  );
  return {
    id: session.id,
    supplier: session.supplierId,
    supplier_name: session.supplier?.name ?? '',
    store: session.storeId,
    store_name: session.store?.name ?? '',
    items,
    items_count: items.length,
    total_amount: total.toFixed(2),
    cash_amount: Number(session.cashAmount).toFixed(2),
    card_amount: Number(session.cardAmount).toFixed(2),
    bank_card: session.bankCardId ?? null,
    note: session.note ?? '',
    status: session.status,
    current_step: session.currentStep,
    entry: session.entryId ?? null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
}

// Draft itemlarni JSON ko'rinishga o'tkazadi (Decimal emas — string)
function toItemsJson(items: PurchaseSessionItemInput[]): Prisma.InputJsonValue {
  return items.map((item) => ({
    product: item.product ?? null,
    product_name: item.product_name ?? '',
    quantity: String(item.quantity ?? 0),
    purchase_price: String(item.purchase_price ?? 0),
    selling_price: String(item.selling_price ?? 0),
    wholesale_price: String(item.wholesale_price ?? 0),
  }));
}

// Supplier/store/bank_card relation tekshiruvlari (tenant doirasida)
async function validateSessionRelations(
  companyId: number,
  data: { supplier?: number; store?: number; bank_card?: number | null },
): Promise<void> {
  if (data.supplier !== undefined) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: data.supplier, companyId, isActive: true },
      select: { id: true },
    });
    if (!supplier) {
      throw new ValidationError({ supplier: ['Invalid pk - object does not exist.'] });
    }
  }
  if (data.store !== undefined) {
    const store = await prisma.store.findFirst({
      where: { id: data.store, companyId, isActive: true },
      select: { id: true },
    });
    if (!store) {
      throw new ValidationError({ store: ['Invalid pk - object does not exist.'] });
    }
  }
  if (data.bank_card !== undefined && data.bank_card !== null) {
    const card = await prisma.paymentMethod.findFirst({
      where: { id: data.bank_card, isActive: true },
      select: { id: true },
    });
    if (!card) {
      throw new ValidationError({ bank_card: ['Invalid pk - object does not exist.'] });
    }
  }
}

const includeNames = {
  supplier: { select: { name: true } },
  store: { select: { name: true } },
} satisfies Prisma.PurchaseSessionInclude;

// ─────────────────────────────────────────────
// List / Create
// ─────────────────────────────────────────────

// Har kim faqat o'z qoralamalarini ko'radi va davom ettiradi
export async function listActiveSessions(companyId: number, userId: number) {
  const sessions = await prisma.purchaseSession.findMany({
    where: { companyId, createdById: userId, status: { in: ACTIVE_STATUSES } },
    orderBy: { updatedAt: 'desc' },
    include: includeNames,
  });
  return sessions.map(serializePurchaseSession);
}

export async function createSession(opts: {
  companyId: number;
  userId: number;
  data: PurchaseSessionCreateInput;
}) {
  const { companyId, data } = opts;
  await validateSessionRelations(companyId, data);

  const session = await prisma.purchaseSession.create({
    data: {
      companyId,
      supplierId: data.supplier,
      storeId: data.store,
      items: toItemsJson(data.items ?? []),
      cashAmount: Number(data.cash_amount ?? 0).toFixed(2),
      cardAmount: Number(data.card_amount ?? 0).toFixed(2),
      bankCardId: data.bank_card ?? null,
      note: data.note ?? '',
      currentStep: data.current_step ?? 1,
      createdById: opts.userId,
    },
    include: includeNames,
  });
  return serializePurchaseSession(session);
}

// ─────────────────────────────────────────────
// Detail / Update / Cancel
// ─────────────────────────────────────────────

export async function getSessionOr404(
  companyId: number,
  userId: number,
  pk: number,
): Promise<SessionWithNames> {
  const session = await prisma.purchaseSession.findFirst({
    where: { id: pk, companyId, createdById: userId },
    include: includeNames,
  });
  if (!session) throw new NotFound();
  return session;
}

export async function updateSession(opts: {
  companyId: number;
  userId: number;
  pk: number;
  data: PurchaseSessionUpdateInput;
}) {
  const session = await getSessionOr404(opts.companyId, opts.userId, opts.pk);
  if (!ACTIVE_STATUSES.includes(session.status)) {
    throw new BadRequest({ detail: "Yakunlangan yoki bekor qilingan sessiyani o'zgartirib bo'lmaydi" });
  }
  await validateSessionRelations(opts.companyId, opts.data);

  const { data } = opts;
  const updateData: Prisma.PurchaseSessionUncheckedUpdateInput = {};
  if (data.supplier !== undefined) updateData.supplierId = data.supplier;
  if (data.store !== undefined) updateData.storeId = data.store;
  if (data.items !== undefined) updateData.items = toItemsJson(data.items);
  if (data.cash_amount !== undefined) updateData.cashAmount = Number(data.cash_amount).toFixed(2);
  if (data.card_amount !== undefined) updateData.cardAmount = Number(data.card_amount).toFixed(2);
  if (data.bank_card !== undefined) updateData.bankCardId = data.bank_card;
  if (data.note !== undefined) updateData.note = data.note;
  if (data.current_step !== undefined) updateData.currentStep = data.current_step;

  const updated = await prisma.purchaseSession.update({
    where: { id: session.id },
    data: updateData,
    include: includeNames,
  });
  return serializePurchaseSession(updated);
}

// Hard delete emas — sessiya bekor qilinadi (tarix saqlanadi)
export async function cancelSession(companyId: number, userId: number, pk: number): Promise<void> {
  const session = await getSessionOr404(companyId, userId, pk);
  if (session.status === 'completed') {
    throw new BadRequest({ detail: "Tasdiqlangan sessiyani bekor qilib bo'lmaydi" });
  }
  await prisma.purchaseSession.update({
    where: { id: session.id },
    data: { status: 'cancelled' },
  });
}

// ─────────────────────────────────────────────
// Receive / Confirm
// ─────────────────────────────────────────────

// Sessiya itemlarini StockEntryCreateSerializer formatiga o'tkazadi
function entryItemsPayload(session: PurchaseSession) {
  return sessionItems(session).map((item) => ({
    product: item.product,
    quantity: Math.trunc(Number(item.quantity) || 0),
    purchase_price: String(item.purchase_price || 0),
    selling_price: String(item.selling_price || 0),
    wholesale_price: String(item.wholesale_price || 0),
  }));
}

// 2-bosqich yakuni: itemlar to'liq validatsiyadan o'tadi va sessiya RECEIVED
// holatiga o'tadi. Ombor hali O'ZGARMAYDI.
export async function receiveSession(companyId: number, userId: number, pk: number) {
  const session = await getSessionOr404(companyId, userId, pk);
  if (!ACTIVE_STATUSES.includes(session.status)) {
    throw new BadRequest({ detail: "Yakunlangan yoki bekor qilingan sessiyani o'zgartirib bo'lmaydi" });
  }

  // To'lovsiz probe — cash/card 0 bilan ham o'tadi (Django'dagi kabi)
  const probe = stockEntryCreateSchema.parse({
    supplier: session.supplierId,
    store: session.storeId,
    cash_amount: '0',
    card_amount: '0',
    items: entryItemsPayload(session),
  });
  await validateEntryRelations(companyId, probe);

  const updated = await prisma.purchaseSession.update({
    where: { id: session.id },
    data: { status: 'received', currentStep: 3 },
    include: includeNames,
  });
  return serializePurchaseSession(updated);
}

// 3-bosqich yakuni: faqat RECEIVED sessiya tasdiqlanadi — haqiqiy kirim yaratiladi
// (ombor partiyalari, ta'minotchi qarzi — hammasi createEntry ichida o'zgaradi).
export async function confirmSession(companyId: number, userId: number, pk: number) {
  const session = await getSessionOr404(companyId, userId, pk);
  if (session.status !== 'received') {
    throw new BadRequest({
      detail: "Avval mahsulotlar qabul qilinishi kerak — tasdiqlash faqat to'lov bosqichida mumkin",
    });
  }

  const data = stockEntryCreateSchema.parse({
    supplier: session.supplierId,
    store: session.storeId,
    cash_amount: Number(session.cashAmount).toFixed(2),
    card_amount: Number(session.cardAmount).toFixed(2),
    bank_card: session.bankCardId ?? null,
    note: session.note ?? '',
    items: entryItemsPayload(session),
  });

  const entry = await createEntry({ companyId, data, userId });

  await prisma.purchaseSession.update({
    where: { id: session.id },
    data: { status: 'completed', entryId: entry.id },
  });

  return {
    status: 'success',
    id: entry.id,
    session_id: session.id,
    items_count: data.items.length,
    payment_type: entry.paymentType,
    paid_amount: Number(entry.paidAmount).toFixed(2),
    debt_amount: Number(entry.debtAmount).toFixed(2),
  };
}
