import type { FastifyInstance } from 'fastify';
import { getCompanyId } from '../../common/tenant.js';
import { getPageParams, paginate } from '../../common/pagination.js';
import {
  transferCreateSchema,
  transferSessionUpsertSchema,
  transferSessionCompleteSchema,
} from './transfer.schemas.js';
import {
  createTransfer,
  approveTransfer,
  rejectTransfer,
  listTransfers,
  listNotifications,
} from './transfer.service.js';
import {
  listActiveSessions,
  createSession,
  getSessionOr404,
  serializeTransferSession,
  updateSession,
  cancelSession,
  completeSession,
} from './transferSession.service.js';
import { buildTransferExportExcel } from '../exports/excelExports.service.js';

// Django: apps/transfer/urls.py. Multi-tenant: companyId scope + RBAC guard.
//   ''                        -> ro'yxat (filtr+pagination)   (company.transfers.view)
//   'export/'                 -> Excel eksport                (company.transfers.export)
//   'create/'                 -> yaratish                     (company.transfers.create)
//   'session/'                -> qoralamalar (list/create)    (company.transfers.create)
//   'session/:pk/'            -> qoralama (get/patch/delete)  (company.transfers.create)
//   'session/:pk/complete/'   -> qoralamani yakunlash         (company.transfers.create)
//   ':pk/approve/'            -> tasdiqlash                   (company.transfers.approve)
//   ':pk/reject/'             -> rad etish                    (company.transfers.approve)
//   'notifications/'          -> bildirishnomalar             (company.transfers.view)
export async function transferRoutes(app: FastifyInstance) {
  app.get(
    '/',
    { onRequest: [app.requireCompany, app.requirePermission('company.transfers.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const q = req.query as Record<string, string | undefined>;
      const params = getPageParams(req);
      const { results, count } = await listTransfers({
        companyId,
        filters: {
          search: (q.search ?? '').trim() || null,
          status: (q.status ?? '').trim() || null,
          dateFrom: q.date_from ?? null,
          dateTo: q.date_to ?? null,
        },
        skip: params.skip,
        take: params.take,
      });
      return paginate(req, results, count, params);
    },
  );

  // GET export/ — TransferExportAPIView (.xlsx) — ro'yxat filtrlari bilan birdek
  app.get(
    '/export/',
    { onRequest: [app.requireCompany, app.requirePermission('company.transfers.export')] },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      const q = req.query as Record<string, string | undefined>;
      const buffer = await buildTransferExportExcel({
        companyId,
        search: (q.search ?? '').trim() || null,
        status: (q.status ?? '').trim() || null,
        dateFrom: q.date_from ?? null,
        dateTo: q.date_to ?? null,
      });
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="kochirishlar.xlsx"')
        .send(buffer);
    },
  );

  app.post(
    '/create/',
    { onRequest: [app.requireCompany, app.requirePermission('company.transfers.create')] },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      const data = transferCreateSchema.parse(req.body);
      const result = await createTransfer({ companyId, data, user: req.authUser! });
      return reply.status(201).send(result);
    },
  );

  // ───────────────────── Transfer session (o'tkazma qoralamasi) ─────────────────────
  // Django: session/ (list/create), session/:pk/ (get/patch/delete), session/:pk/complete/

  const sessionGuard = {
    onRequest: [app.requireCompany, app.requirePermission('company.transfers.create')],
  };

  // GET session/ — foydalanuvchining faol qoralamalari
  app.get('/session/', sessionGuard, async (req) => {
    const companyId = getCompanyId(req);
    return listActiveSessions(companyId, req.authUser!.id);
  });

  // POST session/ — yangi qoralama (birinchi avto-saqlashda)
  app.post('/session/', sessionGuard, async (req, reply) => {
    const companyId = getCompanyId(req);
    const body = transferSessionUpsertSchema.parse(req.body);
    const session = await createSession({ companyId, userId: req.authUser!.id, data: body });
    return reply.status(201).send(session);
  });

  // GET session/:pk/ — qoralamani olish ("Davom ettirish")
  app.get('/session/:pk/', sessionGuard, async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const session = await getSessionOr404(companyId, req.authUser!.id, pk);
    return serializeTransferSession(session);
  });

  // PATCH session/:pk/ — avto-saqlash (qisman yangilash)
  app.patch('/session/:pk/', sessionGuard, async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const body = transferSessionUpsertSchema.parse(req.body);
    return updateSession({ companyId, userId: req.authUser!.id, pk, data: body });
  });

  // DELETE session/:pk/ — bekor qilish (status=cancelled, 204)
  app.delete('/session/:pk/', sessionGuard, async (req, reply) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    await cancelSession(companyId, req.authUser!.id, pk);
    return reply.status(204).send();
  });

  // POST session/:pk/complete/ — haqiqiy o'tkazma yaratilgach qoralama yakunlanadi
  app.post('/session/:pk/complete/', sessionGuard, async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const body = transferSessionCompleteSchema.parse(req.body ?? {});
    const transferId = body.transfer ? Number(body.transfer) : null;
    return completeSession({ companyId, userId: req.authUser!.id, pk, transferId });
  });

  app.post(
    '/:pk/approve/',
    { onRequest: [app.requireCompany, app.requirePermission('company.transfers.approve')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const pk = Number((req.params as { pk: string }).pk);
      return approveTransfer({ companyId, transferId: pk, user: req.authUser! });
    },
  );

  app.post(
    '/:pk/reject/',
    { onRequest: [app.requireCompany, app.requirePermission('company.transfers.approve')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const pk = Number((req.params as { pk: string }).pk);
      return rejectTransfer({ companyId, transferId: pk, user: req.authUser! });
    },
  );

  app.get(
    '/notifications/',
    { onRequest: [app.requireCompany, app.requirePermission('company.transfers.view')] },
    async (req) => {
      return listNotifications(getCompanyId(req), req.authUser!.id);
    },
  );
}
