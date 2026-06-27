import { z } from 'zod';

// Bitta ContactInfo bo'lagi — landing va kompaniya kontakti uchun umumiy.
export const contactInfoSchema = z
  .object({
    phone: z.string().max(50).optional(),
    phoneHref: z.string().max(50).optional(),
    email: z.string().max(150).optional(),
    address: z.string().max(300).optional(),
    location: z
      .object({ lat: z.number(), lng: z.number() })
      .nullable()
      .optional(),
    socials: z
      .array(z.object({ name: z.string().min(1).max(60), url: z.string().max(300) }))
      .optional(),
  })
  .passthrough();

// Landing sozlamalari = ContactInfo (qo'shimcha maydonlar ham qabul qilinadi).
export const landingSettingsSchema = contactInfoSchema;

export type LandingSettingsInput = z.infer<typeof landingSettingsSchema>;
