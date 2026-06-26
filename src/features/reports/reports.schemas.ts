import { z } from 'zod';

// ─────────────────────────────────────────────
//  Reports app — query param validatsiyasi (zod)
//  Django views'dagi request.query_params/request.GET o'qishlarini takrorlaydi.
// ─────────────────────────────────────────────

// DashboardAPIView: period (weekly|monthly|yearly), store_id ('all' yoki ID)
export const dashboardQuerySchema = z.object({
  period: z.string().optional(),
  store_id: z.string().optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

// TopProductsAPIView: filter (default 'daily'), limit (default 5), store_id, from, to
export const topProductsQuerySchema = z.object({
  filter: z.string().optional(),
  limit: z.string().optional(),
  store_id: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type TopProductsQuery = z.infer<typeof topProductsQuerySchema>;

// ReportsAPIView / ReportsExcelExportAPIView: filter, store_id, from, to
export const reportQuerySchema = z.object({
  filter: z.string().optional(),
  store_id: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;
