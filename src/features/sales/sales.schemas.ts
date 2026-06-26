import { z } from 'zod';

// ─────────────────────────────────────────────
// Django: apps/sales/serializers/* zod ekvivalentlari.
// Decimal maydonlar DRF tarzda string yoki number bo'lib kelishi mumkin —
// ularni stringga keltirib (xizmat qatlamida Prisma.Decimal'ga aylanadi)
// validatsiya qilamiz. API snake_case.
// ─────────────────────────────────────────────

// DRF DecimalField(max_digits, decimal_places) — string yoki number.
// Service qatlamida Prisma.Decimal'ga aylantiriladi (float ishlatilmaydi).
const decimalString = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'number' ? v.toString() : v))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v.trim()), {
    message: 'A valid number is required.',
  });

// ── Sale create ──────────────────────────────────────────

// Django SaleItemInputSerializer:
//   product = IntegerField, quantity = IntegerField, price = DecimalField
//   validate: quantity > 0 ("Miqdor ijoboy bo'lishi kerak"),
//             price > 0 ("Narx ijoboy bo'lishi kerak")
const saleItemInputSchema = z.object({
  product: z.number().int(),
  quantity: z
    .number()
    .int()
    .refine((v) => v > 0, { message: "Miqdor ijoboy bo'lishi kerak" }),
  price: decimalString.refine((v) => Number(v) > 0, {
    message: "Narx ijoboy bo'lishi kerak",
  }),
});

// Django PaymentInputSerializer:
//   type = ChoiceField(Payment.Type.choices = cash/card)
//   amount = DecimalField; validate: amount > 0 ("To'lov ijoboy bo'lishi kerak")
const paymentInputSchema = z.object({
  type: z.enum(['cash', 'card']),
  amount: decimalString.refine((v) => Number(v) > 0, {
    message: "To'lov ijoboy bo'lishi kerak",
  }),
});

// Django SaleCreateSerializer:
//   store (opt), customer (opt, nullable), discount_type (opt, nullable, p/f),
//   discount_value (DecimalField, default 0), items (many), payments (many),
//   debt_due_date (DateField, opt, nullable)
// Murakkab cross-field validatsiya (store permission, qarz/customer/due_date,
// chegirma foizi) `.superRefine` o'rniga service qatlamiga ko'chiriladi, chunki
// userga (superuser?) bog'liq — Django serializer'da `context['request'].user`.
export const saleCreateSchema = z.object({
  store: z.number().int().optional(),
  customer: z.number().int().nullable().optional(),
  discount_type: z.enum(['p', 'f']).nullable().optional(),
  discount_value: decimalString.optional(),
  items: z.array(saleItemInputSchema),
  payments: z.array(paymentInputSchema),
  // DRF DateField — "YYYY-MM-DD"
  debt_due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date has wrong format. Use YYYY-MM-DD.' })
    .nullable()
    .optional(),
});

export type SaleCreateInput = z.infer<typeof saleCreateSchema>;

// ── Sale return create ───────────────────────────────────

// Django SaleReturnItemInputSerializer: sale_item = IntegerField, quantity = IntegerField
const saleReturnItemInputSchema = z.object({
  sale_item: z.number().int(),
  quantity: z.number().int(),
});

// Django SaleReturnCreateSerializer: sale = IntegerField, items (many), comment (opt, blank)
export const saleReturnCreateSchema = z.object({
  sale: z.number().int(),
  items: z.array(saleReturnItemInputSchema),
  comment: z.string().optional(),
});

export type SaleReturnCreateInput = z.infer<typeof saleReturnCreateSchema>;
