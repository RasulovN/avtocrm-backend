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
