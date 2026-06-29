// Payme Subscribe API klienti (JSON-RPC) — biz Payme Business'ga so'rov yuboramiz.
// cards.* (tokenizatsiya, OTP) — X-Auth: <merchant_id>
// receipts.* (chek yaratish/to'lash) — X-Auth: <merchant_id>:<key>
// Hujjat: https://developer.help.paycom.uz (Subscribe API)
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { BadRequest } from '../../common/errors.js';
import { PaymeState } from './payme.types.js';

export class SubscribeError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

interface PaymeRpcEnvelope<T> {
  result?: T;
  error?: { code: number; message: string | { ru?: string; uz?: string; en?: string }; data?: unknown };
}

let rpcId = 1;

async function rpc<T = unknown>(method: string, params: unknown, useKey: boolean): Promise<T> {
  if (!env.PAYME_SUBSCRIBE_MERCHANT_ID) {
    throw new SubscribeError(-1, 'PAYME_SUBSCRIBE_MERCHANT_ID (yoki PAYME_MERCHANT_ID) sozlanmagan');
  }
  // cards.* (front-end) -> faqat id; receipts.* (back-end) -> id:key
  const xAuth = useKey
    ? `${env.PAYME_SUBSCRIBE_MERCHANT_ID}:${env.PAYME_SUBSCRIBE_KEY}`
    : env.PAYME_SUBSCRIBE_MERCHANT_ID;

  let json: PaymeRpcEnvelope<T>;
  let status = 0;
  let text = '';
  try {
    const res = await fetch(env.PAYME_SUBSCRIBE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth': xAuth, 'Cache-Control': 'no-cache' },
      body: JSON.stringify({ id: rpcId++, method, params }),
    });
    status = res.status;
    text = await res.text();
  } catch (e) {
    throw new SubscribeError(-1, `Payme'ga ulanib bo'lmadi (${env.PAYME_SUBSCRIBE_URL}): ${(e as Error).message}`);
  }
  // Payme JSON emas (masalan HTML xato sahifasi) qaytarsa — tushunarli xabar.
  try {
    json = JSON.parse(text) as PaymeRpcEnvelope<T>;
  } catch {
    // 5xx gateway xatolari -> Payme tomonidagi vaqtinchalik nosozlik (kod/credential aybi emas).
    if (status >= 502 && status <= 504) {
      throw new SubscribeError(
        status,
        `Payme Subscribe serveri vaqtincha ishlamayapti (HTTP ${status}, ${env.PAYME_SUBSCRIBE_URL}). ` +
          `Bu Payme tomonidagi muammo — birozdan keyin qayta urinib ko'ring.`,
      );
    }
    const snippet = text.replace(/\s+/g, ' ').slice(0, 140);
    throw new SubscribeError(
      status || -1,
      `Payme Subscribe endpoint JSON emas javob qaytardi (HTTP ${status}, ${env.PAYME_SUBSCRIBE_URL}). ` +
        `Subscribe API "Виртуальный терминал" kassasi/credential ni tekshiring. Javob: ${snippet}`,
    );
  }

  if (json?.error) {
    const m = json.error.message;
    const text = typeof m === 'string' ? m : m?.uz || m?.ru || m?.en || 'Payme xatosi';
    throw new SubscribeError(json.error.code ?? -1, text, json.error.data);
  }
  return json.result as T;
}

// ─────────── cards.* (front-end metodlar, faqat merchant_id) ───────────
interface CardObj {
  number: string;
  expire: string;
  token: string;
  recurrent: boolean;
  verify: boolean;
}
export const cardsCreate = (number: string, expire: string, save = false) =>
  rpc<{ card: CardObj }>('cards.create', { card: { number, expire }, save }, false);
export const cardsGetVerifyCode = (token: string) =>
  rpc<{ sent: boolean; phone: string; wait: number }>('cards.get_verify_code', { token }, false);
export const cardsVerify = (token: string, code: string) =>
  rpc<{ card: CardObj }>('cards.verify', { token, code }, false);

// ─────────── receipts.* (back-end metodlar, merchant_id:key) ───────────
interface ReceiptObj {
  _id: string;
  state: number;
  amount: number;
}
export const receiptsCreate = (amount: number, account: Record<string, unknown>) =>
  rpc<{ receipt: ReceiptObj }>('receipts.create', { amount, account }, true);
export const receiptsPay = (id: string, token: string) =>
  rpc<{ receipt: ReceiptObj }>('receipts.pay', { id, token }, true);

// ─────────────────────────────────────────────
// Obunani karta tokeni bilan to'lash + faollashtirish.
// `token` — cards.verify dan qaytgan TASDIQLANGAN token.
// ─────────────────────────────────────────────
export async function payForSubscription(companyId: number, subscriptionId: number, token: string) {
  const subscription = await prisma.subscription.findFirst({
    where: { id: subscriptionId, companyId },
    include: { plan: true },
  });
  if (!subscription) throw new BadRequest({ detail: 'Obuna topilmadi.' });
  if (subscription.status !== 'pending') {
    throw new BadRequest({ detail: 'Obuna allaqachon faollashtirilgan yoki bekor qilingan.' });
  }
  const amountTiyin = Math.round(Number(subscription.amount) * 100);
  if (amountTiyin <= 0) throw new BadRequest({ detail: "Bepul tarif uchun karta to'lovi shart emas." });

  const account = { [env.PAYME_ACCOUNT_FIELD]: String(subscription.id) };

  // 1) Chek yaratish
  const created = await receiptsCreate(amountTiyin, account);
  const receiptId = created?.receipt?._id;
  if (!receiptId) throw new SubscribeError(-1, 'Chek yaratilmadi');

  // 2) Token bilan to'lash (xato bo'lsa SubscribeError tashlanadi)
  await receiptsPay(receiptId, token);

  // 3) Tranzaksiya yozuvi + obuna/kompaniyani faollashtirish (atomik)
  const performTime = Date.now();
  await prisma.$transaction(async (tx) => {
    await tx.paymeTransaction.upsert({
      where: { paycomId: receiptId },
      update: { state: PaymeState.Performed, performTime: BigInt(performTime) },
      create: {
        paycomId: receiptId,
        subscriptionId: subscription.id,
        amount: String(amountTiyin),
        state: PaymeState.Performed,
        createTime: BigInt(performTime),
        performTime: BigInt(performTime),
        account: account as Prisma.InputJsonValue,
      },
    });
    const startAt = new Date(performTime);
    const endAt = new Date(performTime + subscription.plan.durationDays * 24 * 60 * 60 * 1000);
    await tx.subscription.update({ where: { id: subscription.id }, data: { status: 'active', startAt, endAt } });
    await tx.company.update({ where: { id: subscription.companyId }, data: { status: 'active' } });
  });

  // 4) Bildirishnoma + email (xato bo'lsa ham to'lov muhim)
  try {
    const { notifySubscriptionEvent } = await import('../subscriptions/subscriptions.service.js');
    await notifySubscriptionEvent(subscription.id, true);
  } catch { /* ignore */ }

  return prisma.subscription.findUnique({ where: { id: subscription.id }, include: { plan: true } });
}
