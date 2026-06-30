import { z } from 'zod';

// Lead manbalari — landing formasi va admin tomonidan tanlanadigan kanallar.
// DB'da string sifatida saqlanadi; eski yozuvlar 'landing' bo'lishi mumkin.
export const LEAD_SOURCES = [
  'website',   // sayt (umumiy)
  'instagram',
  'telegram',
  'facebook',
  'youtube',
  'google',    // qidiruv
  'referral',  // tavsiya / tanish
  'other',     // boshqa
  'manual',    // admin qo'lda kiritgan
  'landing',   // eski yozuvlar (umumiy sayt)
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

const SOURCE_SET = new Set<string>(LEAD_SOURCES);

// Kelgan manbani ruxsat etilgan to'plamga moslaymiz; noma'lum bo'lsa fallback.
export function normalizeSource(s: unknown, fallback: LeadSource = 'website'): LeadSource {
  if (typeof s === 'string') {
    const v = s.trim().toLowerCase();
    if (SOURCE_SET.has(v)) return v as LeadSource;
  }
  return fallback;
}

// Landing "Demo so'rash" formasi — ommaviy (autentifikatsiyasiz).
// Email YOKI telefon — ikkalasidan kamida bittasi majburiy (ikkalasi ham emas).
export const leadCreateSchema = z
  .object({
    name: z.string().min(1).max(150),
    phone: z.string().max(50).nullish(),
    email: z.string().max(150).nullish(),
    company: z.string().max(150).nullish(),
    stores_range: z.string().max(50).nullish(),
    message: z.string().max(2000).nullish(),
    locale: z.string().max(10).nullish(),
    source: z.string().max(50).nullish(), // "qayerdan bildingiz" — kanal kodi
  })
  .superRefine((d, ctx) => {
    const phone = d.phone?.trim() ?? '';
    const email = d.email?.trim() ?? '';
    if (!phone && !email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Email yoki telefon raqamidan kamida bittasini kiriting.',
        path: ['email'],
      });
    }
    // Email kiritilgan bo'lsa — to'g'ri formatda bo'lsin.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Email noto'g'ri formatda.",
        path: ['email'],
      });
    }
  });

export const LEAD_STATUSES = ['new', 'approved', 'rejected', 'contacted', 'closed'] as const;

// Super admin — qo'lda yangi lead qo'shish (to'liq maydonlar).
export const leadAdminCreateSchema = z.object({
  name: z.string().min(1).max(150),
  phone: z.string().min(3).max(50),
  email: z.string().email().max(150),
  company: z.string().max(150).nullish(),
  stores_range: z.string().max(50).nullish(),
  message: z.string().max(2000).nullish(),
  source: z.string().max(50).nullish(),
  status: z.enum(LEAD_STATUSES).optional(),
  note: z.string().max(2000).nullish(),
  locale: z.string().max(10).nullish(),
});

// Super admin — mavjud leadni tahrirlash (barcha maydonlar ixtiyoriy).
export const leadUpdateSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  phone: z.string().min(3).max(50).optional(),
  email: z.string().email().max(150).optional(),
  company: z.string().max(150).nullish(),
  stores_range: z.string().max(50).nullish(),
  message: z.string().max(2000).nullish(),
  source: z.string().max(50).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  note: z.string().max(2000).nullish(),
});

export type LeadCreateInput = z.infer<typeof leadCreateSchema>;
export type LeadAdminCreateInput = z.infer<typeof leadAdminCreateSchema>;
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;
