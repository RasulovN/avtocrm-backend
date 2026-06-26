import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Forbidden } from '../../common/errors.js';
import { getCompanyId } from '../../common/tenant.js';
import {
  dashboardQuerySchema,
  topProductsQuerySchema,
  reportQuerySchema,
} from './reports.schemas.js';
import { getDashboard } from './dashboard.service.js';
import { getTopProducts } from './topProduct.service.js';
import { getReport } from './report.service.js';
import { generateReportExcel } from './excelExport.service.js';
import { resolveDateRange, validateDates } from './dateFilters.js';

// ─────────────────────────────────────────────
//  Reports app routes — Django apps/reports/urls.py bilan AYNAN bir xil.
//  Prefix '/reports' index.ts'da. permission_classes -> onRequest hook.
// ─────────────────────────────────────────────

const VALID_PERIODS = ['weekly', 'monthly', 'yearly'] as const;

// DRF IsAdminUser ekvivalenti — is_staff.
async function requireAdmin(req: FastifyRequest): Promise<void> {
  if (!req.authUser || !req.authUser.isStaff) {
    throw new Forbidden();
  }
}

export async function reportsRoutes(app: FastifyInstance) {
  // ── DashboardAPIView — path('dashboard/') — IsAuthenticated ──
  app.get(
    '/dashboard/',
    { onRequest: app.authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = dashboardQuerySchema.parse(req.query);
      const period = q.period ?? 'weekly';
      const storeId = q.store_id ?? 'all';

      if (!(VALID_PERIODS as readonly string[]).includes(period)) {
        return reply.status(400).send({
          detail: `period qiymati noto'g'ri. To'g'ri qiymatlar: ${VALID_PERIODS.join(', ')}`,
        });
      }

      return getDashboard(period, storeId);
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

  // ── ReportsAPIView — path('') — IsAdminUser ──
  app.get('/', { onRequest: requireAdmin }, async (req: FastifyRequest) => {
    const q = reportQuerySchema.parse(req.query);
    return getReport({
      store_id: q.store_id,
      filter: q.filter,
      from: q.from,
      to: q.to,
    });
  });

  // ── ReportsExcelExportAPIView — path('export/') — IsAuthenticated ──
  app.get(
    '/export/',
    { onRequest: [app.requireCompany, app.requirePermission('company.reports.export')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = reportQuerySchema.parse(req.query);
      const data = await getReport({
        store_id: q.store_id,
        filter: q.filter,
        from: q.from,
        to: q.to,
      });

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
