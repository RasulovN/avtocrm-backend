import type { FastifyInstance } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import { leadCreateSchema, leadAdminCreateSchema, leadUpdateSchema } from './leads.schemas.js';
import { createLead, createLeadAdmin, listLeads, updateLead, deleteLead, serializeLead } from './leads.service.js';

export async function leadsRoutes(app: FastifyInstance) {
  // ===================== PUBLIC (landing "Demo so'rash") =====================
  // POST / — autentifikatsiyasiz zayavka qabul qilish.
  app.post('/', async (req, reply) => {
    const body = leadCreateSchema.parse(req.body);
    const lead = await createLead(body);
    return reply.status(201).send({ ok: true, id: lead.id });
  });

  // ===================== Super admin =====================
  // GET / — zayavkalar ro'yxati (status/source filtri + qidiruv + paginatsiya).
  app.get('/', { onRequest: app.requirePermission('platform.leads.view') }, async (req) => {
    const params = getPageParams(req);
    const q = req.query as Record<string, string | undefined>;
    const { items, total, newCount, counts } = await listLeads({
      skip: params.skip,
      take: params.take,
      status: q.status,
      source: q.source,
      search: q.search,
    });
    const page = paginate(req, items.map(serializeLead), total, params);
    return { ...page, new_count: newCount, counts };
  });

  // POST /manual/ — super admin qo'lda yangi lead qo'shadi.
  app.post('/manual/', { onRequest: app.requirePermission('platform.leads.manage') }, async (req, reply) => {
    const body = leadAdminCreateSchema.parse(req.body);
    const lead = await createLeadAdmin(body);
    return reply.status(201).send(serializeLead(lead));
  });

  // PATCH /:id/ — leadni tahrirlash (maydonlar / status / izoh).
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
