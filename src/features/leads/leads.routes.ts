import type { FastifyInstance } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import { leadCreateSchema, leadUpdateSchema } from './leads.schemas.js';
import { createLead, listLeads, updateLead, deleteLead, serializeLead } from './leads.service.js';

export async function leadsRoutes(app: FastifyInstance) {
  // ===================== PUBLIC (landing "Demo so'rash") =====================
  // POST / — autentifikatsiyasiz zayavka qabul qilish.
  app.post('/', async (req, reply) => {
    const body = leadCreateSchema.parse(req.body);
    const lead = await createLead(body);
    return reply.status(201).send({ ok: true, id: lead.id });
  });

  // ===================== Super admin =====================
  // GET / — zayavkalar ro'yxati (status filtri + qidiruv + paginatsiya).
  app.get('/', { onRequest: app.requirePermission('platform.leads.view') }, async (req) => {
    const params = getPageParams(req);
    const q = req.query as Record<string, string | undefined>;
    const { items, total, newCount } = await listLeads({
      skip: params.skip,
      take: params.take,
      status: q.status,
      search: q.search,
    });
    const page = paginate(req, items.map(serializeLead), total, params);
    return { ...page, new_count: newCount };
  });

  // PATCH /:id/ — status / izoh yangilash.
  app.patch('/:id/', { onRequest: app.requirePermission('platform.leads.manage') }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const body = leadUpdateSchema.parse(req.body);
    return serializeLead(await updateLead(id, body));
  });

  // DELETE /:id/ — zayavkani o'chirish.
  app.delete('/:id/', { onRequest: app.requirePermission('platform.leads.manage') }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    await deleteLead(id);
    return reply.status(204).send();
  });
}
