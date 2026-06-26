import { z } from 'zod';

// POST / — kompaniya obuna yaratadi (tarif tanlaydi).
export const subscriptionCreateSchema = z.object({
  plan_id: z.number().int().positive(),
});

// PATCH /:id/ — super admin qo'lda status o'zgartiradi yoki muddatni uzaytiradi.
export const subscriptionPatchSchema = z.object({
  action: z.enum(['activate', 'cancel', 'extend']),
  days: z.number().int().positive().optional(), // extend uchun (bo'sh bo'lsa tarif muddati)
});

export type SubscriptionCreateInput = z.infer<typeof subscriptionCreateSchema>;
export type SubscriptionPatchInput = z.infer<typeof subscriptionPatchSchema>;
