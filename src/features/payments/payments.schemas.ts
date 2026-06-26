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
