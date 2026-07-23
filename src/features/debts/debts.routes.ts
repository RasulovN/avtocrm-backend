import type { FastifyInstance } from 'fastify';
import { getCompanyId } from '../../common/tenant.js';
import { payDebtBulkSchema, payDebtSchema } from './debts.schemas.js';
import { listCustomerDebts, getCustomerDebt, payDebt, payDebtBulk } from './debts.service.js';

// apps/debts/urls.py:
//   path('list/',      PayDebtListAPIView)    -> GET    /debts/list/
//   path('create/',    PayDebtAPIView)        -> POST   /debts/create/
//   path('<int:pk>/',  PayDebtDetailAPIView)  -> GET    /debts/<pk>/
// Prefix `/debts` index.ts'da. Multi-tenant: companyId bo'yicha scope + RBAC guard.
export async function debtsRoutes(app: FastifyInstance) {
  // CustomerDebt ro'yxati.
  app.get(
    '/list/',
    { onRequest: [app.requireCompany, app.requirePermission('company.debts.view')] },
    async (req) => {
      return listCustomerDebts(getCompanyId(req));
    },
  );

  // Qarzni to'lash. Response 201: { message, payment_id, amount }.
  app.post(
    '/create/',
    { onRequest: [app.requireCompany, app.requirePermission('company.debts.create')] },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      const data = payDebtSchema.parse(req.body);
      const result = await payDebt(companyId, data);
      return reply.status(201).send({
        message: 'Debt paid successfully',
        payment_id: result.payments[0].id,
        payment_ids: result.payments.map((p) => p.id),
        amount: result.total.toFixed(2),
      });
    },
  );

  // Bir mijozning bir nechta qarzli sotuvini bitta summa bilan yopish (FIFO).
  // Response 201: { total_paid, payments: [{sale, amount, payment_id, remaining_debt}] }.
  app.post(
    '/pay-bulk/',
    { onRequest: [app.requireCompany, app.requirePermission('company.debts.create')] },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      const data = payDebtBulkSchema.parse(req.body);
      const result = await payDebtBulk(companyId, data);
      return reply.status(201).send(result);
    },
  );

  // ID orqali qarz ma'lumoti.
  app.get(
    '/:pk/',
    { onRequest: [app.requireCompany, app.requirePermission('company.debts.view')] },
    async (req) => {
      const pk = Number((req.params as { pk: string }).pk);
      return getCustomerDebt(getCompanyId(req), pk);
    },
  );
}
