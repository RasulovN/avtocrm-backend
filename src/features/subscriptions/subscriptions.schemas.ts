import { z } from 'zod';

// Oldindan to'lash mumkin bo'lgan oylar (1 oy asosiy + 3/6/12 oy oldindan).
export const ALLOWED_MONTHS = [1, 3, 6, 12] as const;

// POST / — kompaniya obuna yaratadi (tarif + necha oyga to'lashni tanlaydi).
// months: 1 | 3 | 6 | 12 (default 1). Bepul tarif uchun e'tiborga olinmaydi (har doim 1).
export const subscriptionCreateSchema = z.object({
  plan_id: z.number().int().positive(),
  months: z
    .number()
    .int()
    .refine((m) => (ALLOWED_MONTHS as readonly number[]).includes(m), {
      message: 'months faqat 1, 3, 6 yoki 12 bo\'lishi mumkin',
    })
    .optional(),
});

// PATCH /:id/ — super admin qo'lda status o'zgartiradi yoki muddatni uzaytiradi.
export const subscriptionPatchSchema = z.object({
  action: z.enum(['activate', 'cancel', 'extend']),
  days: z.number().int().positive().optional(), // extend uchun (bo'sh bo'lsa tarif muddati)
});

export type SubscriptionCreateInput = z.infer<typeof subscriptionCreateSchema>;
export type SubscriptionPatchInput = z.infer<typeof subscriptionPatchSchema>;
