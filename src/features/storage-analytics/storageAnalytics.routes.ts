import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import {
  getDashboard,
  listTables,
  companyUsage,
  getGrowth,
  getFiles,
  getRecommendations,
  takeSnapshot,
  ensureRecentSnapshot,
} from './storageAnalytics.service.js';
import { pruneOldVisits } from '../site-analytics/siteAnalytics.service.js';

// ──────────────────────────────────────────────────────────────
// Storage Analytics route'lari — barchasi faqat super admin uchun.
// Shu yerda davriy job'lar ham ishga tushadi:
//   - soatlik storage snapshot (o'sish grafigi manbai)
//   - kunlik tozalash (365 kundan eski sayt tashriflari)
// ──────────────────────────────────────────────────────────────

const SNAPSHOT_INTERVAL_MS = 3600_000; // 1 soat
const PRUNE_INTERVAL_MS = 24 * 3600_000; // 1 kun

export async function storageAnalyticsRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireSuperuser] };
  const query = (req: FastifyRequest) => req.query as Record<string, string | undefined>;

  // ───── Davriy job'lar ─────
  const snapshotTimer = setInterval(() => void takeSnapshot(), SNAPSHOT_INTERVAL_MS);
  snapshotTimer.unref();
  const pruneTimer = setInterval(() => void pruneOldVisits(), PRUNE_INTERVAL_MS);
  pruneTimer.unref();
  // Server ishga tushganda oxirgi soatda snapshot bo'lmasa — olib qo'yish
  // (60s kechikish bilan: startup'da DB bosimini oshirmaslik uchun)
  const bootTimer = setTimeout(() => void ensureRecentSnapshot(), 60_000);
  bootTimer.unref();

  app.addHook('onClose', async () => {
    clearInterval(snapshotTimer);
    clearInterval(pruneTimer);
    clearTimeout(bootTimer);
  });

  // ───── Super admin endpointlari ─────
  app.get('/admin/dashboard/', guard, async () => getDashboard());

  app.get('/admin/tables/', guard, async (req) => {
    const q = query(req);
    const params = getPageParams(req);
    const { count, results } = await listTables(
      { search: q.search, sort_by: q.sort_by, sort_order: q.sort_order },
      params.skip,
      params.take,
    );
    return paginate(req, results, count, params);
  });

  app.get('/admin/companies/', guard, async () => ({ results: await companyUsage() }));

  app.get('/admin/growth/', guard, async (req) => {
    const days = Number(query(req).days ?? '30') || 30;
    return getGrowth(days);
  });

  app.get('/admin/files/', guard, async () => getFiles());

  app.get('/admin/recommendations/', guard, async () => getRecommendations());

  // Qo'lda snapshot olish (masalan katta import'dan keyin)
  app.post('/admin/snapshot/', guard, async () => {
    await takeSnapshot();
    return { ok: true };
  });
}
