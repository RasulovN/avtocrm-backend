import type { Prisma, TransferSession } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { BadRequest, NotFound, ValidationError } from '../../common/errors.js';
import type { TransferSessionUpsertInput } from './transfer.schemas.js';

// Django apps/transfer (TransferSession*APIView) ekvivalenti.
// O'tkazma qoralamasi: forma to'ldirilayotganda avto-saqlanadi, yuborilmaguncha
// in_progress bo'lib turadi — omborga TA'SIR QILMAYDI. Haqiqiy StockTransfer
// /transfer/create/ orqali yaratiladi, keyin complete/ sessiyani unga bog'laydi.

const ACTIVE_STATUS = 'in_progress';

type SessionWithNames = TransferSession & {
  fromStore?: { name: string } | null;
  toStore?: { name: string } | null;
};

interface SessionItemJson {
  product: number | null;
  quantity: number;
}

// JSON'dan o'qilgan itemlarni normalizatsiya qiladi (draft — qiymatlar chala bo'lishi mumkin)
function sessionItems(session: TransferSession): SessionItemJson[] {
  const raw = session.items;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((item) => {
    const it = (item ?? {}) as Record<string, unknown>;
    const product = Number(it.product);
    return {
      product: Number.isFinite(product) && product > 0 ? Math.trunc(product) : null,
      quantity: Math.trunc(Number(it.quantity)) || 0,
    };
  });
}

export function serializeTransferSession(session: SessionWithNames) {
  return {
    id: session.id,
    from_store: session.fromStoreId ?? null,
    from_store_name: session.fromStore?.name ?? null,
    to_store: session.toStoreId ?? null,
    to_store_name: session.toStore?.name ?? null,
    items: sessionItems(session),
    status: session.status,
    transfer: session.transferId ?? null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
}

function toItemsJson(items: SessionItemJson[]): Prisma.InputJsonValue {
  return items.map((it) => ({ product: it.product, quantity: it.quantity }));
}

// from/to store relation tekshiruvi (tenant doirasida, faol do'konlar)
async function validateStores(
  companyId: number,
  data: TransferSessionUpsertInput,
): Promise<void> {
  for (const [key, storeId] of [
    ['from_store', data.from_store],
    ['to_store', data.to_store],
  ] as const) {
    if (storeId === null || storeId === undefined) continue;
    const store = await prisma.store.findFirst({
      where: { id: storeId, companyId, isActive: true },
      select: { id: true },
    });
    if (!store) {
      throw new ValidationError({ [key]: ['Invalid pk - object does not exist.'] });
    }
  }
}

const includeNames = {
  fromStore: { select: { name: true } },
  toStore: { select: { name: true } },
} satisfies Prisma.TransferSessionInclude;

// Har kim faqat o'z qoralamalarini ko'radi (faqat in_progress)
export async function listActiveSessions(companyId: number, userId: number) {
  const sessions = await prisma.transferSession.findMany({
    where: { companyId, createdById: userId, status: ACTIVE_STATUS },
    orderBy: { updatedAt: 'desc' },
    include: includeNames,
  });
  return sessions.map(serializeTransferSession);
}

export async function createSession(opts: {
  companyId: number;
  userId: number;
  data: TransferSessionUpsertInput;
}) {
  const { companyId, data } = opts;
  await validateStores(companyId, data);

  const session = await prisma.transferSession.create({
    data: {
      companyId,
      fromStoreId: data.from_store ?? null,
      toStoreId: data.to_store ?? null,
      items: toItemsJson(data.items ?? []),
      createdById: opts.userId,
    },
    include: includeNames,
  });
  return serializeTransferSession(session);
}

export async function getSessionOr404(
  companyId: number,
  userId: number,
  pk: number,
): Promise<SessionWithNames> {
  const session = await prisma.transferSession.findFirst({
    where: { id: pk, companyId, createdById: userId },
    include: includeNames,
  });
  if (!session) throw new NotFound();
  return session;
}

// PATCH — avto-saqlash (qisman yangilash); faqat in_progress sessiya tahrirlanadi
export async function updateSession(opts: {
  companyId: number;
  userId: number;
  pk: number;
  data: TransferSessionUpsertInput;
}) {
  const session = await getSessionOr404(opts.companyId, opts.userId, opts.pk);
  if (session.status !== ACTIVE_STATUS) {
    throw new BadRequest({ detail: "Yakunlangan yoki bekor qilingan qoralamani o'zgartirib bo'lmaydi" });
  }
  await validateStores(opts.companyId, opts.data);

  const { data } = opts;
  const updateData: Prisma.TransferSessionUncheckedUpdateInput = {};
  if (data.from_store !== undefined) updateData.fromStoreId = data.from_store;
  if (data.to_store !== undefined) updateData.toStoreId = data.to_store;
  if (data.items !== undefined) updateData.items = toItemsJson(data.items);

  const updated = await prisma.transferSession.update({
    where: { id: session.id },
    data: updateData,
    include: includeNames,
  });
  return serializeTransferSession(updated);
}

// Hard delete emas — qoralama bekor qilinadi (tarix saqlanadi)
export async function cancelSession(companyId: number, userId: number, pk: number): Promise<void> {
  const session = await getSessionOr404(companyId, userId, pk);
  if (session.status === 'completed') {
    throw new BadRequest({ detail: "Yakunlangan qoralamani o'chirib bo'lmaydi" });
  }
  await prisma.transferSession.update({
    where: { id: session.id },
    data: { status: 'cancelled' },
  });
}

// Haqiqiy o'tkazma yaratilgach: sessiya unga bog'lanadi va completed bo'ladi
export async function completeSession(opts: {
  companyId: number;
  userId: number;
  pk: number;
  transferId: number | null;
}) {
  const session = await getSessionOr404(opts.companyId, opts.userId, opts.pk);
  if (session.status === 'cancelled') {
    throw new BadRequest({ detail: 'Bekor qilingan qoralamani yakunlab bo\'lmaydi' });
  }

  let transferId: number | null = null;
  if (opts.transferId) {
    const transfer = await prisma.stockTransfer.findFirst({
      where: { id: opts.transferId, companyId: opts.companyId },
      select: { id: true },
    });
    if (!transfer) {
      throw new ValidationError({ transfer: ['Invalid pk - object does not exist.'] });
    }
    transferId = transfer.id;
  }

  const updated = await prisma.transferSession.update({
    where: { id: session.id },
    data: { status: 'completed', transferId },
    include: includeNames,
  });
  return serializeTransferSession(updated);
}
