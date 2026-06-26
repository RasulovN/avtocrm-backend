import { z } from 'zod';

// Django PayDebtSerializer:
//   sale   = IntegerField()
//   amount = DecimalField(max_digits=12, decimal_places=2)  -> string/number, > 0
//   type   = ChoiceField(choices=Payment.Type.choices)      -> "cash" | "card"
//
// Decimal DRF tarzda: string yoki number bo'lib kelishi mumkin. `amount`ni stringga
// keltirib, > 0 ekanini tekshiramiz (DRF validate_amount: "Amount must be positive").
export const payDebtSchema = z.object({
  sale: z.number().int(),
  amount: z
    .union([z.number(), z.string()])
    .transform((v) => (typeof v === 'number' ? v.toString() : v))
    .refine((v) => /^-?\d+(\.\d+)?$/.test(v.trim()), {
      message: 'A valid number is required.',
    })
    .refine((v) => Number(v) > 0, {
      message: 'Amount must be positive',
    }),
  type: z.enum(['cash', 'card']),
});

export type PayDebtInput = z.infer<typeof payDebtSchema>;
