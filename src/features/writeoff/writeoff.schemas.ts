import { z } from 'zod';

// Django apps/writeoff/serializers ekvivalenti (zod).

export const WRITE_OFF_REASONS = [
  'damaged', // Buzilgan / yaroqsiz
  'expired', // Muddati o'tgan
  'lost', // Yo'qolgan / o'g'irlangan
  'inventory', // Inventarizatsiya kamomadi
  'catalog', // Katalogdan chiqarish
  'other', // Boshqa
] as const;

export type WriteOffReason = (typeof WRITE_OFF_REASONS)[number];

// WriteOffCreateSerializer
export const writeOffCreateSchema = z.object({
  store: z.number().int(),
  reason: z.enum(WRITE_OFF_REASONS),
  comment: z.string().optional().default(''),
  items: z
    .array(
      z.object({
        product: z.number().int(),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1, "Hech bo'lmaganda bitta mahsulot kerak."),
});

// WriteOffUpdateSerializer — faqat metama'lumot (sabab/izoh)
export const writeOffUpdateSchema = z.object({
  reason: z.enum(WRITE_OFF_REASONS).optional(),
  comment: z.string().optional(),
});

export type WriteOffCreateInput = z.infer<typeof writeOffCreateSchema>;
export type WriteOffUpdateInput = z.infer<typeof writeOffUpdateSchema>;
