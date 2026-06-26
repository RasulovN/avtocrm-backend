import type { FastifyInstance } from 'fastify';
import { getCompanyId } from '../../common/tenant.js';
import { transferCreateSchema } from './transfer.schemas.js';
import {
  createTransfer,
  approveTransfer,
  rejectTransfer,
  listTransfers,
  listNotifications,
} from './transfer.service.js';

// Django: apps/transfer/urls.py. Multi-tenant: companyId scope + RBAC guard.
//   ''                  -> ro'yxat            (company.transfers.view)
//   'create/'           -> yaratish           (company.transfers.manage)
//   '<pk>/approve/'     -> tasdiqlash         (company.transfers.manage)
//   '<pk>/reject/'      -> rad etish          (company.transfers.manage)
//   'notifications/'    -> bildirishnomalar   (company.transfers.view)
export async function transferRoutes(app: FastifyInstance) {
  app.get(
    '/',
    { onRequest: [app.requireCompany, app.requirePermission('company.transfers.view')] },
    async (req) => {
      return listTransfers(getCompanyId(req));
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
