import { z } from 'zod';

// Biriktirilgan fayl tavsifi (upload endpointidan qaytadi).
export const attachmentSchema = z.object({
  url: z.string().min(1),
  name: z.string().min(1).max(255),
  type: z.string().max(120).optional().default(''),
  size: z.number().int().nonnegative().optional().default(0),
});

export type Attachment = z.infer<typeof attachmentSchema>;

// Xabar yuborish — matn va/yoki fayllar (kamida bittasi bo'lishi service'da tekshiriladi).
export const sendMessageSchema = z.object({
  body: z.string().trim().max(4000).optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
