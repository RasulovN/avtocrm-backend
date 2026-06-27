import { z } from 'zod';

// Landing "Demo so'rash" formasi — ommaviy (autentifikatsiyasiz).
export const leadCreateSchema = z.object({
  name: z.string().min(1).max(150),
  phone: z.string().min(3).max(50),
  email: z.string().email().max(150),
  company: z.string().max(150).nullish(),
  stores_range: z.string().max(50).nullish(),
  message: z.string().max(2000).nullish(),
  locale: z.string().max(10).nullish(),
});

export const LEAD_STATUSES = ['new', 'approved', 'rejected', 'contacted', 'closed'] as const;

// Super admin — status va ichki izohni yangilash.
export const leadUpdateSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  note: z.string().max(2000).nullish(),
});

export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
