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
  listAllSubscriptions,
  patchSubscription,
} from './subscriptions.service.js';

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
      const result = await createSubscription(req.companyId!, body.plan_id);
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
}
