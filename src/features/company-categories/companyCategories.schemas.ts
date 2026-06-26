import { z } from 'zod';

// Super admin kategoriya yaratish (4 tilli)
export const categoryCreateSchema = z.object({
  name: z.string().min(1).max(150), // uz — asosiy, majburiy
  name_ru: z.string().max(150).nullish(),
  name_en: z.string().max(150).nullish(),
  name_uz_cyrl: z.string().max(150).nullish(),
  description: z.string().nullish(), // uz
  description_ru: z.string().nullish(),
  description_en: z.string().nullish(),
  description_uz_cyrl: z.string().nullish(),
  icon: z.string().max(255).nullish(),
  is_active: z.boolean().optional(),
});

// Super admin kategoriya yangilash (partial)
export const categoryUpdateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  name_ru: z.string().max(150).nullish(),
  name_en: z.string().max(150).nullish(),
  name_uz_cyrl: z.string().max(150).nullish(),
  description: z.string().nullish(),
  description_ru: z.string().nullish(),
  description_en: z.string().nullish(),
  description_uz_cyrl: z.string().nullish(),
  icon: z.string().max(255).nullish(),
  is_active: z.boolean().optional(),
});

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
