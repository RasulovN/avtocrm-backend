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

export type TransferCreateInput = z.infer<typeof transferCreateSchema>;
export type TransferItemInput = z.infer<typeof transferItemSchema>;
