import { z } from 'zod';

// Plan.price Decimal — string yoki number ko'rinishida kelishi mumkin, string'ga normalizatsiya qilamiz.
const decimalInput = z.union([z.string(), z.number()]).transform((v) => String(v));

// Chegirma foizi: 0-90 butun (uzoq muddat uchun).
const discountPercent = z.coerce.number().int().min(0).max(90);

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
  // Uzoq muddat chegirmalari (%) — ixtiyoriy, default 0.
  discount_3: discountPercent.optional(),
  discount_6: discountPercent.optional(),
  discount_12: discountPercent.optional(),
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
  discount_3: discountPercent.optional(),
  discount_6: discountPercent.optional(),
  discount_12: discountPercent.optional(),
  features: z.unknown().optional(),
  max_stores: z.number().int().nonnegative().nullable().optional(),
  max_users: z.number().int().nonnegative().nullable().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

export type PlanCreateInput = z.infer<typeof planCreateSchema>;
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;
