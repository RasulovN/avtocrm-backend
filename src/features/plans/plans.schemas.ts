import { z } from 'zod';

// Plan.price Decimal — string yoki number ko'rinishida kelishi mumkin, string'ga normalizatsiya qilamiz.
const decimalInput = z.union([z.string(), z.number()]).transform((v) => String(v));

// POST / — tarif yaratish (super admin, 4 tilli)
export const planCreateSchema = z.object({
  name: z.string().min(1).max(100), // uz — asosiy, majburiy
  name_ru: z.string().max(100).nullish(),
  name_en: z.string().max(100).nullish(),
  name_uz_cyrl: z.string().max(100).nullish(),
  description: z.string().nullable().optional(),
  description_ru: z.string().nullish(),
  description_en: z.string().nullish(),
  description_uz_cyrl: z.string().nullish(),
  price: decimalInput,
  duration_days: z.number().int().positive(),
  features: z.unknown().optional(), // ixtiyoriy JSON
  max_stores: z.number().int().nonnegative().nullable().optional(),
  max_users: z.number().int().nonnegative().nullable().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

// PUT /:id/ — tarifni yangilash (barcha maydonlar ixtiyoriy)
export const planUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  name_ru: z.string().max(100).nullish(),
  name_en: z.string().max(100).nullish(),
  name_uz_cyrl: z.string().max(100).nullish(),
  description: z.string().nullable().optional(),
  description_ru: z.string().nullish(),
  description_en: z.string().nullish(),
  description_uz_cyrl: z.string().nullish(),
  price: decimalInput.optional(),
  duration_days: z.number().int().positive().optional(),
  features: z.unknown().optional(),
  max_stores: z.number().int().nonnegative().nullable().optional(),
  max_users: z.number().int().nonnegative().nullable().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export type PlanCreateInput = z.infer<typeof planCreateSchema>;
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;
