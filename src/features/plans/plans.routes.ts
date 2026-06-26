import type { FastifyInstance } from 'fastify';
import { resolveLang } from '../../common/i18n.js';
import { planCreateSchema, planUpdateSchema } from './plans.schemas.js';
import {
  listActivePlans,
  listAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
} from './plans.service.js';

export async function plansRoutes(app: FastifyInstance) {
  // ===================== PUBLIC (landing) =====================
  // GET /public/ — faol tariflar, autentifikatsiyasiz (landing sahifa uchun).
  // 4 til maydonlari ham qaytadi (name_uz/ru/en/uz_cyrl, description_*).
  app.get('/public/', async (req) => {
    return listActivePlans(resolveLang(req));
  });

  // ===================== PUBLIC list =====================
  // GET / — faol tariflar (kompaniya tanlovi uchun). Faqat autentifikatsiya talab qilinadi.
  app.get('/', { onRequest: app.authenticate }, async (req) => {
    return listActivePlans(resolveLang(req));
  });

  // ===================== Super admin CRUD =====================
  // GET /admin/ — barcha tariflar (nofaol ham).
  app.get(
    '/admin/',
    { onRequest: app.requirePermission('platform.plans.manage') },
    async (req) => {
      return listAllPlans(resolveLang(req));
    },
  );

  // POST / — tarif yaratish.
  app.post(
    '/',
    { onRequest: app.requirePermission('platform.plans.manage') },
    async (req, reply) => {
      const body = planCreateSchema.parse(req.body);
      const plan = await createPlan(body, resolveLang(req));
      return reply.status(201).send(plan);
    },
  );

  // PUT /:id/ — tarifni yangilash.
  app.put(
    '/:id/',
    { onRequest: app.requirePermission('platform.plans.manage') },
    async (req) => {
      const id = Number((req.params as { id: string }).id);
      const body = planUpdateSchema.parse(req.body);
      return updatePlan(id, body, resolveLang(req));
    },
  );

  // DELETE /:id/ — tarifni o'chirish (bog'langan obuna bo'lsa 400).
  app.delete(
    '/:id/',
    { onRequest: app.requirePermission('platform.plans.manage') },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      await deletePlan(id);
      return reply.status(204).send();
    },
  );
}
