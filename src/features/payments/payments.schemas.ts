import { z } from 'zod';

// Payme JSON-RPC so'rov konverti. Validatsiya yumshoq — noto'g'ri bo'lsa
// route ichida -32600 (invalid request) qaytariladi.
export const paymeRpcRequestSchema = z.object({
  jsonrpc: z.string().optional(),
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  method: z.string(),
  params: z
    .object({
      id: z.string().optional(),
      time: z.number().optional(),
      amount: z.number().optional(),
      account: z.record(z.union([z.string(), z.number()])).optional(),
      reason: z.number().optional(),
      from: z.number().optional(),
      to: z.number().optional(),
    })
    .optional(),
});

export type PaymeRpcRequestInput = z.infer<typeof paymeRpcRequestSchema>;

// ─────────── SetFiscalData (Merchant API) — fiskal chek DTO ───────────
// Payme fiskallashtirishdan so'ng webhookga yuboradi. Rasmiy maydonlar:
//   params.id (String), params.type (PERFORM|CANCEL),
//   params.fiscal_data { receipt_id, status_code, message, terminal_id,
//                        fiscal_sign, qr_code_url, date }
// receipt_id turi hujjatda Merchant'da String, Subscribe'da Number — union.
const strOrNum = z.union([z.string(), z.number()]).transform((v) => String(v));

export const fiscalDataSchema = z.object({
  receipt_id: strOrNum.optional(),
  status_code: z.number().optional(),
  message: z.string().optional(),
  terminal_id: strOrNum.optional(),
  fiscal_sign: strOrNum.optional(),
  qr_code_url: z.string().optional(),
  date: strOrNum.optional(),
}).passthrough();

export const setFiscalDataSchema = z.object({
  id: strOrNum,
  // type: Merchant API `SetFiscalData` 'PERFORM'|'CANCEL' yuboradi. Subscribe API
  // `receipts.set_fiscal_data` esa `type` YUBORMASLIGI mumkin. Shuning uchun bardoshli:
  // 'CANCEL' (yoki 'REVERSE') bo'lsa — CANCEL; aks holda (yo'q/'PERFORM'/'PAY'/boshqa) — PERFORM.
  type: z.preprocess((v) => {
    const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
    return s === 'CANCEL' || s === 'REVERSE' ? 'CANCEL' : 'PERFORM';
  }, z.enum(['PERFORM', 'CANCEL'])),
  fiscal_data: fiscalDataSchema,
});

export type FiscalDataInput = z.infer<typeof fiscalDataSchema>;
export type SetFiscalDataInput = z.infer<typeof setFiscalDataSchema>;

// ─────────── Subscribe API (karta orqali to'lov) input sxemalari ───────────
export const cardCreateSchema = z.object({
  // Karta raqami (16 raqam; probel/chiziqlar olib tashlanadi)
  number: z.string().transform((s) => s.replace(/\D/g, '')).pipe(z.string().min(16).max(20)),
  // Amal qilish muddati MMYY (masalan "0399")
  expire: z.string().transform((s) => s.replace(/\D/g, '')).pipe(z.string().length(4)),
  save: z.boolean().optional(),
});

export const cardVerifySchema = z.object({
  token: z.string().min(1),
  code: z.string().transform((s) => s.replace(/\D/g, '')).pipe(z.string().min(4).max(8)),
});

export const subscribePaySchema = z.object({
  subscription_id: z.number().int().positive(),
  token: z.string().min(1),
});
