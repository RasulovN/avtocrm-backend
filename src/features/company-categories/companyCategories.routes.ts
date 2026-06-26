import type { FastifyInstance, FastifyRequest } from 'fastify';
import { resolveLang } from '../../common/i18n.js';
import { categoryCreateSchema, categoryUpdateSchema } from './companyCategories.schemas.js';
import {
  listActiveCategories,
  listAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from './companyCategories.service.js';

function idParam(req: FastifyRequest): number {
  return Number((req.params as { id: string }).id);
}

export async function companyCategoriesRoutes(app: FastifyInstance) {
  const manage = {
    onRequest: [app.authenticate, app.requirePermission('platform.company_categories.manage')],
  };

  // ============================================================
  //  PUBLIC: faol kategoriyalar (onboarding'da tanlash uchun — authenticate yetarli)
  //  ?all=true va super admin bo'lsa -> barchasi (nofaol ham + kompaniyalar soni)
  // ============================================================
  app.get('/', { onRequest: app.authenticate }, async (req) => {
    const lang = resolveLang(req);
    const q = req.query as Record<string, string | undefined>;
    const wantAll = q.all === 'true';
    const isAdmin =
      req.authUser?.isSuperuser || req.permissions.has('platform.company_categories.view');
    if (wantAll && isAdmin) {
      return listAllCategories(lang);
    }
    return listActiveCategories(lang);
  });

  // Super admin uchun alohida ro'yxat (barchasi + kompaniyalar soni)
  app.get(
    '/admin/',
    { onRequest: [app.authenticate, app.requirePermission('platform.company_categories.view')] },
    async (req) => {
      return listAllCategories(resolveLang(req));
    },
  );

  // ============================================================
  //  SUPER ADMIN CRUD
  // ============================================================
  app.post('/', manage, async (req, reply) => {
    const body = categoryCreateSchema.parse(req.body);
    return reply.status(201).send(await createCategory(body, resolveLang(req)));
  });

  app.put('/:id/', manage, async (req) => {
    const body = categoryUpdateSchema.parse(req.body);
    return updateCategory(idParam(req), body, resolveLang(req));
  });

  app.delete('/:id/', manage, async (req, reply) => {
    await deleteCategory(idParam(req));
    return reply.status(204).send();
  });
}
