import { z } from 'zod';

// Django DRF contract serializerlari ekvivalenti (zod).
// Decimal maydonlar string yoki number ko'rinishida kelishi mumkin — string'ga normalizatsiya qilinadi.

const decimalLike = z.union([z.string(), z.number()]).transform((v) => String(v));

// ─────────────────────────────────────────────
// Supplier
// ─────────────────────────────────────────────

// SupplierCreateSerializer: translation maydonlari (name_uz, name_uz_cyrl, ...),
// phone_number, inn. validate_inn (isdigit + uniqueness) service'da bajariladi.
export const supplierCreateSchema = z.object({
  phone_number: z.string().max(20),
  inn: z.string().max(50).nullable().optional(),
  name_uz: z.string().max(255),
  name_uz_cyrl: z.string().max(255),
  description_uz: z.string(),
  description_uz_cyrl: z.string(),
  address_uz: z.string(),
  address_uz_cyrl: z.string(),
});

// SupplierDetailAPIView.put — serializer_class=SupplierCreateSerializer, partial=True.
export const supplierUpdateSchema = z.object({
  phone_number: z.string().max(20).optional(),
  inn: z.string().max(50).nullable().optional(),
  name_uz: z.string().max(255).optional(),
  name_uz_cyrl: z.string().max(255).optional(),
  description_uz: z.string().optional(),
  description_uz_cyrl: z.string().optional(),
  address_uz: z.string().optional(),
  address_uz_cyrl: z.string().optional(),
});

// ─────────────────────────────────────────────
// Stock Entry
// ─────────────────────────────────────────────

const stockEntryItemSchema = z
  .object({
    product: z.number().int(),
    quantity: z.number().int(),
    purchase_price: decimalLike,
    selling_price: decimalLike,
    wholesale_price: decimalLike.default('0'),
  })
  .superRefine((data, ctx) => {
    const qty = data.quantity;
    const purchase = Number(data.purchase_price);
    const selling = Number(data.selling_price);
    const wholesale = Number(data.wholesale_price);

    if (qty <= 0) {
      ctx.addIssue({ code: 'custom', message: "Quantity > 0 bo'lishi kerak", path: [] });
    }
    if (purchase <= 0) {
      ctx.addIssue({ code: 'custom', message: "Purchase price noto'g'ri", path: [] });
    }
    if (selling <= 0) {
      ctx.addIssue({ code: 'custom', message: "Selling price noto'g'ri", path: [] });
    }
    if (selling < purchase) {
      ctx.addIssue({ code: 'custom', message: "Selling price < purchase price bo'lmasligi kerak", path: [] });
    }
    if (wholesale < 0) {
      ctx.addIssue({ code: 'custom', message: 'wholesale_price >= 0 bo\'lishi kerak', path: [] });
    }
    if (wholesale > 0) {
      if (wholesale < purchase) {
        ctx.addIssue({
          code: 'custom',
          message: 'Optom narx tannarxdan (purchase price) past bo\'lmasligi kerak',
          path: [],
        });
      }
      if (wholesale > selling) {
        ctx.addIssue({
          code: 'custom',
          message: 'Optom narx oddiy sotish narxidan (selling price) yuqori bo\'lmasligi kerak',
          path: [],
        });
      }
    }
  });

export const stockEntryCreateSchema = z
  .object({
    supplier: z.number().int(),
    store: z.number().int(),
    cash_amount: decimalLike.default('0'),
    card_amount: decimalLike.default('0'),
    items: z.array(stockEntryItemSchema),
  })
  .superRefine((data, ctx) => {
    if (Number(data.cash_amount) < 0) {
      ctx.addIssue({ code: 'custom', message: 'cash_amount >= 0 bo\'lishi kerak', path: ['cash_amount'] });
    }
    if (Number(data.card_amount) < 0) {
      ctx.addIssue({ code: 'custom', message: 'card_amount >= 0 bo\'lishi kerak', path: ['card_amount'] });
    }
    if (!data.items || data.items.length === 0) {
      ctx.addIssue({ code: 'custom', message: "Mahsulotlar ro'yxati bo'sh", path: ['items'] });
      return;
    }

    const totalEntryAmount = data.items.reduce(
      (acc, item) => acc + Number(item.purchase_price) * item.quantity,
      0,
    );
    const paidAmount = Number(data.cash_amount) + Number(data.card_amount);
    if (paidAmount > totalEntryAmount) {
      ctx.addIssue({ code: 'custom', message: "To'lov umumiy narxdan oshib ketdi!", path: [] });
    }
  });

// ─────────────────────────────────────────────
// Supplier payment (transaction)
// ─────────────────────────────────────────────

export const supplierPaymentSchema = z.object({
  supplier: z.number().int(),
  entry: z.number().int(),
  amount: decimalLike,
  note: z.string().optional(),
});

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
export type StockEntryCreateInput = z.infer<typeof stockEntryCreateSchema>;
export type StockEntryItemInput = z.infer<typeof stockEntryItemSchema>;
export type SupplierPaymentInput = z.infer<typeof supplierPaymentSchema>;
