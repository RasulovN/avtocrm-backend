import type { FastifyInstance } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import {
  subscriptionCreateSchema,
  subscriptionPatchSchema,
} from './subscriptions.schemas.js';
import {
  createSubscription,
  listMySubscriptions,
  getMyActiveSubscription,
  listMyPaymentHistory,
  cancelMyPendingSubscription,
  listAllSubscriptions,
  patchSubscription,
  setSubscriptionFiscal,
} from './subscriptions.service.js';
import { getLimitsAndUsage } from './planLimits.js';

export async function subscriptionsRoutes(app: FastifyInstance) {
  // ===================== Kompaniya tomoni =====================

  // POST / — obuna yaratish + Payme checkout havolasi.
  app.post(
    '/',
    {
      onRequest: [app.requireCompany, app.requirePermission('company.subscription.manage')],
    },
    async (req, reply) => {
      const body = subscriptionCreateSchema.parse(req.body);
      const result = await createSubscription(req.companyId!, body.plan_id, body.months ?? 1);
      return reply.status(201).send(result);
    },
  );

  // GET /me/ — kompaniya obunalari (joriy faol + tarix).
  app.get('/me/', { onRequest: app.requireCompany }, async (req) => {
    return listMySubscriptions(req.companyId!);
  });

  // GET /me/active/ — faol obuna yoki null + qolgan kunlar.
  app.get('/me/active/', { onRequest: app.requireCompany }, async (req) => {
    return getMyActiveSubscription(req.companyId!);
  });

  // GET /me/limits/ — joriy tarif limitlari + foydalanish (do'kon/foydalanuvchi soni).
  // Frontend "Add" tugmalarini bloklash va "used/max" ko'rsatish uchun ishlatadi.
  app.get('/me/limits/', { onRequest: app.requireCompany }, async (req) => {
    return getLimitsAndUsage(req.companyId!);
  });

  // GET /me/history/ — to'lovlar/obuna tarixi (pagination).
  app.get('/me/history/', { onRequest: app.requireCompany }, async (req) => {
    const page = getPageParams(req);
    const { results, count } = await listMyPaymentHistory(req.companyId!, page);
    return paginate(req, results, count, page);
  });

  // POST /me/:id/cancel/ — kompaniya admini kutilayotgan (pending) to'lovni bekor qiladi.
  app.post(
    '/me/:id/cancel/',
    { onRequest: [app.requireCompany, app.requirePermission('company.subscription.manage')] },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      return cancelMyPendingSubscription(req.companyId!, id);
    },
  );

  // ===================== Super admin tomoni =====================

  // GET / — barcha obunalar (filter status/company_id + pagination).
  app.get(
    '/',
    { onRequest: app.requirePermission('platform.subscriptions.view') },
    async (req) => {
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const companyId = q.company_id ? Number(q.company_id) : undefined;
      const { results, count } = await listAllSubscriptions(
        { status: q.status, company_id: companyId },
        page,
      );
      return paginate(req, results, count, page);
    },
  );

  // GET /payments/ — super admin: faqat TO'LOV qilingan obunalar (chek bilan).
  // "Obuna & to'lovlar > To'lovlar" menyusi shu endpointdan foydalanadi.
  app.get(
    '/payments/',
    { onRequest: app.requirePermission('platform.payments.view') },
    async (req) => {
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const companyId = q.company_id ? Number(q.company_id) : undefined;
      const { results, count } = await listAllSubscriptions(
        { status: q.status, company_id: companyId, paid: true },
        page,
      );
      return paginate(req, results, count, page);
    },
  );

  // PATCH /:id/ — qo'lda status o'zgartirish (activate / cancel).
  app.patch(
    '/:id/',
    { onRequest: app.requirePermission('platform.subscriptions.manage') },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      const body = subscriptionPatchSchema.parse(req.body);
      return patchSubscription(id, body.action, body.days);
    },
  );

  // PUT /:id/fiscal/ — soliq (OFD) fiskal chek havolasini biriktirish/tozalash.
  app.put(
    '/:id/fiscal/',
    { onRequest: app.requirePermission('platform.subscriptions.manage') },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      const body = (req.body ?? {}) as { fiscal_url?: string | null };
      return setSubscriptionFiscal(id, body.fiscal_url ?? null);
    },
  );
}
