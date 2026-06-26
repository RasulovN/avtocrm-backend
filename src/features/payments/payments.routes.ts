import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
  // Asosiy yoki test kalit qabul qilinadi.
  return password === env.PAYME_KEY || (env.PAYME_TEST_KEY !== '' && password === env.PAYME_TEST_KEY);
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

export async function paymentsRoutes(app: FastifyInstance) {
  // POST /payme/ — Payme Merchant API webhook (JSON-RPC 2.0).
  // MUHIM: bu yerda bizning standart error formati EMAS, Payme JSON-RPC formati ishlatiladi.
  app.post('/payme/', async (req, reply) => {
    const rawBody = req.body as { id?: number | string | null } | undefined;
    const reqId: number | string | null = rawBody?.id ?? null;

    // 1) Auth
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
      // Kutilmagan xato -> internal (-32400 emas, log + umumiy javob)
      req.log.error(err);
      return rpcError(reply, reqId, PaymeError.UnableToPerform, INTERNAL_MSG);
    }
  });
}
