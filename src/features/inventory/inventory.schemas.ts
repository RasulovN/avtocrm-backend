import { z } from 'zod';

// ── Inventory session/count yozish so'rovlari ──

// InventoryStartSerializer
export const inventoryStartSchema = z.object({
  store_id: z.number().int(),
});

// InventoryCountSerializer (scan / set-count): quantity >= 0
export const inventoryCountSchema = z.object({
  session_id: z.number().int(),
  product_id: z.number().int(),
  quantity: z.number().int().min(0),
});

// InventoryFinalizeSerializer
export const inventoryFinalizeSchema = z.object({
  session_id: z.number().int(),
});

// InventoryCancelSerializer
export const inventoryCancelSchema = z.object({
  session_id: z.number().int(),
});

export type InventoryStartInput = z.infer<typeof inventoryStartSchema>;
export type InventoryCountInput = z.infer<typeof inventoryCountSchema>;
export type InventoryFinalizeInput = z.infer<typeof inventoryFinalizeSchema>;
export type InventoryCancelInput = z.infer<typeof inventoryCancelSchema>;
