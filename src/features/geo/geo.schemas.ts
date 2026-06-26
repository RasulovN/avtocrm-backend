import { z } from 'zod';

// 4 til: name (uz lotin, majburiy) + name_uz_cyrl (kirill) + name_ru + name_en (ixtiyoriy)
const i18nName = {
  name: z.string().min(1).max(150),
  name_uz_cyrl: z.string().max(150).nullish(),
  name_ru: z.string().max(150).nullish(),
  name_en: z.string().max(150).nullish(),
};
const i18nNameOptional = {
  name: z.string().min(1).max(150).optional(),
  name_uz_cyrl: z.string().max(150).nullish(),
  name_ru: z.string().max(150).nullish(),
  name_en: z.string().max(150).nullish(),
};

// ── Country ───────────────────────────────────────────────
export const countryCreateSchema = z.object({
  ...i18nName,
  code: z.string().max(5).nullish(),
  is_active: z.boolean().optional(),
});

export const countryUpdateSchema = z.object({
  ...i18nNameOptional,
  code: z.string().max(5).nullish(),
  is_active: z.boolean().optional(),
});

// ── Region ────────────────────────────────────────────────
export const regionCreateSchema = z.object({
  ...i18nName,
  country_id: z.coerce.number().int().positive(),
  is_active: z.boolean().optional(),
});

export const regionUpdateSchema = z.object({
  ...i18nNameOptional,
  country_id: z.coerce.number().int().positive().optional(),
  is_active: z.boolean().optional(),
});

// ── District ──────────────────────────────────────────────
export const districtCreateSchema = z.object({
  ...i18nName,
  region_id: z.coerce.number().int().positive(),
  is_active: z.boolean().optional(),
});

export const districtUpdateSchema = z.object({
  ...i18nNameOptional,
  region_id: z.coerce.number().int().positive().optional(),
  is_active: z.boolean().optional(),
});

export type CountryCreateInput = z.infer<typeof countryCreateSchema>;
export type CountryUpdateInput = z.infer<typeof countryUpdateSchema>;
export type RegionCreateInput = z.infer<typeof regionCreateSchema>;
export type RegionUpdateInput = z.infer<typeof regionUpdateSchema>;
export type DistrictCreateInput = z.infer<typeof districtCreateSchema>;
export type DistrictUpdateInput = z.infer<typeof districtUpdateSchema>;
