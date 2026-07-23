import { z } from 'zod';

// Django PayDebtSerializer:
//   sale   = IntegerField()
//   amount = DecimalField(max_digits=12, decimal_places=2)  -> string/number, > 0
//   type   = ChoiceField(choices=Payment.Type.choices)      -> "cash" | "card"
//
// Decimal DRF tarzda: string yoki number bo'lib kelishi mumkin. `amount`ni stringga
// keltirib, > 0 ekanini tekshiramiz (DRF validate_amount: "Amount must be positive").
const amountSchema = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'number' ? v.toString() : v))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v.trim()), {
    message: 'A valid number is required.',
  })
  .refine((v) => Number(v) > 0, {
    message: 'Amount must be positive',
  });

// Split to'lov qatori — sotuvdagi payments[] elementlari bilan bir xil shakl:
// {type: cash|card, amount, method}. Karta qatorida method (PaymentMethod.id) majburiy.
const debtPaymentRowSchema = z
  .object({
    type: z.enum(['cash', 'card']),
    amount: amountSchema,
    method: z.number().int().nullable().optional().default(null),
  })
  .superRefine((row, ctx) => {
    if (row.type === 'card' && !row.method) {
      ctx.addIssue({ code: 'custom', message: "Karta to'lovi uchun to'lov turini (kartani) tanlang", path: ['method'] });
    }
    if (row.type === 'cash' && row.method) {
      ctx.addIssue({ code: 'custom', message: "Naqd to'lovda karta ko'rsatilmaydi", path: ['method'] });
    }
  });

// payments[] bo'yicha umumiy qoidalar: bitta karta takrorlanmaydi, naqd qatori bittadan oshmaydi,
// amount berilsa payments yig'indisiga teng bo'lishi kerak.
function refinePayments(
  data: { amount?: string; payments?: Array<{ type: 'cash' | 'card'; amount: string; method: number | null }> },
  ctx: z.RefinementCtx,
) {
  const payments = data.payments ?? [];
  if (payments.length === 0) {
    if (data.amount === undefined) {
      ctx.addIssue({ code: 'custom', message: "To'lov miqdorini kiriting", path: ['amount'] });
    }
    return;
  }
  const usedCards = new Set<number>();
  let cashRows = 0;
  for (const p of payments) {
    if (p.type === 'cash') {
      cashRows += 1;
      if (cashRows > 1) {
        ctx.addIssue({ code: 'custom', message: "Naqd to'lov qatori bittadan oshmasligi kerak", path: ['payments'] });
        return;
      }
    } else if (p.method) {
      if (usedCards.has(p.method)) {
        ctx.addIssue({ code: 'custom', message: 'Bitta karta ikki marta tanlangan', path: ['payments'] });
        return;
      }
      usedCards.add(p.method);
    }
  }
  if (data.amount !== undefined) {
    const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    if (Math.abs(total - Number(data.amount)) > 0.005) {
      ctx.addIssue({ code: 'custom', message: "amount split to'lovlar yig'indisiga teng bo'lishi kerak", path: ['amount'] });
    }
  }
}

export const payDebtSchema = z
  .object({
    sale: z.number().int(),
    // Split rejimda amount ixtiyoriy — payments yig'indisidan olinadi
    amount: amountSchema.optional(),
    type: z.enum(['cash', 'card']).optional().default('cash'),
    // Karta to'lovi kanali (PaymentMethod.id: Uzcard/Humo/Payme/...)
    method: z.number().int().nullable().optional(),
    // Yangi klientlar: bir nechta usul bilan to'lash — har usul alohida qator
    payments: z.array(debtPaymentRowSchema).optional().default([]),
  })
  .superRefine(refinePayments);

export type PayDebtInput = z.infer<typeof payDebtSchema>;

// Bir mijozning bir nechta qarzli sotuvini bitta summa bilan yopish (FIFO).
// sales berilsa — faqat tanlangan sotuvlar; berilmasa — mijozning barcha qarzli
// sotuvlari. Taqsimlash har doim eng eski sotuvdan boshlanadi.
export const payDebtBulkSchema = z
  .object({
    customer: z.number().int(),
    amount: amountSchema.optional(),
    type: z.enum(['cash', 'card']).optional().default('cash'),
    method: z.number().int().nullable().optional(),
    payments: z.array(debtPaymentRowSchema).optional().default([]),
    sales: z.array(z.number().int()).nonempty().optional(),
  })
  .superRefine(refinePayments);

export type PayDebtBulkInput = z.infer<typeof payDebtBulkSchema>;
