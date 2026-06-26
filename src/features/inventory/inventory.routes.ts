import type { FastifyInstance } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import { getCompanyId } from '../../common/tenant.js';
import {
  inventoryStartSchema,
  inventoryCountSchema,
  inventoryFinalizeSchema,
  inventoryCancelSchema,
} from './inventory.schemas.js';
import {
  startSession,
  setCount,
  finalize,
  cancel,
  listSessions,
  getInventoryDetail,
  listMovements,
} from './inventory.service.js';
import { overCounts, shortCounts } from './inventoryCount.service.js';
import { listLowStock, LOW_STOCK_STATUS } from './lowStock.service.js';

// Django: apps/inventory/urls.py
// Prefix '/inventory' modules/index.ts'da registratsiya qilingan.
// Route path'lar Django bilan AYNAN bir xil (trailing slash).
export async function inventoryRoutes(app: FastifyInstance) {
  // ── GET list/ — sessiyalar (company scope + inventory.view) ──
  app.get(
    '/list/',
    { onRequest: [app.requireCompany, app.requirePermission('company.inventory.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const page = getPageParams(req);
      const { results, count } = await listSessions({
        companyId,
        isSuperuser: req.authUser!.isSuperuser,
        userId: req.authUser!.id,
        skip: page.skip,
        take: page.take,
      });
      return paginate(req, results, count, page);
    },
  );

  // ── GET list/:session_id/ — inventarizatsiya detali (status filtri) ──
  app.get(
    '/list/:session_id/',
    { onRequest: [app.requireCompany, app.requirePermission('company.inventory.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const sessionId = Number((req.params as { session_id: string }).session_id);
      const q = req.query as Record<string, string | undefined>;
      const statuses = q.status
        ? q.status.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      return getInventoryDetail({ companyId, sessionId, statuses });
    },
  );

  // ── GET movement-list/:session_id/ — session movementlari ──
  app.get(
    '/movement-list/:session_id/',
    { onRequest: [app.requireCompany, app.requirePermission('company.inventory.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const sessionId = Number((req.params as { session_id: string }).session_id);
      return listMovements({ companyId, sessionId });
    },
  );

  // ── POST start/ — yangi sessiya + snapshot ──
  app.post(
    '/start/',
    { onRequest: [app.requireCompany, app.requirePermission('company.inventory.create')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const body = inventoryStartSchema.parse(req.body);
      const session = await startSession({ companyId, userId: req.authUser!.id, storeId: body.store_id });
      return { session_id: session.id };
    },
  );

  // ── PUT scan/ — mahsulotni aniq son bilan belgilash (set_count + scan) ──
  app.put(
    '/scan/',
    { onRequest: [app.requireCompany, app.requirePermission('company.inventory.update')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const body = inventoryCountSchema.parse(req.body);
      await setCount({ companyId, sessionId: body.session_id, productId: body.product_id, quantity: body.quantity });
      return { status: 'updated' };
    },
  );

  // ── POST finalize/ — yakunlash (stock to'g'rilash) ──
  app.post(
    '/finalize/',
    { onRequest: [app.requireCompany, app.requirePermission('company.inventory.update')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const body = inventoryFinalizeSchema.parse(req.body);
      await finalize({ companyId, sessionId: body.session_id });
      return { status: 'completed' };
    },
  );

  // ── POST cancel/ — bekor qilish ──
  app.post(
    '/cancel/',
    { onRequest: [app.requireCompany, app.requirePermission('company.inventory.delete')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const body = inventoryCancelSchema.parse(req.body);
      await cancel({ companyId, sessionId: body.session_id });
      return { status: 'cancelled' };
    },
  );

  // ── GET sessions/:session_id/over/ — ko'p chiqqanlar (status='m') ──
  app.get(
    '/sessions/:session_id/over/',
    { onRequest: [app.requireCompany, app.requirePermission('company.inventory.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const sessionId = Number((req.params as { session_id: string }).session_id);
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const { results, count } = await overCounts({
        companyId,
        sessionId,
        search: q.search,
        category: q.category !== undefined ? Number(q.category) : undefined,
        is_check: q.is_check !== undefined ? q.is_check === 'true' : undefined,
        ordering: q.ordering,
        skip: page.skip,
        take: page.take,
      });
      return paginate(req, results, count, page);
    },
  );

  // ── GET sessions/:session_id/short/ — kam chiqqanlar (status='l') ──
  app.get(
    '/sessions/:session_id/short/',
    { onRequest: [app.requireCompany, app.requirePermission('company.inventory.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const sessionId = Number((req.params as { session_id: string }).session_id);
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const { results, count } = await shortCounts({
        companyId,
        sessionId,
        search: q.search,
        category: q.category !== undefined ? Number(q.category) : undefined,
        is_check: q.is_check !== undefined ? q.is_check === 'true' : undefined,
        ordering: q.ordering,
        skip: page.skip,
        take: page.take,
      });
      return paginate(req, results, count, page);
    },
  );

  // ── GET low-stock/ — ochiq (OPEN) low-stock yozuvlari ──
  app.get(
    '/low-stock/',
    { onRequest: [app.requireCompany, app.requirePermission('company.inventory.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const { results, count } = await listLowStock({
        companyId,
        status: LOW_STOCK_STATUS.OPEN,
        action_type: q.action_type,
        store: q.store !== undefined ? Number(q.store) : undefined,
        product: q.product !== undefined ? Number(q.product) : undefined,
        ordering: q.ordering,
        skip: page.skip,
        take: page.take,
      });
      return paginate(req, results, count, page);
    },
  );

  // ── GET low-stock/history/ — yopilgan (RESOLVED) tarix ──
  app.get(
    '/low-stock/history/',
    { onRequest: [app.requireCompany, app.requirePermission('company.inventory.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const { results, count } = await listLowStock({
        companyId,
        status: LOW_STOCK_STATUS.RESOLVED,
        action_type: q.action_type,
        store: q.store !== undefined ? Number(q.store) : undefined,
        product: q.product !== undefined ? Number(q.product) : undefined,
        ordering: q.ordering,
        skip: page.skip,
        take: page.take,
      });
      return paginate(req, results, count, page);
    },
  );
}
