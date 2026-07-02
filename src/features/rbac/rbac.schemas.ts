import { z } from 'zod';

// RBAC modul uchun zod sxemalari (validatsiya).
// Response snake_case, request body ham snake_case (frontend kelishuvi).

// ?scope=platform|company (faqat o'qish endpointlari uchun)
export const scopeQuerySchema = z.object({
  scope: z.enum(['platform', 'company']).optional(),
});

// Rol yaratish/yangilash uchun umumiy sxema.
// permissions — ruxsat kodlari ro'yxati (scope cheklovi service'da setRolePermissions orqali qo'llanadi).
export const roleCreateSchema = z.object({
  name: z.string().trim().min(1, 'Rol nomi majburiy'),
  description: z.string().trim().nullable().optional(),
  permissions: z.array(z.string()).default([]),
});

export const roleUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Rol nomi majburiy').optional(),
  description: z.string().trim().nullable().optional(),
  permissions: z.array(z.string()).optional(),
});

// Foydalanuvchi yaratish (rol biriktirib).
// Telefon YOKI email majburiy — buni .superRefine bilan tekshiramiz.
export const userCreateSchema = z
  .object({
    full_name: z.string().trim().min(1, "To'liq ism majburiy"),
    phone_number: z.string().trim().min(1).nullable().optional(),
    email: z.string().trim().min(1).nullable().optional(),
    password: z.string().min(8, 'Parol kamida 8 ta belgidan iborat'),
    role_id: z.number().int().positive(),
    // Ixtiyoriy: xodimni do'konga biriktirish (company scope). Login qilganda shu
    // do'kon konteksti (X-Store-ID) faol bo'ladi. store_role: m=menejer, s=sotuvchi.
    store_id: z.number().int().positive().nullable().optional(),
    store_role: z.enum(['m', 's']).optional(),
  })
  .superRefine((d, ctx) => {
    if (!d.phone_number && !d.email) {
      ctx.addIssue({
        code: 'custom',
        message: 'Telefon raqam yoki email majburiy',
        path: ['phone_number'],
      });
    }
  });

// Foydalanuvchini yangilash (faqat ruxsat etilgan maydonlar).
export const userUpdateSchema = z.object({
  full_name: z.string().trim().min(1).optional(),
  role_id: z.number().int().positive().optional(),
  is_active: z.boolean().optional(),
  // Do'kon biriktirish/o'zgartirish. null => do'kondan chiqarish.
  store_id: z.number().int().positive().nullable().optional(),
  store_role: z.enum(['m', 's']).optional(),
});

export type RoleCreateInput = z.infer<typeof roleCreateSchema>;
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
