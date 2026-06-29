import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import { env } from '../../config/env.js';
import {
  PaymeError,
  PaymeRpcException,
  type PaymeParams,
  type PaymeRpcResponse,
  type PaymeRpcResult,
} from './payme.types.js';
import { paymeRpcRequestSchema } from './payments.schemas.js';
import {
  checkPerformTransaction,
  createTransaction,
  performTransaction,
  cancelTransaction,
  checkTransaction,
  getStatement,
} from './payme.service.js';

// ─────────────────────────────────────────────
// Basic-auth tekshiruvi: Authorization: Basic base64("Paycom:" + PAYME_KEY)
// ─────────────────────────────────────────────
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
  // Sandbox test_key, production esa key bilan imzolaydi. Nomuvofiq rejim/konfiguratsiya
  // tufayli bloklanmaslik uchun sozlangan ISTALGAN kalitni qabul qilamiz (faol/prod/test).
  const keys = [env.PAYME_ACTIVE_KEY, env.PAYME_KEY, env.PAYME_TEST_KEY].filter(Boolean);
  const ok = keys.includes(password);
  if (!ok) {
    // Diagnostika: maxfiy kalitni oshkor qilmasdan — uzunlik va oxirgi 3 belgi.
    const tail = (s: string) => (s ? s.slice(-3) : '∅');
    req.log.warn(
      {
        recvLen: password.length,
        recvTail: tail(password),
        keyTails: keys.map(tail),
        testMode: env.PAYME_TEST_MODE,
      },
      'Payme webhook: kalit mos kelmadi (Authorization). .env dagi PAYME_TEST_KEY/PAYME_KEY ni tekshiring.',
    );
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

// /api ostidagi route: POST /api/payments/payme/
export async function paymentsRoutes(app: FastifyInstance) {
  app.post('/payme/', paymeWebhookHandler);
}

// Ildiz route: POST /payme/webhook — Payme kabinetida ko'rsatilgan webhook manzili
// (https://zumex.uz/payme/webhook). /api prefiksisiz alohida ro'yxatdan o'tkaziladi.
export async function paymeWebhookRoutes(app: FastifyInstance) {
  app.post('/payme/webhook', paymeWebhookHandler);
}
