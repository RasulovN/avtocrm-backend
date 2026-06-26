import { z } from 'zod';

// Decimal (latitude/longitude) — string yoki number kelishi mumkin, string'ga normallashtiramiz.
const decimalLike = z.union([z.string(), z.number()]).transform((v) => String(v));

// ── Onboarding (kompaniya yaratish) ──────────────────────────
export const onboardingSchema = z
  .object({
    name: z.string().min(1).max(255),
    category_id: z.coerce.number().int().positive().nullish(),
    country_id: z.coerce.number().int().positive().nullish(),
    region_id: z.coerce.number().int().positive().nullish(),
    district_id: z.coerce.number().int().positive().nullish(),
    street: z.string().nullish(),
    latitude: decimalLike.nullish(),
    longitude: decimalLike.nullish(),
    phone_number: z.string().max(20).nullish(),
    email: z.string().email().max(254).nullish(),
  })
  .superRefine((attrs, ctx) => {
    // latitude/longitude birga yuborilishi kerak
    const latNull = attrs.latitude === undefined || attrs.latitude === null;
    const lonNull = attrs.longitude === undefined || attrs.longitude === null;
    if (latNull !== lonNull) {
      ctx.addIssue({
        code: 'custom',
        message: 'Latitude va longitude birga yuborilishi kerak.',
        path: [],
      });
    }
  });

// ── Profil yangilash (PUT /me/) ──────────────────────────────
export const profileUpdateSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    category_id: z.coerce.number().int().positive().nullish(),
    country_id: z.coerce.number().int().positive().nullish(),
    region_id: z.coerce.number().int().positive().nullish(),
    district_id: z.coerce.number().int().positive().nullish(),
    street: z.string().nullish(),
    latitude: decimalLike.nullish(),
    longitude: decimalLike.nullish(),
    phone_number: z.string().max(20).nullish(),
    email: z.string().email().max(254).nullish(),
    logo: z.string().max(255).nullish(),
  })
  .superRefine((attrs, ctx) => {
    const latProvided = attrs.latitude !== undefined;
    const lonProvided = attrs.longitude !== undefined;
    // Faqat bittasi yuborilsa — qiymatlari mos kelishi kerak (ikkalasi ham null yoki ikkalasi ham bor)
    if (latProvided && lonProvided) {
      const latNull = attrs.latitude === null;
      const lonNull = attrs.longitude === null;
      if (latNull !== lonNull) {
        ctx.addIssue({
          code: 'custom',
          message: 'Latitude va longitude birga yuborilishi kerak.',
          path: [],
        });
      }
    }
  });

// ── Super admin: status o'zgartirish ─────────────────────────
export const statusUpdateSchema = z
  .object({
    status: z.enum(['active', 'suspended', 'onboarding']).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => d.status !== undefined || d.is_active !== undefined, {
    message: 'status yoki is_active maydonlaridan biri talab qilinadi.',
  });

export type OnboardingInput = z.infer<typeof onboardingSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type StatusUpdateInput = z.infer<typeof statusUpdateSchema>;
