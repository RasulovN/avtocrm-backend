import { z } from 'zod';

// Auth modul uchun zod validatsiya sxemalari.
// Barcha kirish/chiqish snake_case konvensiyasida.

// Parol kuchi tekshiruvi (kamida 8 belgi, harf + raqam).
function passwordIssues(password: string, ctx: z.RefinementCtx, path: (string | number)[] = []): void {
  if (password.length < 8) {
    ctx.addIssue({ code: 'custom', message: 'Parol kamida 8 ta belgidan iborat bo‘lishi kerak.', path });
  }
  if (!/[A-Za-z]/.test(password)) {
    ctx.addIssue({ code: 'custom', message: 'Parolda kamida bitta harf bo‘lishi kerak.', path });
  }
  if (!/\d/.test(password)) {
    ctx.addIssue({ code: 'custom', message: 'Parolda kamida bitta raqam bo‘lishi kerak.', path });
  }
}

// Ro'yxatdan o'tish — faqat email + parol (sodda oqim).
export const registerSchema = z
  .object({
    email: z.string().email({ message: 'Yaroqsiz email manzil' }),
    password: z.string(),
    confirm_password: z.string(),
    full_name: z.string().trim().min(1).max(128).optional(),
  })
  .superRefine((d, ctx) => {
    passwordIssues(d.password, ctx, ['password']);
    if (d.password !== d.confirm_password) {
      ctx.addIssue({ code: 'custom', message: 'Parollar mos kelmadi.', path: ['confirm_password'] });
    }
  });

// Email tasdiqlash — token bilan.
export const verifyEmailSchema = z.object({
  token: z.string().min(1, { message: 'Token talab qilinadi' }),
});

// Tasdiqlash xatini qayta yuborish.
export const resendVerificationSchema = z.object({
  email: z.string().email({ message: 'Yaroqsiz email manzil' }),
});

// Kirish — login (telefon raqami YOKI email) + parol.
export const loginSchema = z.object({
  login: z.string().min(1, { message: 'Login (telefon yoki email) talab qilinadi' }),
  password: z.string().min(1, { message: 'Parol talab qilinadi' }),
});

// Tokenni yangilash — refresh body orqali (cookie ham qabul qilinadi).
export const refreshSchema = z.object({
  refresh_token: z.string().optional(),
  refresh: z.string().optional(),
});

// Parolni o'zgartirish (avtorizatsiyalangan foydalanuvchi).
export const changePasswordSchema = z
  .object({
    old_password: z.string(),
    new_password: z.string(),
    confirm_password: z.string(),
  })
  .superRefine((d, ctx) => {
    if (d.new_password !== d.confirm_password) {
      ctx.addIssue({ code: 'custom', message: "Yangi parol tasdiqlash paroli bilan bir xil bo'lishi kerak!", path: ['confirm_password'] });
    }
    passwordIssues(d.new_password, ctx, ['new_password']);
    if (d.old_password === d.new_password) {
      ctx.addIssue({ code: 'custom', message: "Yangi parol eski parolga teng bo'la olmaydi!", path: ['new_password'] });
    }
  });

// Parolni unutdim — email bo'yicha tiklash havolasi.
export const forgotPasswordSchema = z.object({
  email: z.string().email({ message: 'Yaroqsiz email manzil' }),
});

// Parolni tiklash — uid + token + yangi parol.
export const resetPasswordSchema = z
  .object({
    uid: z.string().min(1),
    token: z.string().min(1),
    password: z.string(),
    confirm_password: z.string(),
  })
  .superRefine((d, ctx) => {
    passwordIssues(d.password, ctx, ['password']);
    if (d.password !== d.confirm_password) {
      ctx.addIssue({ code: 'custom', message: 'Parollar mos kelmadi.', path: ['confirm_password'] });
    }
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
