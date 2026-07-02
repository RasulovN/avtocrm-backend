import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import {
  PaymeError,
  PaymeRpcException,
  type PaymeParams,
  type PaymeRpcResponse,
  type PaymeRpcResult,
} from './payme.types.js';
import {
  paymeRpcRequestSchema,
  setFiscalDataSchema,
  cardCreateSchema,
  cardVerifySchema,
  subscribePaySchema,
} from './payments.schemas.js';
import {
  checkPerformTransaction,
  createTransaction,
  performTransaction,
  cancelTransaction,
  checkTransaction,
  getStatement,
} from './payme.service.js';
import { handleSetFiscalData } from './payme.fiscal.service.js';
import {
  cardsCreate,
  cardsGetVerifyCode,
  cardsVerify,
  payForSubscription,
  SubscribeError,
} from './subscribe.service.js';
import { serializeSubscription } from '../subscriptions/subscriptions.service.js';
import { rateLimit } from '../../plugins/rateLimit.js';

// ─────────────────────────────────────────────
// Basic-auth tekshiruvi: Authorization: Basic base64("Paycom:" + PAYME_KEY)
// ─────────────────────────────────────────────
// Ikki maxfiy qatorni doimiy vaqtda solishtirish (timing attack'ga qarshi).
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function isAuthorized(req: FastifyRequest): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  const login = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  if (login !== 'Paycom') return false;
  // FAQAT amaldagi rejimga mos kalit qabul qilinadi (PAYME_ACTIVE_KEY).
  // Production'da sandbox test kalitini QABUL QILMAYMIZ — aks holda ma'lum test
  // kalit bilan haqiqiy to'lovsiz obuna faollashtirish (firibgarlik) mumkin bo'lardi.
  const expected = env.PAYME_ACTIVE_KEY;
  if (!expected) {
    req.log.error('Payme webhook: PAYME_ACTIVE_KEY sozlanmagan — barcha so\'rovlar rad etiladi.');
    return false;
  }
  const ok = safeEqual(password, expected);
  if (!ok) {
    // Maxfiy ma'lumotsiz diagnostika.
    req.log.warn({ testMode: env.PAYME_TEST_MODE }, 'Payme webhook: Authorization kaliti mos kelmadi.');
  }
  return ok;
}

// ─────────────────────────────────────────────
// IP whitelist: PAYME_ALLOWED_IPS bo'sh bo'lsa — barchasi ruxsat.
// Aks holda mijoz IP'si ro'yxatdagi IP yoki CIDR (IPv4) bilan mos kelishi kerak.
// nginx orqasida real IP X-Forwarded-For'dan keladi (app trustProxy:true).
// ─────────────────────────────────────────────
function ipv4ToLong(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

function ipMatches(clientIp: string, entry: string): boolean {
  if (entry.includes('/')) {
    const [base, bitsStr] = entry.split('/');
    const bits = Number(bitsStr);
    const b = ipv4ToLong(base);
    const c = ipv4ToLong(clientIp);
    if (b === null || c === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (b & mask) >>> 0 === (c & mask) >>> 0;
  }
  return clientIp === entry;
}

function isIpAllowed(req: FastifyRequest): boolean {
  const list = env.PAYME_ALLOWED_IPS;
  if (!list.length) return true;
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) -> 1.2.3.4
  const raw = req.ip ?? '';
  const clientIp = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  return list.some((entry) => ipMatches(clientIp, entry));
}

// JSON-RPC error javobi (har doim HTTP 200).
function rpcError(
  reply: FastifyReply,
  id: number | string | null,
  code: number,
  message: { ru: string; uz: string; en: string },
  data?: string,
): FastifyReply {
  const body: PaymeRpcResponse = {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
  return reply.status(200).send(body);
}

// JSON-RPC muvaffaqiyatli javob.
function rpcResult(
  reply: FastifyReply,
  id: number | string | null,
  result: PaymeRpcResult,
): FastifyReply {
  const body: PaymeRpcResponse = { jsonrpc: '2.0', id, result };
  return reply.status(200).send(body);
}

const NOT_AUTH_MSG = {
  ru: 'Недостаточно привилегий для выполнения метода',
  uz: 'Metodni bajarish uchun yetarli huquq yo\'q',
  en: 'Insufficient privileges to perform the method',
};
const METHOD_NOT_FOUND_MSG = {
  ru: 'Запрашиваемый метод не найден',
  uz: 'So\'ralgan metod topilmadi',
  en: 'Requested method not found',
};
const INVALID_REQUEST_MSG = {
  ru: 'Неверный запрос',
  uz: 'Noto\'g\'ri so\'rov',
  en: 'Invalid request',
};
const INTERNAL_MSG = {
  ru: 'Внутренняя ошибка сервера',
  uz: 'Server ichki xatosi',
  en: 'Internal server error',
};

// Payme Merchant API webhook handler (JSON-RPC 2.0).
// MUHIM: bu yerda bizning standart error formati EMAS, Payme JSON-RPC formati ishlatiladi.
// Har doim HTTP 200 qaytaradi — xatolar ham JSON-RPC `error` sifatida.
const paymeWebhookHandler: RouteHandlerMethod = async (req, reply) => {
  const rawBody = req.body as { id?: number | string | null } | undefined;
  const reqId: number | string | null = rawBody?.id ?? null;

  // 0) IP whitelist (PAYME_ALLOWED_IPS bo'sh bo'lsa — o'tkazib yuboriladi)
  if (!isIpAllowed(req)) {
    req.log.warn({ ip: req.ip }, 'Payme webhook: ruxsat etilmagan IP');
    return rpcError(reply, reqId, PaymeError.InsufficientPrivileges, NOT_AUTH_MSG);
  }

  // 1) Auth: Authorization: Basic base64("Paycom:" + faol kalit)
  if (!isAuthorized(req)) {
    return rpcError(reply, reqId, PaymeError.InsufficientPrivileges, NOT_AUTH_MSG);
  }

  // 2) So'rov konvertini validatsiya qilamiz
  const parsed = paymeRpcRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return rpcError(reply, reqId, PaymeError.InvalidRequest, INVALID_REQUEST_MSG);
  }
  const { method, params } = parsed.data;
  const p = (params ?? {}) as PaymeParams;

  // 3) Metodni dispatch qilamiz
  try {
    let result: PaymeRpcResult;
    switch (method) {
      case 'CheckPerformTransaction':
        result = await checkPerformTransaction(p);
        break;
      case 'CreateTransaction':
        result = await createTransaction(p);
        break;
      case 'PerformTransaction':
        result = await performTransaction(p);
        break;
      case 'CancelTransaction':
        result = await cancelTransaction(p);
        break;
      case 'CheckTransaction':
        result = await checkTransaction(p);
        break;
      case 'GetStatement':
        result = await getStatement(p);
        break;
      // Merchant API: `SetFiscalData`. Subscribe API (karta oqimi): `receipts.set_fiscal_data`.
      // Ikkalasi ham Payme -> bizga fiskal (Soliq/OFD) chekni yuboradi; bir xil handler.
      case 'SetFiscalData':
      case 'receipts.set_fiscal_data': {
        // Fiskal chek — params `fiscal_data` bilan keladi, shuning uchun
        // umumiy sxema emas, maxsus DTO bilan parse qilamiz.
        const rawParams = (req.body as { params?: unknown }).params;
        const fiscalParsed = setFiscalDataSchema.safeParse(rawParams);
        if (!fiscalParsed.success) {
          return rpcError(reply, reqId, PaymeError.InvalidRequest, INVALID_REQUEST_MSG);
        }
        const res = await handleSetFiscalData(fiscalParsed.data);
        req.log.info(
          { setFiscalData: { method, type: res.type, subscriptionId: res.subscriptionId, matched: res.matchedTransaction } },
          'Payme fiskal chek qabul qilindi va saqlandi',
        );
        result = { success: true };
        break;
      }
      default:
        return rpcError(reply, reqId, PaymeError.MethodNotFound, METHOD_NOT_FOUND_MSG);
    }
    return rpcResult(reply, reqId, result);
  } catch (err) {
    // Biznes xatolar -> JSON-RPC error
    if (err instanceof PaymeRpcException) {
      return rpcError(reply, reqId, err.code, err.rpcMessage, err.data);
    }
    // Kutilmagan xato -> internal (log + umumiy javob)
    req.log.error(err);
    return rpcError(reply, reqId, PaymeError.UnableToPerform, INTERNAL_MSG);
  }
};

// SubscribeError -> 400 JSON (frontend uchun {detail}).
function sendSubscribeError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof SubscribeError) {
    return reply.status(400).send({ detail: err.message, code: err.code });
  }
  throw err; // boshqa xatolar -> global errorHandler
}

// /api ostidagi route'lar (prefix: /payments)
export async function paymentsRoutes(app: FastifyInstance) {
  // Merchant API webhook (eski yo'l, orqaga moslik): POST /api/payments/payme/
  app.post('/payme/', paymeWebhookHandler);

  // ── Subscribe API (karta orqali to'lov) — kompaniya tomoni ──

  // Frontend uchun ochiq config (merchant_id maxfiy emas).
  app.get('/config', { onRequest: app.requireCompany }, async () => ({
    merchant_id: env.PAYME_MERCHANT_ID,
    test_mode: env.PAYME_TEST_MODE,
    account_field: env.PAYME_ACCOUNT_FIELD,
  }));

  const guard = { onRequest: [app.requireCompany, app.requirePermission('company.subscription.manage')] };
  // Karta/OTP endpointlari uchun qo'shimcha rate-limit (brute-force'ga qarshi).
  const cardGuard = {
    onRequest: [
      rateLimit({ name: 'card-create', max: 15, windowMs: 15 * 60_000 }),
      app.requireCompany,
      app.requirePermission('company.subscription.manage'),
    ],
  };
  const verifyGuard = {
    onRequest: [
      rateLimit({ name: 'card-verify', max: 10, windowMs: 15 * 60_000 }),
      app.requireCompany,
      app.requirePermission('company.subscription.manage'),
    ],
  };

  // 1) Karta tokenizatsiyasi + OTP yuborish.
  app.post('/card/create', cardGuard, async (req, reply) => {
    const body = cardCreateSchema.parse(req.body);
    try {
      const created = await cardsCreate(body.number, body.expire, body.save ?? false);
      const card = created.card;
      // Karta allaqachon tasdiqlangan bo'lsa OTP shart emas.
      if (card.verify) {
        return { token: card.token, need_verify: false, number: card.number, expire: card.expire };
      }
      const code = await cardsGetVerifyCode(card.token);
      return {
        token: card.token,
        need_verify: true,
        number: card.number,
        expire: card.expire,
        phone: code.phone,
        wait: code.wait,
      };
    } catch (err) {
      return sendSubscribeError(reply, err);
    }
  });

  // 2) OTP tasdiqlash -> tasdiqlangan token qaytadi.
  app.post('/card/verify', verifyGuard, async (req, reply) => {
    const body = cardVerifySchema.parse(req.body);
    try {
      const verified = await cardsVerify(body.token, body.code);
      return { token: verified.card.token, verify: verified.card.verify };
    } catch (err) {
      return sendSubscribeError(reply, err);
    }
  });

  // 3) Token bilan to'lash -> obunani faollashtirish.
  app.post('/pay', guard, async (req, reply) => {
    const body = subscribePaySchema.parse(req.body);
    try {
      const sub = await payForSubscription(req.companyId!, body.subscription_id, body.token);
      return { success: true, subscription: sub ? serializeSubscription(sub) : null };
    } catch (err) {
      return sendSubscribeError(reply, err);
    }
  });
}

// Ildiz route: POST /payme/webhook — Payme kabinetida ko'rsatilgan webhook manzili
// (https://zumex.uz/payme/webhook). /api prefiksisiz alohida ro'yxatdan o'tkaziladi.
export async function paymeWebhookRoutes(app: FastifyInstance) {
  app.post('/payme/webhook', paymeWebhookHandler);
}
