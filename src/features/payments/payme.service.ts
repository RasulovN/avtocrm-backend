import type { Prisma, Subscription } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import {
  PaymeError,
  PaymeRpcException,
  PaymeState,
  type PaymeMessage,
  type PaymeParams,
  type PaymeRpcResult,
} from './payme.types.js';

// ─────────────────────────────────────────────
// Yordamchilar
// ─────────────────────────────────────────────

// Subscription.amount so'mda saqlanadi; Payme tiyin'da ishlaydi (so'm * 100).
function somToTiyin(amount: Prisma.Decimal): number {
  // Decimal'ni butun tiyin'ga aylantiramiz (yaxlitlash bilan).
  return Math.round(Number(amount) * 100);
}

function nowMs(): number {
  return Date.now();
}

function msg(ru: string, uz: string, en: string): PaymeMessage {
  return { ru, uz, en };
}

const MSG_ACCOUNT_NOT_FOUND = msg(
  'Подписка не найдена',
  'Obuna topilmadi',
  'Subscription not found',
);
const MSG_WRONG_AMOUNT = msg('Неверная сумма', "Noto'g'ri summa", 'Wrong amount');
const MSG_UNABLE_TO_PERFORM = msg(
  'Невозможно выполнить операцию',
  "Amalni bajarib bo'lmaydi",
  'Unable to perform operation',
);
const MSG_TRANSACTION_NOT_FOUND = msg(
  'Транзакция не найдена',
  'Tranzaksiya topilmadi',
  'Transaction not found',
);

// ─────────────────────────────────────────────
// Checkout link (so'rovnoma havolasi)
// ─────────────────────────────────────────────
// Format: ${PAYME_CHECKOUT_URL}/${base64("m=MERCHANT;ac.FIELD=subId;a=amountTiyin")}
export function buildCheckoutLink(subscription: Pick<Subscription, 'id' | 'amount'>): {
  checkout_url: string;
  amount_tiyin: number;
} {
  const amountTiyin = somToTiyin(subscription.amount as Prisma.Decimal);
  const field = env.PAYME_ACCOUNT_FIELD;
  const raw = `m=${env.PAYME_MERCHANT_ID};ac.${field}=${subscription.id};a=${amountTiyin}`;
  const encoded = Buffer.from(raw, 'utf8').toString('base64');
  return {
    checkout_url: `${env.PAYME_CHECKOUT_URL}/${encoded}`,
    amount_tiyin: amountTiyin,
  };
}

// ─────────────────────────────────────────────
// Account -> Subscription topish
// ─────────────────────────────────────────────
function extractSubscriptionId(params: PaymeParams): number {
  const account = params.account ?? {};
  const raw = account[env.PAYME_ACCOUNT_FIELD];
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) {
    throw new PaymeRpcException(PaymeError.AccountNotFound, MSG_ACCOUNT_NOT_FOUND, env.PAYME_ACCOUNT_FIELD);
  }
  return id;
}

async function findSubscriptionOrThrow(params: PaymeParams) {
  const id = extractSubscriptionId(params);
  const subscription = await prisma.subscription.findUnique({
    where: { id },
    include: { plan: true },
  });
  if (!subscription) {
    throw new PaymeRpcException(PaymeError.AccountNotFound, MSG_ACCOUNT_NOT_FOUND, env.PAYME_ACCOUNT_FIELD);
  }
  return subscription;
}

// CheckPerform mantiqi: obuna mavjud + amount mos. (status tekshiruvi qat'iy emas — qayta to'lov bloklanmasligi uchun)
async function assertCanPerform(params: PaymeParams) {
  const subscription = await findSubscriptionOrThrow(params);

  // Allaqachon faollashtirilgan / bekor qilingan obunaga yangi to'lovni rad etamiz.
  if (subscription.status !== 'pending' && subscription.status !== 'active') {
    throw new PaymeRpcException(PaymeError.UnableToPerform, MSG_UNABLE_TO_PERFORM);
  }

  const expectedTiyin = somToTiyin(subscription.amount);
  if (params.amount !== expectedTiyin) {
    throw new PaymeRpcException(PaymeError.WrongAmount, MSG_WRONG_AMOUNT);
  }

  return { subscription, expectedTiyin };
}

// ─────────────────────────────────────────────
// JSON-RPC metodlari
// ─────────────────────────────────────────────

// CheckPerformTransaction
export async function checkPerformTransaction(params: PaymeParams): Promise<PaymeRpcResult> {
  await assertCanPerform(params);
  return { allow: true };
}

// CreateTransaction (idempotent paycomId bo'yicha)
export async function createTransaction(params: PaymeParams): Promise<PaymeRpcResult> {
  const paycomId = params.id;
  if (!paycomId) {
    throw new PaymeRpcException(PaymeError.TransactionNotFound, MSG_TRANSACTION_NOT_FOUND);
  }

  const existing = await prisma.paymeTransaction.findUnique({ where: { paycomId } });
  if (existing) {
    // Mavjud tranzaksiyani qaytaramiz (idempotentlik).
    if (existing.state !== PaymeState.Created) {
      throw new PaymeRpcException(PaymeError.UnableToPerform, MSG_UNABLE_TO_PERFORM);
    }
    return {
      create_time: Number(existing.createTime),
      transaction: String(existing.id),
      state: existing.state,
    };
  }

  // Yangi tranzaksiya — qayta tekshiramiz.
  const { subscription, expectedTiyin } = await assertCanPerform(params);
  const createTime = params.time ?? nowMs();

  const created = await prisma.paymeTransaction.create({
    data: {
      paycomId,
      subscriptionId: subscription.id,
      amount: String(expectedTiyin), // tiyin'da saqlanadi
      state: PaymeState.Created,
      createTime: BigInt(createTime),
      account: (params.account ?? {}) as Prisma.InputJsonValue,
    },
  });

  return {
    create_time: Number(created.createTime),
    transaction: String(created.id),
    state: created.state,
  };
}

// PerformTransaction — to'lovni tasdiqlash + obunani ATOMIK faollashtirish.
export async function performTransaction(params: PaymeParams): Promise<PaymeRpcResult> {
  const paycomId = params.id;
  if (!paycomId) {
    throw new PaymeRpcException(PaymeError.TransactionNotFound, MSG_TRANSACTION_NOT_FOUND);
  }

  return prisma.$transaction(async (tx) => {
    const trx = await tx.paymeTransaction.findUnique({ where: { paycomId } });
    if (!trx) {
      throw new PaymeRpcException(PaymeError.TransactionNotFound, MSG_TRANSACTION_NOT_FOUND);
    }

    // Idempotent: allaqachon bajarilgan bo'lsa shu javobni qaytaramiz.
    if (trx.state === PaymeState.Performed) {
      return {
        transaction: String(trx.id),
        perform_time: Number(trx.performTime),
        state: trx.state,
      };
    }

    if (trx.state !== PaymeState.Created) {
      throw new PaymeRpcException(PaymeError.UnableToPerform, MSG_UNABLE_TO_PERFORM);
    }

    const performTime = nowMs();

    // Tranzaksiyani bajarilgan qilamiz.
    const updated = await tx.paymeTransaction.update({
      where: { id: trx.id },
      data: { state: PaymeState.Performed, performTime: BigInt(performTime) },
    });

    // Obunani faollashtirish — gating'ni ochadi.
    if (trx.subscriptionId) {
      const subscription = await tx.subscription.findUnique({
        where: { id: trx.subscriptionId },
        include: { plan: true },
      });
      if (subscription) {
        const startAt = new Date(performTime);
        const endAt = new Date(performTime + subscription.plan.durationDays * 24 * 60 * 60 * 1000);
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { status: 'active', startAt, endAt },
        });
        await tx.company.update({
          where: { id: subscription.companyId },
          data: { status: 'active' },
        });
      }
    }

    return {
      transaction: String(updated.id),
      perform_time: Number(updated.performTime),
      state: updated.state,
    };
  });
}

// CancelTransaction
export async function cancelTransaction(params: PaymeParams): Promise<PaymeRpcResult> {
  const paycomId = params.id;
  if (!paycomId) {
    throw new PaymeRpcException(PaymeError.TransactionNotFound, MSG_TRANSACTION_NOT_FOUND);
  }

  return prisma.$transaction(async (tx) => {
    const trx = await tx.paymeTransaction.findUnique({ where: { paycomId } });
    if (!trx) {
      throw new PaymeRpcException(PaymeError.TransactionNotFound, MSG_TRANSACTION_NOT_FOUND);
    }

    // Idempotent: allaqachon bekor qilingan.
    if (trx.state === PaymeState.CancelledBeforePerform || trx.state === PaymeState.CancelledAfterPerform) {
      return {
        transaction: String(trx.id),
        cancel_time: Number(trx.cancelTime),
        state: trx.state,
      };
    }

    const cancelTime = nowMs();
    // state=1 -> -1 ; state=2 -> -2
    const newState =
      trx.state === PaymeState.Performed
        ? PaymeState.CancelledAfterPerform
        : PaymeState.CancelledBeforePerform;

    const updated = await tx.paymeTransaction.update({
      where: { id: trx.id },
      data: {
        state: newState,
        cancelTime: BigInt(cancelTime),
        reason: params.reason ?? null,
      },
    });

    // Bajarilgan to'lov bekor qilinsa — faol obunani 'cancelled' qilamiz.
    if (trx.state === PaymeState.Performed && trx.subscriptionId) {
      const subscription = await tx.subscription.findUnique({ where: { id: trx.subscriptionId } });
      if (subscription && subscription.status === 'active') {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { status: 'cancelled' },
        });
        await tx.company.update({
          where: { id: subscription.companyId },
          data: { status: 'suspended' },
        });
      }
    }

    return {
      transaction: String(updated.id),
      cancel_time: Number(updated.cancelTime),
      state: updated.state,
    };
  });
}

// CheckTransaction
export async function checkTransaction(params: PaymeParams): Promise<PaymeRpcResult> {
  const paycomId = params.id;
  const trx = paycomId
    ? await prisma.paymeTransaction.findUnique({ where: { paycomId } })
    : null;
  if (!trx) {
    throw new PaymeRpcException(PaymeError.TransactionNotFound, MSG_TRANSACTION_NOT_FOUND);
  }
  return {
    create_time: Number(trx.createTime),
    perform_time: Number(trx.performTime),
    cancel_time: Number(trx.cancelTime),
    transaction: String(trx.id),
    state: trx.state,
    reason: trx.reason ?? null,
  };
}

// GetStatement — from..to oralig'idagi tranzaksiyalar (createTime bo'yicha).
export async function getStatement(params: PaymeParams): Promise<PaymeRpcResult> {
  const from = BigInt(params.from ?? 0);
  const to = BigInt(params.to ?? nowMs());

  const rows = await prisma.paymeTransaction.findMany({
    where: { createTime: { gte: from, lte: to } },
    orderBy: { createTime: 'asc' },
  });

  const transactions = rows.map((t) => ({
    id: t.paycomId,
    time: Number(t.createTime),
    amount: Number(t.amount),
    account: t.account ?? {},
    create_time: Number(t.createTime),
    perform_time: Number(t.performTime),
    cancel_time: Number(t.cancelTime),
    transaction: String(t.id),
    state: t.state,
    reason: t.reason ?? null,
  }));

  return { transactions };
}
