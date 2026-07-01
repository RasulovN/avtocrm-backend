import { z } from 'zod';

export const loginSchema = z.object({
  phone_number: z.string(),
  password: z.string(),
});

export const sellerCreateSchema = z
  .object({
    full_name: z.string(),
    phone_number: z.string(),
    email: z.string().email(),
    password: z.string().min(8),
    confirm_password: z.string(),
    store_id: z.number().int(),
    role: z.enum(['m', 's']),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: "Passwords don't match",
    path: ['confirm_password'],
  });

export const userUpdateSchema = z.object({
  full_name: z.string().nullable().optional(),
  phone_number: z.string().optional(),
  email: z.string().email().nullable().optional(),
  is_active: z.boolean().optional(),
});

export const changePasswordSchema = z
  .object({
    old_password: z.string(),
    new_password: z.string(),
    confirm_password: z.string(),
  })
  .superRefine((d, ctx) => {
    if (d.new_password !== d.confirm_password) {
      ctx.addIssue({ code: 'custom', message: "Yangi parolingiz tasdiqlash parolingiz bilan bir xil bo'lishi kerak!", path: [] });
    }
    if (d.new_password.length < 8) {
      ctx.addIssue({ code: 'custom', message: 'Parol kamida 8 ta belgidan iborat bo‘lishi kerak.', path: [] });
    }
    if (!/[A-Za-z]/.test(d.new_password)) {
      ctx.addIssue({ code: 'custom', message: 'Parolda kamida bitta harf bo‘lishi kerak.', path: [] });
    }
    if (!/\d/.test(d.new_password)) {
      ctx.addIssue({ code: 'custom', message: 'Parolda kamida bitta raqam bo‘lishi kerak.', path: [] });
    }
    if (d.old_password === d.new_password) {
      ctx.addIssue({ code: 'custom', message: "Yangi parol eski parolga teng bo'la olmaydi!", path: [] });
    }
  });

export const forgotPasswordSchema = z.object({ email: z.string().email() });

// Frontend `new_password` yuboradi; orqaga moslik uchun `password` ham qabul qilinadi.
export const resetPasswordSchema = z
  .object({
    new_password: z.string().optional(),
    password: z.string().optional(),
    confirm_password: z.string(),
  })
  .superRefine((d, ctx) => {
    const pw = d.new_password ?? d.password ?? '';
    if (pw.length < 8) {
      ctx.addIssue({ code: 'custom', message: 'Parol kamida 8 ta belgidan iborat bo‘lishi kerak.', path: ['new_password'] });
    }
    if (!/[A-Za-z]/.test(pw)) {
      ctx.addIssue({ code: 'custom', message: 'Parolda kamida bitta harf bo‘lishi kerak.', path: ['new_password'] });
    }
    if (!/\d/.test(pw)) {
      ctx.addIssue({ code: 'custom', message: 'Parolda kamida bitta raqam bo‘lishi kerak.', path: ['new_password'] });
    }
    if (pw !== d.confirm_password) {
      ctx.addIssue({ code: 'custom', message: 'Parollar mos kelmadi.', path: ['confirm_password'] });
    }
  });

export const customerWriteSchema = z.object({
  full_name: z.string(),
  phone_number: z.string(),
});
