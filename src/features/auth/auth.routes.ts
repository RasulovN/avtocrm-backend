import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { checkPassword, hashPassword } from '../../common/password.js';
import { createTokens, accessFromRefresh, verifyAccess, verifyRefresh } from '../../common/jwt.js';
import { setAuthCookies, clearAuthCookies } from '../../common/cookies.js';
import { revokeToken, isTokenRevoked } from '../../common/tokenBlacklist.js';
import { rateLimit } from '../../plugins/rateLimit.js';
import { sendMail } from '../../common/email.js';
import { makeToken, checkToken, encodeUid, decodeUid } from '../../common/passwordReset.js';
import { BadRequest, Unauthorized, ValidationError } from '../../common/errors.js';
import { recordAudit } from '../../common/audit.js';
import { env } from '../../config/env.js';
import {
  registerSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schemas.js';
import {
  issueEmailVerification,
  registerUser,
  serializeUser,
  serializeCompany,
  buildMenus,
} from './auth.service.js';

// Login/Logout uchun klient meta-ma'lumotlari (UserHistory uchun).
// platform: mobil ilova `X-Platform: mobile` header yuboradi (segmentlash uchun).
function clientMeta(req: FastifyRequest): {
  ip: string;
  userAgent: string | null;
  platform: 'web' | 'mobile';
} {
  const raw = String(req.headers['x-platform'] ?? '').toLowerCase();
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
    platform: raw === 'mobile' ? 'mobile' : 'web',
  };
}

// So'rovdagi access token'ni (cookie yoki Bearer) qaytaradi.
function extractToken(req: FastifyRequest): string | null {
  const cookieToken = (req.cookies as Record<string, string | undefined>)?.access_token;
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Logout: joriy access VA refresh token'larni bekor qiladi (blacklist).
// Ilgari faqat access bekor qilinardi — 7 kunlik refresh token qolib, undan
// yangi access token olish mumkin edi (logout amalda ishlamas edi).
function revokeCurrentToken(req: FastifyRequest): void {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = verifyAccess(token);
      if (payload.jti && payload.exp) revokeToken(payload.jti, payload.exp);
    } catch {
      /* yaroqsiz token — e'tiborsiz */
    }
  }
  const refreshToken = (req.cookies as Record<string, string | undefined>)?.refresh_token;
  if (refreshToken) {
    try {
      const payload = verifyRefresh(refreshToken);
      if (payload.jti && payload.exp) revokeToken(payload.jti, payload.exp);
    } catch {
      /* yaroqsiz refresh — e'tiborsiz */
    }
  }
}

// Prefix `/auth` index.ts da beriladi — bu yerda nisbiy path.
export async function authRoutes(app: FastifyInstance) {
  // ===================== Ro'yxatdan o'tish =====================
  // Sodda: faqat email + parol. Kompaniya/biznes ma'lumotlari keyin (onboarding).
  app.post('/register/', { onRequest: rateLimit({ name: 'auth-register', max: 5, windowMs: 15 * 60_000 }) }, async (req, reply) => {
    const body = registerSchema.parse(req.body);

    // Email noyob bo'lishi shart.
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new ValidationError({ email: 'Bu email allaqachon ro\'yxatdan o\'tgan.' });
    }

    const user = await registerUser({
      email: body.email,
      password: body.password,
      full_name: body.full_name,
    });

    // Tasdiqlash tokeni + xat.
    try {
      await issueEmailVerification({ id: user.id, email: body.email });
    } catch (err) {
      req.log.error(err);
    }

    return reply.status(201).send({
      detail: 'Tasdiqlash xati yuborildi',
      email: body.email,
    });
  });

  // ===================== Email tasdiqlash =====================
  app.post('/verify-email/', async (req, reply) => {
    const body = verifyEmailSchema.parse(req.body);

    const record = await prisma.emailVerification.findUnique({ where: { token: body.token } });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequest({ detail: 'Token yaroqsiz yoki muddati o\'tgan.' });
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { isEmailVerified: true } }),
      prisma.emailVerification.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);

    return reply.send({ detail: 'Email tasdiqlandi' });
  });

  // ===================== Tasdiqlash xatini qayta yuborish =====================
  // Javob xavfsiz: email mavjudligini oshkor qilmaydi.
  app.post('/resend-verification/', { onRequest: rateLimit({ name: 'auth-resend', max: 5, windowMs: 15 * 60_000 }) }, async (req, reply) => {
    const body = resendVerificationSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (user && user.email && !user.isEmailVerified) {
      try {
        await issueEmailVerification({ id: user.id, email: user.email });
      } catch (err) {
        req.log.error(err);
      }
    }

    return reply.send({ detail: 'Agar email mavjud va tasdiqlanmagan bo\'lsa, tasdiqlash xati yuborildi.' });
  });

  // ===================== Kirish (telefon YOKI email) =====================
  app.post('/login/', { onRequest: rateLimit({ name: 'auth-login', max: 10, windowMs: 5 * 60_000 }) }, async (req, reply) => {
    const body = loginSchema.parse(req.body);

    // login = telefon raqami YOKI email. Ikkalasi bo'yicha qidiramiz.
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: body.login }, { phoneNumber: body.login }] },
      include: { role: { select: { name: true } } },
    });
    if (!user || !(await checkPassword(body.password, user.password))) {
      throw new ValidationError({ detail: 'Login yoki parol noto\'g\'ri!' });
    }
    if (!user.isActive) {
      throw new ValidationError({ detail: 'Foydalanuvchi faol emas!' });
    }

    const tokens = createTokens(user.id);
    setAuthCookies(reply, tokens.access, tokens.refresh);

    const meta = clientMeta(req);
    await prisma.$transaction([
      prisma.userHistory.create({
        data: { userId: user.id, action: 'li', ipAddress: meta.ip, userAgent: meta.userAgent },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date(), platform: meta.platform },
      }),
    ]);

    recordAudit({
      userId: user.id,
      companyId: user.companyId,
      action: 'login',
      entity: 'auth',
      summary: 'Tizimga kirdi',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      meta: { platform: meta.platform },
    });

    return reply.send({
      success: true,
      access: tokens.access,
      refresh: tokens.refresh,
      user: serializeUser(user),
    });
  });

  // ===================== Chiqish =====================
  app.post('/logout/', { onRequest: app.authenticate }, async (req, reply) => {
    revokeCurrentToken(req);
    clearAuthCookies(reply);
    const meta = clientMeta(req);
    await prisma.userHistory.create({
      data: { userId: req.authUser!.id, action: 'lo', ipAddress: meta.ip, userAgent: meta.userAgent },
    });
    recordAudit({
      userId: req.authUser!.id,
      companyId: req.authUser!.companyId,
      action: 'logout',
      entity: 'auth',
      summary: 'Tizimdan chiqdi',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    return reply.send({ success: true });
  });

  // ===================== Tokenni yangilash =====================
  app.post('/refresh/', async (req, reply) => {
    const cookies = req.cookies as Record<string, string | undefined>;
    const body = refreshSchema.parse(req.body ?? {});
    const refreshToken = cookies.refresh_token ?? body.refresh_token ?? body.refresh;
    if (!refreshToken) {
      throw new Unauthorized({ detail: 'Refresh token topilmadi.' });
    }
    try {
      // Bekor qilingan (logout qilingan) refresh token bilan yangi access berilmaydi.
      const payload = verifyRefresh(refreshToken);
      if (isTokenRevoked(payload.jti)) {
        throw new Unauthorized({ detail: 'Refresh token bekor qilingan.' });
      }
      const access = accessFromRefresh(refreshToken);
      reply.setCookie('access_token', access, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 60 * 60,
      });
      return reply.send({ success: true, access });
    } catch {
      throw new Unauthorized({ detail: 'Refresh token yaroqsiz yoki muddati o\'tgan.' });
    }
  });

  // ===================== Joriy foydalanuvchi konteksti (layout/menu) =====================
  app.get('/me/', { onRequest: app.authenticate }, async (req) => {
    const user = req.authUser!;

    // Role nomi (req.authUser plain User — role include qilinmagan).
    const role =
      user.roleId != null
        ? await prisma.role.findUnique({ where: { id: user.roleId }, select: { name: true } })
        : null;

    const permissions = [...req.permissions];
    // Platform (super admin panel) foydalanuvchisi: super admin YOKI isStaff YOKI
    // biror `platform.*` ruxsatga ega (eski platform foydalanuvchilari uchun ham).
    const isPlatform =
      user.isSuperuser || user.isStaff || permissions.some((c) => c.startsWith('platform.'));
    const menus = buildMenus(req.permissions, {
      isSuperuser: user.isSuperuser,
      isPlatform,
      subscriptionActive: req.subscriptionActive,
    });

    return {
      user: serializeUser({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        isSuperuser: user.isSuperuser,
        isEmailVerified: user.isEmailVerified,
        companyId: user.companyId,
        role,
      }),
      company: serializeCompany(req.company),
      subscription_active: req.subscriptionActive,
      is_superuser: user.isSuperuser,
      is_platform: isPlatform,
      permissions,
      menus,
    };
  });

  // ===================== Parolni o'zgartirish =====================
  app.post('/change-password/', { onRequest: app.authenticate }, async (req, reply) => {
    const body = changePasswordSchema.parse(req.body);
    const user = req.authUser!;

    if (!(await checkPassword(body.old_password, user.password))) {
      throw new ValidationError({ detail: 'Eski parolingiz noto\'g\'ri!' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await hashPassword(body.new_password) },
    });

    return reply.send({ detail: 'Parolingiz muvaffaqiyatli o\'zgartirildi.' });
  });

  // ===================== Parolni unutdim =====================
  // Javob xavfsiz: email mavjudligini oshkor qilmaydi.
  app.post('/forgot-password/', { onRequest: rateLimit({ name: 'auth-forgot', max: 5, windowMs: 15 * 60_000 }) }, async (req, reply) => {
    const body = forgotPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (user && user.email) {
      const uid = encodeUid(user.id);
      const token = makeToken(user.id, user.password);
      const resetLink = `${env.FRONTEND_URL}/reset-password?uid=${uid}&token=${token}`;
      try {
        await sendMail({
          to: user.email,
          subject: 'Parolni tiklash',
          text: `Parolingizni tiklash uchun quyidagi havolaga o'ting:\n${resetLink}\n\nHavola 1 soat amal qiladi.`,
          html: `<p>Parolingizni tiklash uchun quyidagi havolaga o'ting:</p>
<p><a href="${resetLink}">${resetLink}</a></p>
<p>Havola 1 soat amal qiladi.</p>`,
        });
      } catch (err) {
        req.log.error(err);
      }
    }

    return reply.send({ detail: 'Agar email mavjud bo\'lsa, parolni tiklash havolasi yuborildi.' });
  });

  // ===================== Parolni tiklash =====================
  app.post('/reset-password/', { onRequest: rateLimit({ name: 'auth-reset', max: 10, windowMs: 15 * 60_000 }) }, async (req, reply) => {
    const body = resetPasswordSchema.parse(req.body);

    const userId = decodeUid(body.uid);
    const user = Number.isFinite(userId)
      ? await prisma.user.findUnique({ where: { id: userId } })
      : null;
    if (!user) {
      throw new BadRequest({ detail: 'Token yaroqsiz.' });
    }
    if (!checkToken(user.id, user.password, body.token)) {
      throw new BadRequest({ detail: 'Token yaroqsiz yoki muddati o\'tgan.' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await hashPassword(body.password) },
    });

    return reply.send({ detail: 'Parol muvaffaqiyatli tiklandi.' });
  });
}
