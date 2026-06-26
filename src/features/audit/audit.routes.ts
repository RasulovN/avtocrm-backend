import type { FastifyInstance } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import { listAuditLogs, type AuditScope } from './audit.service.js';

export async function auditRoutes(app: FastifyInstance) {
  // GET /logs/ — rol bo'yicha avtomatik doiralanadi:
  //   super admin -> barcha loglar
  //   kompaniya admini (company.users.view) -> o'z kompaniyasi loglari
  //   oddiy foydalanuvchi -> faqat o'z loglari
  app.get('/logs/', { onRequest: app.authenticate }, async (req) => {
    const page = getPageParams(req);
    const q = req.query as Record<string, string | undefined>;
    const user = req.authUser!;

    let scope: AuditScope;
    if (user.isSuperuser) {
      scope = { type: 'all' };
    } else if (req.companyId && req.permissions.has('company.users.view')) {
      scope = { type: 'company', companyId: req.companyId };
    } else {
      scope = { type: 'user', userId: user.id };
    }

    const { results, count } = await listAuditLogs(
      scope,
      {
        action: q.action,
        entity: q.entity,
        userId: q.user_id ? Number(q.user_id) : undefined,
        companyId: q.company_id ? Number(q.company_id) : undefined,
        dateFrom: q.date_from,
        dateTo: q.date_to,
      },
      page,
    );
    return paginate(req, results, count, page);
  });

  // GET /my/ — har doim faqat o'zining loglari (har bir foydalanuvchi uchun)
  app.get('/my/', { onRequest: app.authenticate }, async (req) => {
    const page = getPageParams(req);
    const q = req.query as Record<string, string | undefined>;
    const { results, count } = await listAuditLogs(
      { type: 'user', userId: req.authUser!.id },
      { action: q.action, entity: q.entity, dateFrom: q.date_from, dateTo: q.date_to },
      page,
    );
    return paginate(req, results, count, page);
  });
}
