import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../db/prisma.js';
import { checkPassword, hashPassword } from '../../common/password.js';
import { createTokens, accessFromRefresh } from '../../common/jwt.js';
import { setAuthCookies, clearAuthCookies } from '../../common/cookies.js';
import { recordAudit } from '../../common/audit.js';
import { checkValidPhone } from '../../common/validators.js';
import { getPageParams, paginate } from '../../common/pagination.js';
import { getCompanyId } from '../../common/tenant.js';
import { BadRequest, Unauthorized, ValidationError } from '../../common/errors.js';
import { makeToken, checkToken, encodeUid, decodeUid } from '../../common/passwordReset.js';
import { sendMail } from '../../common/email.js';
import { env } from '../../config/env.js';
import {
  loginSchema,
  sellerCreateSchema,
  userUpdateSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  customerWriteSchema,
} from './users.schemas.js';
import {
  listUsers,
  getUser,
  updateUser,
  deleteUser,
  createSellerWithStore,
  serializeUser,
  serializeUserResponse,
} from './users.service.js';
import { getProfile } from './profile.service.js';
import {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from './customer.service.js';

function clientMeta(req: FastifyRequest) {
  const raw = String(req.headers['x-platform'] ?? '').toLowerCase();
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
    platform: raw === 'mobile' ? 'mobile' : 'web',
  };
}

export async function usersRoutes(app: FastifyInstance) {
  // ===================== Profile =====================
  app.get('/profile/', { onRequest: app.authenticate }, async (req) => {
    return getProfile(req.authUser!);
  });

  // ===================== Auth =====================
  app.post('/login/', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    checkValidPhone(body.phone_number);

    const user = await prisma.user.findUnique({ where: { phoneNumber: body.phone_number } });
    if (!user || !(await checkPassword(body.password, user.password))) {
      throw new ValidationError({ message: "phone_number yoki parol noto'g'ri!" });
    }
    if (!user.isActive) {
      throw new ValidationError({ message: 'Foydalanuvchi faol emas!' });
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
      user_id: user.id,
      full_name: user.fullName,
      phone_number: user.phoneNumber,
      access: tokens.access,
      refresh: tokens.refresh,
    });
  });

  app.post('/logout/', { onRequest: app.authenticate }, async (req, reply) => {
    clearAuthCookies(reply);
    const meta = clientMeta(req);
    recordAudit({
      userId: req.authUser!.id,
      companyId: req.authUser!.companyId,
      action: 'logout',
      entity: 'auth',
      summary: 'Tizimdan chiqdi',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    await prisma.userHistory.create({
      data: { userId: req.authUser!.id, action: 'lo', ipAddress: meta.ip, userAgent: meta.userAgent },
    });
    return reply.send({ success: true });
  });

  app.post('/auth/refresh/', async (req, reply) => {
    const cookies = req.cookies as Record<string, string | undefined>;
    const refreshToken = cookies.refresh_token ?? cookies.refreshToken ?? (req.body as { refresh?: string })?.refresh;
    if (!refreshToken) {
      throw new Unauthorized({ detail: 'Refresh token topilmadi.' });
    }
    try {
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
      throw new Unauthorized({ detail: "Refresh token yaroqsiz yoki muddati o'tgan." });
    }
  });

  app.post('/change-password/', { onRequest: app.authenticate }, async (req, reply) => {
    const body = changePasswordSchema.parse(req.body);
    const user = req.authUser!;
    if (!(await checkPassword(body.old_password, user.password))) {
      return reply.status(400).send({
        seccess: false,
        status_code: 400,
        message: "Eski parolingiz noto'g'ri!",
      });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { password: await hashPassword(body.new_password) },
    });
    return reply.send({ success: true, status_code: 200, message: "Parolingiz muvofaqiyatli o'zgartirildi" });
  });

  app.post('/auth/forgot-password/', async (req, reply) => {
    const body = forgotPasswordSchema.parse(req.body);
    const user = await prisma.user.findFirst({ where: { email: body.email } });
    if (user) {
      const uid = encodeUid(user.id);
      const token = makeToken(user.id, user.password);
      const resetLink = `${env.FRONTEND_URL}/reset-password/${uid}/${token}/`;
      try {
        await sendMail({
          to: user.email!,
          subject: 'Password Reset',
          text: `Click the link below to reset your password:\n${resetLink}\n\nThis link will expire in 1 hour.`,
          html: `<p>Click the link below to reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p><p>This link will expire in 1 hour.</p>`,
        });
      } catch (err) {
        req.log.error(err);
      }
    }
    return reply.send({
      detail: `If the email exists, a reset link has been sent.(${user?.email ?? ''})`,
    });
  });

  app.post('/auth/reset-password/:uidb64/:token/', async (req, reply) => {
    const { uidb64, token } = req.params as { uidb64: string; token: string };
    const body = resetPasswordSchema.parse(req.body);

    const userId = decodeUid(uidb64);
    const user = Number.isFinite(userId) ? await prisma.user.findUnique({ where: { id: userId } }) : null;
    if (!user) {
      throw new BadRequest({ detail: 'Invalid token.' });
    }
    if (!checkToken(user.id, user.password, token)) {
      throw new BadRequest({ detail: 'Token is invalid or expired.' });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { password: await hashPassword(body.password) },
    });
    return reply.send({ detail: 'Password successfully reset.' });
  });

  // ===================== Users CRUD =====================
  // DRF: UsersListView permission AllowAny, pagination None
  app.get('/', async () => {
    return listUsers();
  });

  app.get('/:id/', { onRequest: app.authenticate }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const user = await getUser(id);
    return serializeUser(user);
  });

  app.put('/:id/', { onRequest: app.authenticate }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = userUpdateSchema.parse(req.body);
    if (body.phone_number) checkValidPhone(body.phone_number);
    const user = await updateUser(id, body);
    return serializeUser(user);
  });

  app.delete('/:id/', { onRequest: app.authenticate }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await deleteUser(id);
    return reply.status(204).send();
  });

  // Seller create
  app.post('/seller-create/', { onRequest: app.authenticate }, async (req, reply) => {
    const body = sellerCreateSchema.parse(req.body);
    checkValidPhone(body.phone_number);
    const user = await createSellerWithStore({
      requestUserIsSuperuser: req.authUser!.isSuperuser,
      full_name: body.full_name,
      phone_number: body.phone_number,
      email: body.email,
      password: body.password,
      store_id: body.store_id,
      role: body.role,
    });
    return reply.status(201).send(await serializeUserResponse(user.id));
  });

  // ===================== Customers (tenant-scoped) =====================
  app.get(
    '/customers/list/',
    { onRequest: [app.requireCompany, app.requirePermission('company.customers.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const { results, count } = await listCustomers({
        companyId,
        search: q.search,
        ordering: q.ordering,
        page,
      });
      return paginate(req, results, count, page);
    },
  );

  app.post(
    '/customers/create/',
    { onRequest: [app.requireCompany, app.requirePermission('company.customers.create')] },
    async (req, reply) => {
      const body = customerWriteSchema.parse(req.body);
      return reply.status(201).send(await createCustomer(getCompanyId(req), body));
    },
  );

  app.get(
    '/customers/:id/',
    { onRequest: [app.requireCompany, app.requirePermission('company.customers.view')] },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      return getCustomer(getCompanyId(req), id);
    },
  );

  app.put(
    '/customers/:id/',
    { onRequest: [app.requireCompany, app.requirePermission('company.customers.update')] },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      const body = customerWriteSchema.partial().parse(req.body);
      return updateCustomer(getCompanyId(req), id, body);
    },
  );

  app.delete(
    '/customers/:id/',
    { onRequest: [app.requireCompany, app.requirePermission('company.customers.delete')] },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      await deleteCustomer(getCompanyId(req), id);
      return reply.status(204).send();
    },
  );
}
