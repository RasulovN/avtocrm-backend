import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import {
  recordVisit,
  recordHeartbeat,
  parseRange,
  getOverview,
  getTimeseries,
  getHours,
  getGeo,
  getSources,
  getDevices,
  listVisits,
  type VisitPayload,
} from './siteAnalytics.service.js';

// ──────────────────────────────────────────────────────────────
// Sayt analitikasi route'lari:
//   POST /visit/, /heartbeat/  — ochiq (landing tracker yozadi), rate-limit bilan
//   GET  /admin/*              — faqat super admin
// ──────────────────────────────────────────────────────────────

// Ochiq endpointlar uchun oddiy per-IP rate limit (daqiqasiga 60 ta yozuv).
// Spamerlar ham 200 oladi — retry bo'ronining oldini olish uchun.
const RATE_LIMIT_PER_MIN = 60;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function allowIp(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    // Eskirgan bucketlarni vaqti-vaqti bilan tozalash (xotira o'smasligi uchun)
    if (rateBuckets.size > 10_000) rateBuckets.clear();
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_PER_MIN;
}

export async function siteAnalyticsRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireSuperuser] };
  const query = (req: FastifyRequest) => req.query as Record<string, string | undefined>;

  // ───── Ochiq: tashrif yozish ─────
  app.post('/visit/', async (req, reply) => {
    if (allowIp(req.ip)) {
      await recordVisit((req.body ?? {}) as VisitPayload, req.ip, req.headers['user-agent']);
    }
    return reply.code(200).send({ ok: true });
  });

  app.post('/heartbeat/', async (req, reply) => {
    if (allowIp(req.ip)) {
      const body = (req.body ?? {}) as { session_id?: string };
      await recordHeartbeat(body.session_id);
    }
    return reply.code(200).send({ ok: true });
  });

  // ───── Super admin: statistika ─────
  app.get('/admin/overview/', guard, async (req) => getOverview(parseRange(query(req))));
  app.get('/admin/timeseries/', guard, async (req) => getTimeseries(parseRange(query(req))));
  app.get('/admin/hours/', guard, async (req) => getHours(parseRange(query(req))));
  app.get('/admin/geo/', guard, async (req) => getGeo(parseRange(query(req))));
  app.get('/admin/sources/', guard, async (req) => getSources(parseRange(query(req))));
  app.get('/admin/devices/', guard, async (req) => getDevices(parseRange(query(req))));

  app.get('/admin/visits/', guard, async (req) => {
    const q = query(req);
    const params = getPageParams(req);
    const { count, results } = await listVisits(
      { range: parseRange(q), country: q.country, device_type: q.device_type, search: q.search },
      params.skip,
      params.take,
    );
    return paginate(req, results, count, params);
  });
}
