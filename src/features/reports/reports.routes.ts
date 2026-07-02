import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getCompanyId } from '../../common/tenant.js';
import {
  dashboardQuerySchema,
  topProductsQuerySchema,
  reportQuerySchema,
} from './reports.schemas.js';
import { getDashboard } from './dashboard.service.js';
import { getTopProducts } from './topProduct.service.js';
import { getReport } from './report.service.js';
import { resolveReportStoreIds } from './storeScope.js';
import { generateReportExcel } from './excelExport.service.js';
import { resolveDateRange, validateDates } from './dateFilters.js';

// ─────────────────────────────────────────────
//  Reports app routes. Prefix '/reports' index.ts'da.
//  TENANT IZOLYATSIYASI: barcha hisobotlar requireCompany + company.reports.*
//  ruxsati bilan himoyalanadi va faqat kompaniyaning do'konlari doirasida
//  ma'lumot qaytaradi (resolveReportStoreIds). Ilgari /dashboard/ va / (root)
//  companyId bo'yicha filtrlanmagan edi — platforma bo'ylab sizib chiqardi.
// ─────────────────────────────────────────────

const VALID_PERIODS = ['weekly', 'monthly', 'yearly'] as const;

export async function reportsRoutes(app: FastifyInstance) {
  // ── DashboardAPIView — path('dashboard/') ──
  app.get(
    '/dashboard/',
    { onRequest: [app.requireCompany, app.requirePermission('company.reports.view')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = dashboardQuerySchema.parse(req.query);
      const period = q.period ?? 'weekly';

      if (!(VALID_PERIODS as readonly string[]).includes(period)) {
        return reply.status(400).send({
          detail: `period qiymati noto'g'ri. To'g'ri qiymatlar: ${VALID_PERIODS.join(', ')}`,
        });
      }

      const companyId = getCompanyId(req);
      const storeIds = await resolveReportStoreIds(req.authUser!, companyId, q.store_id);
      return getDashboard(period, storeIds);
    },
  );

  // ── TopProductsAPIView — path('top-products/') — AllowAny ──
  // (Django'da permission_classes belgilanmagan — lekin request.user.is_superuser
  //  StoreFilterService ichida ishlatiladi. Anonim user uchun authUser bo'lishi shart.)
  app.get(
    '/top-products/',
    { onRequest: [app.requireCompany, app.requirePermission('company.reports.view')] },
    async (req: FastifyRequest) => {
      const companyId = getCompanyId(req);
      const q = topProductsQuerySchema.parse(req.query);
      const filterType = q.filter ?? 'daily';
      const limit = q.limit ? Number.parseInt(q.limit, 10) || 5 : 5;
      const storeId = q.store_id;

      // DateValidator.validate(from, to) — ikkalasi bo'lsa shu oraliq, aks holda filter.
      let [fromDate, toDate] = validateDates(q.from, q.to);
      if (!fromDate) {
        [fromDate, toDate] = resolveDateRange(filterType);
      }

      // resolve qilingan oraliq — daily/weekly/... uchun har doim mavjud.
      const data = await getTopProducts({
        companyId,
        user: req.authUser!,
        dateFrom: fromDate!,
        dateTo: toDate!,
        limit,
        storeId,
      });

      return { topProducts: data };
    },
  );

  // ── ReportsAPIView — path('') ──
  app.get(
    '/',
    { onRequest: [app.requireCompany, app.requirePermission('company.reports.view')] },
    async (req: FastifyRequest) => {
      const q = reportQuerySchema.parse(req.query);
      const companyId = getCompanyId(req);
      const storeIds = await resolveReportStoreIds(req.authUser!, companyId, q.store_id);
      return getReport({ filter: q.filter, from: q.from, to: q.to }, storeIds);
    },
  );

  // ── ReportsExcelExportAPIView — path('export/') ──
  app.get(
    '/export/',
    { onRequest: [app.requireCompany, app.requirePermission('company.reports.export')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = reportQuerySchema.parse(req.query);
      const companyId = getCompanyId(req);
      const storeIds = await resolveReportStoreIds(req.authUser!, companyId, q.store_id);
      const data = await getReport({ filter: q.filter, from: q.from, to: q.to }, storeIds);

      const file = await generateReportExcel(data);

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
      const filename = `report_${stamp}.xlsx`;

      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename=${filename}`);

      return reply.send(file);
    },
  );
}
