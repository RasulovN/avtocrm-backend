import { z } from 'zod';

// Super admin to'lov turi yaratish (brend nomlari — tarjimasiz, bitta nom yetarli)
export const paymentMethodCreateSchema = z.object({
  name: z.string().min(1).max(100),
  code: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/, { message: "Kod faqat kichik lotin harf, raqam, '-' va '_' dan iborat bo'lishi kerak" })
    .optional(),
  icon: z.string().max(255).nullish(),
  is_active: z.boolean().optional(),
  is_default: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
});

// Super admin to'lov turi yangilash (partial)
export const paymentMethodUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/, { message: "Kod faqat kichik lotin harf, raqam, '-' va '_' dan iborat bo'lishi kerak" })
    .optional(),
  icon: z.string().max(255).nullish(),
  is_active: z.boolean().optional(),
  is_default: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
});

export type PaymentMethodCreateInput = z.infer<typeof paymentMethodCreateSchema>;
export type PaymentMethodUpdateInput = z.infer<typeof paymentMethodUpdateSchema>;
