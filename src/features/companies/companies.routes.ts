import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import { onboardingSchema, profileUpdateSchema, statusUpdateSchema } from './companies.schemas.js';
import { contactInfoSchema } from '../site-settings/siteSettings.schemas.js';
import {
  onboardCompany,
  getMyCompany,
  updateMyCompany,
  updateMyCompanyContact,
  listCompanies,
  getCompanyById,
  updateCompanyStatus,
  deleteCompany,
} from './companies.service.js';

function idParam(req: FastifyRequest): number {
  return Number((req.params as { id: string }).id);
}

export async function companiesRoutes(app: FastifyInstance) {
  // ============================================================
  //  ONBOARDING — yangi kompaniya yaratish (atomik)
  //  Guard: authenticate + requireEmailVerified
  // ============================================================
  app.post(
    '/onboarding/',
    { onRequest: [app.authenticate, app.requireEmailVerified] },
    async (req, reply) => {
      const body = onboardingSchema.parse(req.body);
      const result = await onboardCompany(req.authUser!, body);
      return reply.status(201).send(result);
    },
  );

  // ============================================================
  //  O'Z KOMPANIYASI (company tomoni)
  // ============================================================

  // To'liq profil
  app.get('/me/', { onRequest: [app.authenticate, app.requireCompany] }, async (req) => {
    return getMyCompany(req.companyId!);
  });

  // Profil yangilash
  app.put(
    '/me/',
    {
      onRequest: [
        app.authenticate,
        app.requireCompany,
        app.requirePermission('company.profile.update'),
      ],
    },
    async (req) => {
      const body = profileUpdateSchema.parse(req.body);
      return updateMyCompany(req.companyId!, body);
    },
  );

  // Kompaniya aloqa ma'lumotlari (ContactInfo: telefon, email, manzil, xarita, ijtimoiy tarmoqlar)
  app.put(
    '/me/contact/',
    {
      onRequest: [
        app.authenticate,
        app.requireCompany,
        app.requirePermission('company.profile.update'),
      ],
    },
    async (req) => {
      const body = contactInfoSchema.parse(req.body);
      return updateMyCompanyContact(req.companyId!, body);
    },
  );

  // ============================================================
  //  SUPER ADMIN (platforma tomoni)
  // ============================================================

  // Barcha kompaniyalar — search + filter(status, category_id) + pagination
  app.get(
    '/',
    { onRequest: [app.authenticate, app.requirePermission('platform.companies.view')] },
    async (req) => {
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const categoryId = q.category_id ? Number(q.category_id) : undefined;
      const { results, count } = await listCompanies({
        search: q.search,
        status: q.status,
        categoryId: categoryId && Number.isInteger(categoryId) ? categoryId : undefined,
        page,
      });
      return paginate(req, results, count, page);
    },
  );

  // Bitta kompaniya to'liq
  app.get(
    '/:id/',
    { onRequest: [app.authenticate, app.requirePermission('platform.companies.view')] },
    async (req) => {
      return getCompanyById(idParam(req));
    },
  );

  // Status / is_active o'zgartirish (faollashtirish / to'xtatish)
  app.patch(
    '/:id/status/',
    { onRequest: [app.authenticate, app.requirePermission('platform.companies.manage')] },
    async (req) => {
      const body = statusUpdateSchema.parse(req.body);
      return updateCompanyStatus(idParam(req), body);
    },
  );

  // O'chirish (cascade bog'liqliklar)
  app.delete(
    '/:id/',
    { onRequest: [app.authenticate, app.requirePermission('platform.companies.manage')] },
    async (req, reply) => {
      await deleteCompany(idParam(req));
      return reply.status(204).send();
    },
  );
}
