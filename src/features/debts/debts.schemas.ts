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

export const payDebtSchema = z.object({
  sale: z.number().int(),
  amount: amountSchema,
  type: z.enum(['cash', 'card']),
  // Karta to'lovi kanali (PaymentMethod.id: Uzcard/Humo/Payme/...)
  method: z.number().int().nullable().optional(),
});

export type PayDebtInput = z.infer<typeof payDebtSchema>;

// Bir mijozning bir nechta qarzli sotuvini bitta summa bilan yopish (FIFO).
// sales berilsa — faqat tanlangan sotuvlar; berilmasa — mijozning barcha qarzli
// sotuvlari. Taqsimlash har doim eng eski sotuvdan boshlanadi.
export const payDebtBulkSchema = z.object({
  customer: z.number().int(),
  amount: amountSchema,
  type: z.enum(['cash', 'card']),
  method: z.number().int().nullable().optional(),
  sales: z.array(z.number().int()).nonempty().optional(),
});

export type PayDebtBulkInput = z.infer<typeof payDebtBulkSchema>;
