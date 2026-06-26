import { z } from 'zod';

// Django StoreCreateSerializer ekvivalenti.
// Decimal maydonlar (latitude/longitude) string yoki number sifatida kelishi mumkin.
const decimalLike = z.union([z.string(), z.number()]).transform((v) => String(v));

export const storeCreateSchema = z
  .object({
    name_uz: z.string().max(255),
    name_uz_cyrl: z.string().max(255),
    phone_number: z.string().max(20),
    address_uz: z.string(),
    address_uz_cyrl: z.string(),
    type: z.enum(['b', 's']),
    latitude: decimalLike.optional(),
    longitude: decimalLike.optional(),
  })
  .superRefine((attrs, ctx) => {
    // DRF validate(): latitude va longitude birga yuborilishi kerak
    const latNull = attrs.latitude === undefined || attrs.latitude === null;
    const lonNull = attrs.longitude === undefined || attrs.longitude === null;
    if (latNull !== lonNull) {
      ctx.addIssue({
        code: 'custom',
        message: 'Latitude va longitude birga yuborilishi kerak',
        path: [],
      });
    }
  });

// Django StoreDetailSerializer.put(partial=True) ekvivalenti.
// ModelSerializer translated maydonlarni qabul qiladi: name_uz, name_uz_cyrl, address_uz, address_uz_cyrl.
export const storeUpdateSchema = z.object({
  name_uz: z.string().max(255).optional(),
  name_uz_cyrl: z.string().max(255).optional(),
  phone_number: z.string().max(20).optional(),
  address_uz: z.string().optional(),
  address_uz_cyrl: z.string().optional(),
  type: z.enum(['b', 's']).optional(),
  latitude: decimalLike.nullable().optional(),
  longitude: decimalLike.nullable().optional(),
  is_active: z.boolean().optional(),
});

export type StoreCreateInput = z.infer<typeof storeCreateSchema>;
export type StoreUpdateInput = z.infer<typeof storeUpdateSchema>;
