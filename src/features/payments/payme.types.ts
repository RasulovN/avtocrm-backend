// Payme Merchant API (JSON-RPC 2.0) tip ta'riflari.

// Tranzaksiya holatlari (PaymeTransaction.state).
export const PaymeState = {
  Created: 1, // yaratilgan
  Performed: 2, // bajarilgan
  CancelledBeforePerform: -1, // perform oldidan bekor qilingan
  CancelledAfterPerform: -2, // perform keyin bekor qilingan
} as const;

// Payme JSON-RPC error kodlari.
export const PaymeError = {
  // Tizim xatolari
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  // Auth
  InsufficientPrivileges: -32504,
  // Biznes xatolar
  WrongAmount: -31001,
  TransactionNotFound: -31003,
  UnableToPerform: -31008,
  // Account xatolari (-31050..-31099)
  AccountNotFound: -31050, // hisob/obuna topilmadi (Не существует)
  AccountBlocked: -31051, // hisob bloklangan: allaqachon to'langan/bekor (Заблокирован)
  AccountBusy: -31052, // hisobni boshqa tranzaksiya band qilgan (Обрабатывается)
  AccountGeneric: -31099,
} as const;

// Ko'p tilli xabar (Payme talabi: ru/uz/en).
export interface PaymeMessage {
  ru: string;
  uz: string;
  en: string;
}

export interface PaymeRpcError {
  code: number;
  message: PaymeMessage;
  data?: string;
}

// Kiruvchi JSON-RPC so'rov.
export interface PaymeRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: PaymeParams;
}

export interface PaymeParams {
  id?: string; // Payme tranzaksiya id (paycomId)
  time?: number; // ms
  amount?: number; // tiyin
  account?: Record<string, string | number | undefined>;
  reason?: number;
  from?: number; // ms (GetStatement)
  to?: number; // ms (GetStatement)
}

export type PaymeRpcResult = Record<string, unknown>;

// Chiquvchi JSON-RPC javob (har doim HTTP 200).
export interface PaymeRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: PaymeRpcResult;
  error?: PaymeRpcError;
}

// Handler ichida tashlanadigan biznes xato.
export class PaymeRpcException extends Error {
  code: number;
  rpcMessage: PaymeMessage;
  data?: string;

  constructor(code: number, message: PaymeMessage, data?: string) {
    super(message.en);
    this.code = code;
    this.rpcMessage = message;
    this.data = data;
  }
}
