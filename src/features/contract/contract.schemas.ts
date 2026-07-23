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

// Split (aralash) to'lov qatori — sales paymentInputSchema bilan bir xil shakl:
// karta bo'lsa bank_card majburiy, naqdda bank_card bo'lmasligi kerak.
export const stockEntryPaymentInputSchema = z
  .object({
    type: z.enum(['cash', 'card']),
    amount: decimalLike,
    bank_card: z.number().int().nullable().optional().default(null),
  })
  .superRefine((data, ctx) => {
    if (Number(data.amount) <= 0) {
      ctx.addIssue({ code: 'custom', message: "To'lov summasi 0 dan katta bo'lishi kerak", path: ['amount'] });
    }
    if (data.type === 'card' && !data.bank_card) {
      ctx.addIssue({ code: 'custom', message: "Karta to'lovi uchun to'lov turini (kartani) tanlang", path: ['bank_card'] });
    }
    if (data.type === 'cash' && data.bank_card) {
      ctx.addIssue({ code: 'custom', message: "Naqd to'lovda karta ko'rsatilmaydi", path: ['bank_card'] });
    }
  });

export const stockEntryCreateSchema = z
  .object({
    supplier: z.number().int(),
    store: z.number().int(),
    cash_amount: decimalLike.default('0'),
    card_amount: decimalLike.default('0'),
    // Karta to'lovida qaysi to'lov turi (PaymentMethod katalogi) ishlatilgani.
    // Ixtiyoriy (eski klientlar va Excel import uchun).
    bank_card: z.number().int().nullable().optional().default(null),
    // Split to'lovlar — berilsa flat cash_amount/card_amount/bank_card e'tiborga
    // olinmaydi (ular payments'dan qayta hisoblanadi).
    payments: z.array(stockEntryPaymentInputSchema).optional().default([]),
    // Ixtiyoriy izoh/tavsif
    note: z.string().max(1000).optional().default(''),
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

    if (data.payments.length > 0) {
      // Bitta karta ikki marta ishlatilmaydi; naqd qatori bittadan oshmaydi
      const usedCards = new Set<number>();
      let cashRows = 0;
      for (const p of data.payments) {
        if (p.type === 'cash') {
          cashRows += 1;
          if (cashRows > 1) {
            ctx.addIssue({ code: 'custom', message: "Naqd to'lov qatori bittadan oshmasligi kerak", path: ['payments'] });
            break;
          }
        } else if (p.bank_card) {
          if (usedCards.has(p.bank_card)) {
            ctx.addIssue({ code: 'custom', message: 'Bitta karta ikki marta tanlangan', path: ['payments'] });
            break;
          }
          usedCards.add(p.bank_card);
        }
      }
    }

    const totalEntryAmount = data.items.reduce(
      (acc, item) => acc + Number(item.purchase_price) * item.quantity,
      0,
    );
    const paidAmount =
      data.payments.length > 0
        ? data.payments.reduce((acc, p) => acc + Number(p.amount), 0)
        : Number(data.cash_amount) + Number(data.card_amount);
    if (paidAmount > totalEntryAmount) {
      ctx.addIssue({ code: 'custom', message: "To'lov umumiy narxdan oshib ketdi!", path: [] });
    }
  });

// ─────────────────────────────────────────────
// Supplier payment (transaction)
// ─────────────────────────────────────────────

export const supplierPaymentSchema = z
  .object({
    supplier: z.number().int(),
    entry: z.number().int(),
    amount: decimalLike,
    note: z.string().optional(),
    // To'lov usuli: naqd (default) yoki karta; karta bo'lsa bank_card majburiy
    payment_type: z.enum(['cash', 'card']).optional().default('cash'),
    bank_card: z.number().int().nullable().optional().default(null),
  })
  .superRefine((data, ctx) => {
    if (data.payment_type === 'card' && !data.bank_card) {
      ctx.addIssue({
        code: 'custom',
        message: "Karta to'lovi uchun to'lov turini (kartani) tanlang",
        path: ['bank_card'],
      });
    }
  });

// ─────────────────────────────────────────────
// Purchase session (progressiv kirim wizard'i)
// ─────────────────────────────────────────────

// Draft bosqichida qiymatlar to'liq bo'lmasligi mumkin (masalan narx 0) —
// bu yerda faqat tip/format tekshiriladi, to'liq biznes validatsiya
// receive/confirm bosqichlarida bajariladi.
const purchaseSessionItemSchema = z.object({
  product: z.number().int().nullable().optional().default(null),
  product_name: z.string().optional().default(''),
  quantity: decimalLike.default('0'),
  purchase_price: decimalLike.default('0'),
  selling_price: decimalLike.default('0'),
  wholesale_price: decimalLike.default('0'),
});

// Split to'lov qoralamasi — lenient (draft bosqichida chala bo'lishi mumkin)
const purchaseSessionPaymentSchema = z.object({
  type: z.enum(['cash', 'card']).optional().default('cash'),
  amount: decimalLike.default('0'),
  bank_card: z.number().int().nullable().optional().default(null),
});

export const purchaseSessionCreateSchema = z.object({
  supplier: z.number().int(),
  store: z.number().int(),
  items: z.array(purchaseSessionItemSchema).optional().default([]),
  cash_amount: decimalLike.default('0'),
  card_amount: decimalLike.default('0'),
  bank_card: z.number().int().nullable().optional().default(null),
  payments: z.array(purchaseSessionPaymentSchema).optional().default([]),
  note: z.string().max(1000).optional().default(''),
  current_step: z.number().int().min(1).max(3).optional().default(1),
});

// PATCH — qisman yangilash (avto-saqlash)
export const purchaseSessionUpdateSchema = z.object({
  supplier: z.number().int().optional(),
  store: z.number().int().optional(),
  items: z.array(purchaseSessionItemSchema).optional(),
  cash_amount: decimalLike.optional(),
  card_amount: decimalLike.optional(),
  bank_card: z.number().int().nullable().optional(),
  payments: z.array(purchaseSessionPaymentSchema).optional(),
  note: z.string().max(1000).optional(),
  current_step: z.number().int().min(1).max(3).optional(),
});

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;
export type StockEntryCreateInput = z.infer<typeof stockEntryCreateSchema>;
export type StockEntryItemInput = z.infer<typeof stockEntryItemSchema>;
export type StockEntryPaymentInput = z.infer<typeof stockEntryPaymentInputSchema>;
export type SupplierPaymentInput = z.infer<typeof supplierPaymentSchema>;
export type PurchaseSessionItemInput = z.infer<typeof purchaseSessionItemSchema>;
export type PurchaseSessionCreateInput = z.infer<typeof purchaseSessionCreateSchema>;
export type PurchaseSessionUpdateInput = z.infer<typeof purchaseSessionUpdateSchema>;
