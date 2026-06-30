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
import { computeActivationWindow } from '../subscriptions/subscription.window.js';

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
const MSG_ACCOUNT_BLOCKED = msg(
  'Счёт уже оплачен или отменён',
  "Hisob allaqachon to'langan yoki bekor qilingan",
  'Account already paid or cancelled',
);
const MSG_ACCOUNT_BUSY = msg(
  'Счёт занят другой транзакцией',
  'Hisobni boshqa tranzaksiya band qilgan',
  'Account is busy with another transaction',
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
  // Payme GET checkout: base64("m=...;ac.<field>=<id>;a=<tiyin>[;c=<callback>];cr=860;l=uz")
  // cr=860 -> UZS, l=uz -> til. c (callback) faqat PUBLIC https domen bo'lsa qo'shiladi:
  // Payme checkout localhost/http callback'ni rad etib, sahifani ochmasligi mumkin.
  const fe = env.FRONTEND_URL.replace(/\/+$/, '');
  const isPublicHttps = /^https:\/\//i.test(fe) && !/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(fe);
  const parts = [`m=${env.PAYME_MERCHANT_ID}`, `ac.${field}=${subscription.id}`, `a=${amountTiyin}`];
  if (isPublicHttps) parts.push(`c=${fe}/uz/subscription`);
  parts.push('cr=860', 'l=uz');
  const encoded = Buffer.from(parts.join(';'), 'utf8').toString('base64');
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

// Bir martalik hisob (one-time) mantiqi (Payme sandbox spetsifikatsiyasiga mos):
//  - Не существует   -> AccountNotFound  (-31050)
//  - Заблокирован    -> AccountBlocked   (-31051)  (obuna allaqachon to'langan/bekor)
//  - Обрабатывается  -> AccountBusy      (-31052)  (boshqa tranzaksiya band qilgan)
//  - Ожидает оплаты  -> ruxsat (keyin amount tekshiriladi; xato bo'lsa -31001)
// `excludePaycomId` — CreateTransaction'da joriy tranzaksiyani "band" hisobidan chiqaradi.
async function assertCanPerform(params: PaymeParams, excludePaycomId?: string) {
  const field = env.PAYME_ACCOUNT_FIELD;
  const subscription = await findSubscriptionOrThrow(params);

  // Bloklangan: obuna pending emas (allaqachon active/expired/cancelled).
  if (subscription.status !== 'pending') {
    throw new PaymeRpcException(PaymeError.AccountBlocked, MSG_ACCOUNT_BLOCKED, field);
  }

  // Shu obunaga tegishli mavjud tranzaksiyalar.
  const txs = await prisma.paymeTransaction.findMany({
    where: { subscriptionId: subscription.id },
    select: { paycomId: true, state: true },
  });
  // Allaqachon bajarilgan tranzaksiya bo'lsa — bloklangan.
  if (txs.some((t) => t.state === PaymeState.Performed)) {
    throw new PaymeRpcException(PaymeError.AccountBlocked, MSG_ACCOUNT_BLOCKED, field);
  }
  // Boshqa (joriy emas) ochiq tranzaksiya band qilgan bo'lsa — busy.
  if (txs.some((t) => t.state === PaymeState.Created && t.paycomId !== excludePaycomId)) {
    throw new PaymeRpcException(PaymeError.AccountBusy, MSG_ACCOUNT_BUSY, field);
  }

  // Hisob to'g'ri — endi summa tekshiriladi.
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

  // Yangi tranzaksiya — qayta tekshiramiz (joriy id "band" hisobidan chiqariladi).
  const { subscription, expectedTiyin } = await assertCanPerform(params, paycomId);
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

  let activatedSubId: number | null = null;

  const result = await prisma.$transaction(async (tx) => {
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
        // Oldindan to'langan oylar (periodMonths) + muddatni uzaytirish hisobga olinadi.
        const { startAt, endAt } = await computeActivationWindow(
          tx,
          subscription,
          new Date(performTime),
        );
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { status: 'active', startAt, endAt },
        });
        await tx.company.update({
          where: { id: subscription.companyId },
          data: { status: 'active' },
        });
        activatedSubId = subscription.id;
      }
    }

    return {
      transaction: String(updated.id),
      perform_time: Number(updated.performTime),
      state: updated.state,
    };
  });

  // Tranzaksiya muvaffaqiyatli yakunlangach — kompaniyaga bildirishnoma + email.
  // Dinamik import: aylanma bog'liqlikdan qochish (subscriptions <-> payme).
  if (activatedSubId) {
    try {
      const { notifySubscriptionEvent } = await import('../subscriptions/subscriptions.service.js');
      await notifySubscriptionEvent(activatedSubId, true);
    } catch { /* bildirishnoma xato bo'lsa ham to'lov muhim */ }
  }

  return result;
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
