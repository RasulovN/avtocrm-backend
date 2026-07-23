import { z } from 'zod';

// Django DRF apps/transfer/serializers.py ekvivalenti (zod).
//
// TransferCreateSerializer:
//   from_store  -> PrimaryKeyRelatedField(Store active)   (faqat pk; active tekshiruv service'da)
//   to_store    -> PrimaryKeyRelatedField(Store active)
//   items       -> TransferItemSerializer(many=True)
//                    product  -> PrimaryKeyRelatedField(Product active)
//                    quantity -> IntegerField(min_value=1)
//                    purchase_price / selling_price -> read_only (batchdan olinadi)
//   validate(): from_store != to_store; kamida bitta item.

const transferItemSchema = z.object({
  product: z.number().int(),
  quantity: z.number().int().min(1, { message: "Ensure this value is greater than or equal to 1." }),
});

export const transferCreateSchema = z
  .object({
    from_store: z.number().int(),
    to_store: z.number().int(),
    items: z.array(transferItemSchema),
  })
  .superRefine((data, ctx) => {
    if (data.from_store === data.to_store) {
      ctx.addIssue({ code: 'custom', message: "Do'konlar bir xil bo'lmasligi kerak", path: [] });
    }
    if (!data.items || data.items.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Kamida bitta mahsulot bo\'lishi shart', path: [] });
    }
  });

// ─────────────────────────────────────────────
// TransferSession (o'tkazma qoralamasi) — Django TransferSessionSerializer.
// Draft bosqichida qiymatlar chala bo'lishi mumkin — lenient validatsiya:
// faqat {product, quantity} saqlanadi, to'liq tekshiruv create/ da bajariladi.
// ─────────────────────────────────────────────

// Frontend from_store/to_store ni string ("3") yoki number ko'rinishida yuborishi mumkin
const storeRef = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  });

const transferSessionItemSchema = z
  .object({
    product: z.union([z.number(), z.string(), z.null()]).optional().default(null),
    quantity: z.union([z.number(), z.string()]).optional().default(0),
  })
  .transform((it) => ({
    product: it.product === null || it.product === '' ? null : Math.trunc(Number(it.product)) || null,
    quantity: Math.trunc(Number(it.quantity)) || 0,
  }));

export const transferSessionUpsertSchema = z.object({
  from_store: storeRef,
  to_store: storeRef,
  items: z.array(transferSessionItemSchema).optional(),
});

export const transferSessionCompleteSchema = z.object({
  transfer: z.union([z.number(), z.string()]).nullable().optional(),
});

export type TransferCreateInput = z.infer<typeof transferCreateSchema>;
export type TransferItemInput = z.infer<typeof transferItemSchema>;
export type TransferSessionUpsertInput = z.infer<typeof transferSessionUpsertSchema>;
export type TransferSessionCompleteInput = z.infer<typeof transferSessionCompleteSchema>;
