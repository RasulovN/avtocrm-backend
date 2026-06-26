import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPageParams, paginate } from '../../common/pagination.js';
import { BadRequest } from '../../common/errors.js';
import {
  listForUser,
  unreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  clearNotifications,
  createBroadcast,
  listBroadcasts,
  deleteBroadcast,
  isValidAudience,
} from './notification.service.js';

const broadcastSchema = z.object({
  title: z.string().min(1).max(255),
  message: z.string().min(1),
  link: z.string().max(255).nullable().optional(),
  audience: z.enum(['all', 'mobile', 'company_users', 'company_admins', 'company']),
  company: z.number().int().nullable().optional(),
});

export async function notificationsRoutes(app: FastifyInstance) {
  // ─────────────── Foydalanuvchining o'z bildirishnomalari ───────────────

  // GET / — mening bildirishnomalarim (?unread=1 — faqat o'qilmagan; ?archived=1 — arxiv)
  app.get('/', { onRequest: app.authenticate }, async (req) => {
    const page = getPageParams(req);
    const q = req.query as Record<string, string | undefined>;
    const unreadOnly = q.unread === '1' || q.unread === 'true';
    const archived = q.archived === '1' || q.archived === 'true';
    const { results, count } = await listForUser(req.authUser!.id, { page, unreadOnly, archived });
    return paginate(req, results, count, page);
  });

  // GET /unread-count/ — o'qilmaganlar soni
  app.get('/unread-count/', { onRequest: app.authenticate }, async (req) => {
    return { count: await unreadCount(req.authUser!.id) };
  });

  // POST /:id/read/ — bittasini o'qilgan deb belgilash
  app.post('/:id/read/', { onRequest: app.authenticate }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) throw new BadRequest('Invalid id');
    await markRead(req.authUser!.id, id);
    return { status: 'ok' };
  });

  // POST /read-all/ — hammasini o'qilgan deb belgilash
  app.post('/read-all/', { onRequest: app.authenticate }, async (req) => {
    const updated = await markAllRead(req.authUser!.id);
    return { status: 'ok', updated };
  });

  // DELETE /:id/ — bittasini o'chirish
  app.delete('/:id/', { onRequest: app.authenticate }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) throw new BadRequest('Invalid id');
    await deleteNotification(req.authUser!.id, id);
    return { status: 'ok' };
  });

  // DELETE / — hammasini tozalash (?read=1 — faqat o'qilganlar)
  app.delete('/', { onRequest: app.authenticate }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const readOnly = q.read === '1' || q.read === 'true';
    const deleted = await clearNotifications(req.authUser!.id, { readOnly });
    return { status: 'ok', deleted };
  });

  // ─────────────── Super admin broadcast ───────────────

  // POST /broadcast/ — segmentga ommaviy bildirishnoma yuborish
  app.post('/broadcast/', { onRequest: app.requireSuperuser }, async (req, reply) => {
    const body = broadcastSchema.parse(req.body);
    if (!isValidAudience(body.audience)) throw new BadRequest('Invalid audience');
    if (body.audience === 'company' && !body.company) {
      throw new BadRequest("audience='company' uchun kompaniya tanlanishi shart");
    }
    const result = await createBroadcast({
      createdById: req.authUser!.id,
      title: body.title,
      message: body.message,
      link: body.link ?? null,
      audience: body.audience,
      companyId: body.company ?? null,
    });
    return reply.status(201).send(result);
  });

  // GET /broadcasts/ — yuborilgan broadcast'lar tarixi
  app.get('/broadcasts/', { onRequest: app.requireSuperuser }, async (req) => {
    const page = getPageParams(req);
    const { results, count } = await listBroadcasts(page);
    return paginate(req, results, count, page);
  });

  // DELETE /broadcasts/:id/ — yuborilgan broadcast'ni admin o'z ko'rinishidan o'chiradi.
  // Qabul qiluvchilarning bildirishnomalari DB'da QOLADI (onDelete: SetNull).
  app.delete('/broadcasts/:id/', { onRequest: app.requireSuperuser }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) throw new BadRequest('Invalid id');
    await deleteBroadcast(id);
    return { status: 'ok' };
  });
}
