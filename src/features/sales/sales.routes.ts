import type { FastifyInstance } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import { getCompanyId } from '../../common/tenant.js';
import { saleCreateSchema, saleReturnCreateSchema } from './sales.schemas.js';
import { createSale, listSales, getSale } from './sale.service.js';
import { createReturn, listReturns } from './saleReturn.service.js';
import { getDebtorCustomers } from './debtorCustomer.service.js';

// Django: apps/sales/urls.py (prefix '/sales' index.ts'da).
//   list/                 -> SaleListAPIView         (GET)
//   create/               -> SaleCreateAPIView        (POST)
//   <int:pk>/             -> SaleDetailAPIView        (GET)
//   debtor-customers/     -> CustomerDebtListAPIView  (GET)
//   sale-return/list/     -> SaleReturnListAPIView    (GET)
//   sale-return/          -> SaleReturnCreateAPIView  (POST)
//
// Multi-tenant SaaS: har bir so'rov companyId bo'yicha tenant-scope qilinadi
// (getCompanyId(req) -> service'ga uzatiladi). RBAC guard'lar onRequest massivida:
//   - sotuv:        o'qish company.sales.view / yozish company.sales.manage
//   - sale-return:  o'qish company.returns.view / yozish company.returns.manage
//   - debtor:       company.sales.view
// Sotuv yaratish store-context talab qiladi -> app.requireStore.
export async function salesRoutes(app: FastifyInstance) {
  // ── Sotuv ro'yxati ──
  app.get(
    '/list/',
    { onRequest: [app.requireCompany, app.requirePermission('company.sales.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const { results, count } = await listSales({
        companyId,
        user: req.authUser!,
        filters: {
          status: q.status,
          store: q.store !== undefined ? Number(q.store) : undefined,
          customer: q.customer !== undefined ? Number(q.customer) : undefined,
          seller: q.seller !== undefined ? Number(q.seller) : undefined,
          date_from: q.date_from,
          date_to: q.date_to,
          search: q.search,
          ordering: q.ordering,
        },
        page,
      });
      return paginate(req, results, count, page);
    },
  );

  // ── Sotuv yaratish ── (store-context shart)
  app.post(
    '/create/',
    {
      onRequest: [
        app.requireCompany,
        app.requireStore,
        app.requirePermission('company.sales.create'),
      ],
    },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      const body = saleCreateSchema.parse(req.body);
      const result = await createSale({
        companyId,
        user: req.authUser!,
        data: body,
        selectedStoreId: req.store?.id,
      });
      return reply.status(201).send(result);
    },
  );

  // ── Qarzdor mijozlar ro'yxati (paginatsiyalangan) ──
  app.get(
    '/debtor-customers/',
    { onRequest: [app.requireCompany, app.requirePermission('company.sales.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const page = getPageParams(req);
      const all = await getDebtorCustomers(companyId, req.authUser!);
      const slice = all.slice(page.skip, page.skip + page.take);
      return paginate(req, slice, all.length, page);
    },
  );

  // ── Sotuvni qaytarish ro'yxati (pagination yo'q — Django'dagidek) ──
  app.get(
    '/sale-return/list/',
    { onRequest: [app.requireCompany, app.requirePermission('company.returns.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      return listReturns(companyId, req.authUser!);
    },
  );

  // ── Sotuvni qaytarish ── (store-context shart)
  app.post(
    '/sale-return/',
    {
      onRequest: [
        app.requireCompany,
        app.requireStore,
        app.requirePermission('company.returns.create'),
      ],
    },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      const body = saleReturnCreateSchema.parse(req.body);
      const result = await createReturn({ companyId, user: req.authUser!, data: body });
      return reply.status(201).send(result);
    },
  );

  // ── ID orqali sotuv ma'lumotlari ──
  // ⚠️ '/:pk/' eng oxirida — aks holda 'list/', 'debtor-customers/' kabi statik
  // yo'llar bilan to'qnashishi mumkin.
  app.get(
    '/:pk/',
    { onRequest: [app.requireCompany, app.requirePermission('company.sales.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const pk = Number((req.params as { pk: string }).pk);
      return getSale(companyId, pk);
    },
  );
}
