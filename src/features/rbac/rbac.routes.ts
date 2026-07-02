import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Forbidden } from '../../common/errors.js';
import { getPageParams, paginate } from '../../common/pagination.js';
import {
  scopeQuerySchema,
  roleCreateSchema,
  roleUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
} from './rbac.schemas.js';
import {
  groupPermissionsByModule,
  listRoles,
  listAssignableRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  listUsers,
  listAllUsers,
  createUser,
  updateUser,
  deleteUser,
  deleteAnyUser,
  listAssignableStores,
} from './rbac.controller.js';

// Super admin tekshiruvi: isSuperuser YOKI platform.roles.manage ruxsati bo'lsa.
// (requireSuperuser faqat isSuperuser'ni tekshiradi; bu yerda ruxsat-asoslangan platform admin ham o'tadi.)
function isPlatformAdmin(req: FastifyRequest): boolean {
  return Boolean(req.authUser?.isSuperuser) || req.permissions.has('platform.roles.manage');
}

function idParam(req: FastifyRequest): number {
  return Number((req.params as { id: string }).id);
}

export async function rbacRoutes(app: FastifyInstance) {
  // ============================================================
  //  RUXSATLAR (faqat o'qish — UI rol yaratishda ruxsat tanlash uchun)
  // ============================================================
  // Super admin: platform+company; company user: faqat company.
  app.get('/permissions/', { onRequest: app.authenticate }, async (req) => {
    const { scope } = scopeQuerySchema.parse(req.query);
    const superadmin = isPlatformAdmin(req);

    let scopes: ('platform' | 'company')[];
    if (scope) {
      // So'ralgan scope ruxsat doirasiga mosligini tekshiramiz
      if (scope === 'platform' && !superadmin) throw new Forbidden();
      scopes = [scope];
    } else {
      scopes = superadmin ? ['platform', 'company'] : ['company'];
    }

    return groupPermissionsByModule(scopes);
  });

  // ============================================================
  //  PLATFORMA ROLLARI (super admin) — scope='platform', companyId=null
  // ============================================================
  app.get(
    '/platform/roles/',
    { onRequest: [app.authenticate, app.requirePermission('platform.roles.view')] },
    async () => {
      return listRoles('platform', null);
    },
  );

  app.post(
    '/platform/roles/',
    { onRequest: [app.authenticate, app.requirePermission('platform.roles.manage')] },
    async (req, reply) => {
      const body = roleCreateSchema.parse(req.body);
      return reply.status(201).send(await createRole(body, 'platform', null));
    },
  );

  app.get(
    '/platform/roles/:id/',
    { onRequest: [app.authenticate, app.requirePermission('platform.roles.view')] },
    async (req) => {
      return getRole(idParam(req), 'platform', null);
    },
  );

  app.put(
    '/platform/roles/:id/',
    { onRequest: [app.authenticate, app.requirePermission('platform.roles.manage')] },
    async (req) => {
      const body = roleUpdateSchema.parse(req.body);
      return updateRole(idParam(req), body, 'platform', null);
    },
  );

  app.delete(
    '/platform/roles/:id/',
    { onRequest: [app.authenticate, app.requirePermission('platform.roles.manage')] },
    async (req, reply) => {
      await deleteRole(idParam(req), 'platform', null);
      return reply.status(204).send();
    },
  );

  // ============================================================
  //  KOMPANIYA ROLLARI (company admin) — scope='company', companyId=req.companyId
  // ============================================================
  app.get(
    '/company/roles/',
    { onRequest: [app.authenticate, app.requireCompany, app.requirePermission('company.roles.view')] },
    async (req) => {
      return listRoles('company', req.companyId);
    },
  );

  app.post(
    '/company/roles/',
    { onRequest: [app.authenticate, app.requireCompany, app.requirePermission('company.roles.create')] },
    async (req, reply) => {
      const body = roleCreateSchema.parse(req.body);
      return reply.status(201).send(await createRole(body, 'company', req.companyId));
    },
  );

  app.get(
    '/company/roles/:id/',
    { onRequest: [app.authenticate, app.requireCompany, app.requirePermission('company.roles.view')] },
    async (req) => {
      return getRole(idParam(req), 'company', req.companyId);
    },
  );

  app.put(
    '/company/roles/:id/',
    { onRequest: [app.authenticate, app.requireCompany, app.requirePermission('company.roles.update')] },
    async (req) => {
      const body = roleUpdateSchema.parse(req.body);
      return updateRole(idParam(req), body, 'company', req.companyId);
    },
  );

  app.delete(
    '/company/roles/:id/',
    { onRequest: [app.authenticate, app.requireCompany, app.requirePermission('company.roles.delete')] },
    async (req, reply) => {
      await deleteRole(idParam(req), 'company', req.companyId);
      return reply.status(204).send();
    },
  );

  // ============================================================
  //  KOMPANIYA FOYDALANUVCHILARI (company admin) — companyId=req.companyId
  // ============================================================
  // Xodimga biriktirish uchun rollar ro'yxati (company.users.view bilan ochiq).
  app.get(
    '/company/assignable-roles/',
    { onRequest: [app.authenticate, app.requireCompany, app.requirePermission('company.users.view')] },
    async (req) => {
      return listAssignableRoles('company', req.companyId);
    },
  );

  // Xodimni biriktirish uchun kompaniya do'konlari (company.users.view bilan ochiq).
  app.get(
    '/company/assignable-stores/',
    { onRequest: [app.authenticate, app.requireCompany, app.requirePermission('company.users.view')] },
    async (req) => {
      return listAssignableStores(req.companyId);
    },
  );

  app.get(
    '/company/users/',
    { onRequest: [app.authenticate, app.requireCompany, app.requirePermission('company.users.view')] },
    async (req) => {
      const page = getPageParams(req);
      const { results, count } = await listUsers('company', req.companyId, page);
      return paginate(req, results, count, page);
    },
  );

  app.post(
    '/company/users/',
    { onRequest: [app.authenticate, app.requireCompany, app.requirePermission('company.users.create')] },
    async (req, reply) => {
      const body = userCreateSchema.parse(req.body);
      return reply.status(201).send(await createUser(body, 'company', req.companyId));
    },
  );

  app.put(
    '/company/users/:id/',
    { onRequest: [app.authenticate, app.requireCompany, app.requirePermission('company.users.update')] },
    async (req) => {
      const body = userUpdateSchema.parse(req.body);
      return updateUser(idParam(req), body, 'company', req.companyId);
    },
  );

  app.delete(
    '/company/users/:id/',
    { onRequest: [app.authenticate, app.requireCompany, app.requirePermission('company.users.delete')] },
    async (req, reply) => {
      await deleteUser(idParam(req), 'company', req.companyId);
      return reply.status(204).send();
    },
  );

  // ============================================================
  //  PLATFORMA FOYDALANUVCHILARI (super admin) — companyId=null
  // ============================================================
  app.get(
    '/platform/users/',
    { onRequest: [app.authenticate, app.requirePermission('platform.users.view')] },
    async (req) => {
      const page = getPageParams(req);
      const { results, count } = await listUsers('platform', null, page);
      return paginate(req, results, count, page);
    },
  );

  // BARCHA foydalanuvchilar (platform + barcha kompaniyalar) — super admin ko'radi.
  app.get(
    '/all-users/',
    { onRequest: [app.authenticate, app.requirePermission('platform.users.view')] },
    async (req) => {
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const companyId = q.company_id ? Number(q.company_id) : undefined;
      const { results, count } = await listAllUsers({ search: q.search, company_id: companyId }, page);
      return paginate(req, results, count, page);
    },
  );

  // Super admin: barcha foydalanuvchilar ro'yxatidan istalgan userni o'chirish.
  // `?cascade_company=true` — kompaniyaga tegishli bo'lsa, kompaniya bilan birga o'chiradi.
  app.delete(
    '/all-users/:id/',
    { onRequest: [app.authenticate, app.requirePermission('platform.users.manage')] },
    async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const cascadeCompany = q.cascade_company === 'true' || q.cascade_company === '1';
      await deleteAnyUser(idParam(req), { cascadeCompany }, req.authUser!.id);
      return reply.status(204).send();
    },
  );

  app.post(
    '/platform/users/',
    { onRequest: [app.authenticate, app.requirePermission('platform.users.manage')] },
    async (req, reply) => {
      const body = userCreateSchema.parse(req.body);
      return reply.status(201).send(await createUser(body, 'platform', null));
    },
  );

  app.put(
    '/platform/users/:id/',
    { onRequest: [app.authenticate, app.requirePermission('platform.users.manage')] },
    async (req) => {
      const body = userUpdateSchema.parse(req.body);
      return updateUser(idParam(req), body, 'platform', null);
    },
  );

  app.delete(
    '/platform/users/:id/',
    { onRequest: [app.authenticate, app.requirePermission('platform.users.manage')] },
    async (req, reply) => {
      await deleteUser(idParam(req), 'platform', null);
      return reply.status(204).send();
    },
  );
}
