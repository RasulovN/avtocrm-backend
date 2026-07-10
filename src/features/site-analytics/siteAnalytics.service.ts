import { prisma } from '../../db/prisma.js';
import { BadRequest } from '../../common/errors.js';
import { tashkentToday } from '../../common/usageTracker.js';
import { parseUserAgent } from './userAgent.util.js';
import { lookupGeo } from './geo.js';

// ──────────────────────────────────────────────────────────────
// Sayt analitikasi (super admin) — landing sahifa tashriflari:
// kim, qayerdan, qaysi qurilmada, qancha vaqt. Manba: site_visit jadvali,
// landing'dagi tracker POST /visit/ va /heartbeat/ orqali to'ldiradi.
// ──────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;
const MAX_DURATION_SECONDS = 4 * 3600; // heartbeat cheklovi — 4 soat

export interface VisitPayload {
  visitor_id?: string;
  session_id?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  path?: string;
  locale?: string;
  screen_width?: number;
  screen_height?: number;
  first_visit?: boolean;
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function clip(v: string | undefined, max: number): string | null {
  if (!v || typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

// ───────── Yozish: tashrif ─────────

export async function recordVisit(payload: VisitPayload, ip: string, userAgent: string | undefined): Promise<void> {
  const visitorId = clip(payload.visitor_id, 64);
  const sessionId = clip(payload.session_id, 64);
  if (!visitorId || !sessionId || !ID_RE.test(visitorId) || !ID_RE.test(sessionId)) return;

  const ua = parseUserAgent(userAgent);
  if (ua.isBot) return;

  const referrer = clip(payload.referrer, 512);
  let referrerHost: string | null = null;
  if (referrer) {
    try {
      referrerHost = new URL(referrer).hostname.slice(0, 190) || null;
    } catch {
      /* noto'g'ri URL — host yo'q */
    }
  }

  const visit = {
    visitorId,
    sessionId,
    ip: ip.slice(0, 45),
    deviceType: ua.deviceType,
    os: ua.os,
    browser: ua.browser,
    referrer,
    referrerHost,
    utmSource: clip(payload.utm_source, 120),
    utmMedium: clip(payload.utm_medium, 120),
    utmCampaign: clip(payload.utm_campaign, 120),
    path: clip(payload.path, 255) ?? '/',
    locale: clip(payload.locale, 8),
    screenWidth: Number.isFinite(payload.screen_width) ? Math.trunc(payload.screen_width!) : null,
    screenHeight: Number.isFinite(payload.screen_height) ? Math.trunc(payload.screen_height!) : null,
    isNewVisitor: payload.first_visit === true,
  };

  try {
    await prisma.siteVisit.create({ data: visit });
  } catch {
    // session_id unique — bitta sessiya ikki marta yozilmaydi (dedup)
    return;
  }

  // Geo'ni javobni kutdirmasdan (asinxron) aniqlaymiz
  void lookupGeo(ip)
    .then((geo) =>
      prisma.siteVisit.update({
        where: { sessionId },
        data: { country: geo.country, region: geo.region, city: geo.city },
      }),
    )
    .catch(() => {
      /* geo ixtiyoriy */
    });
}

export async function recordHeartbeat(sessionId: string | undefined): Promise<void> {
  const sid = clip(sessionId, 64);
  if (!sid || !ID_RE.test(sid)) return;
  try {
    await prisma.$executeRaw`
      UPDATE site_visit
      SET duration_seconds = LEAST(
        GREATEST(duration_seconds, EXTRACT(EPOCH FROM now() - created_at)::int),
        ${MAX_DURATION_SECONDS}
      )
      WHERE session_id = ${sid}`;
  } catch {
    /* statistika asosiy oqimni buzmaydi */
  }
}

// 365 kundan eski tashriflarni tozalash (kunlik job chaqiradi)
export async function pruneOldVisits(): Promise<void> {
  try {
    await prisma.$executeRaw`DELETE FROM site_visit WHERE created_at < now() - interval '365 days'`;
  } catch {
    /* keyingi urinishda tozalanadi */
  }
}

// ───────── O'qish: super admin statistikasi ─────────

export interface VisitRange {
  from: string;
  to: string;
}

export function parseRange(q: Record<string, string | undefined>): VisitRange {
  const to = q.date_to && DATE_RE.test(q.date_to) ? q.date_to : tashkentToday();
  const from = q.date_from && DATE_RE.test(q.date_from) ? q.date_from : addDays(to, -29);
  if (from > to) throw new BadRequest({ detail: "date_from date_to'dan katta bo'lishi mumkin emas." });
  if (diffDays(from, to) + 1 > MAX_RANGE_DAYS) {
    throw new BadRequest({ detail: `Oraliq ${MAX_RANGE_DAYS} kundan oshmasligi kerak.` });
  }
  return { from, to };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// Tashkent kuni chegarasini UTC'ga o'tkazish (created_at timestamptz filtri)
function dayToUtc(date: string, endOfDay: boolean): Date {
  return new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:00`);
}

function growthPct(current: number, prev: number): number {
  if (prev === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - prev) / prev) * 100);
}

interface OverviewRow {
  visits: number;
  visitors: number;
  new_visitors: number;
  avg_duration: number;
}

async function rangeOverview(fromUtc: Date, toUtc: Date): Promise<OverviewRow> {
  const rows = await prisma.$queryRaw<OverviewRow[]>`
    SELECT
      COUNT(*)::int                                                        AS visits,
      COUNT(DISTINCT visitor_id)::int                                      AS visitors,
      COUNT(*) FILTER (WHERE is_new_visitor)::int                          AS new_visitors,
      COALESCE(ROUND(AVG(duration_seconds) FILTER (WHERE duration_seconds > 0)), 0)::int AS avg_duration
    FROM site_visit
    WHERE created_at BETWEEN ${fromUtc} AND ${toUtc}`;
  return rows[0];
}

export async function getOverview(range: VisitRange) {
  const { from, to } = range;
  const days = diffDays(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));

  const [totals, prev, topCountryRows] = await Promise.all([
    rangeOverview(dayToUtc(from, false), dayToUtc(to, true)),
    rangeOverview(dayToUtc(prevFrom, false), dayToUtc(prevTo, true)),
    prisma.$queryRaw<{ country: string; count: number }[]>`
      SELECT country, COUNT(*)::int AS count
      FROM site_visit
      WHERE country IS NOT NULL AND created_at BETWEEN ${dayToUtc(from, false)} AND ${dayToUtc(to, true)}
      GROUP BY country ORDER BY count DESC LIMIT 1`,
  ]);

  const newShare = totals.visits > 0 ? Math.round((100 * totals.new_visitors) / totals.visits) : 0;

  return {
    date_from: from,
    date_to: to,
    days,
    totals: {
      visits: totals.visits,
      visitors: totals.visitors,
      avg_duration: totals.avg_duration,
      new_share_pct: newShare,
      top_country: topCountryRows[0]?.country ?? null,
      visits_growth_pct: growthPct(totals.visits, prev.visits),
      visitors_growth_pct: growthPct(totals.visitors, prev.visitors),
    },
  };
}

export async function getTimeseries(range: VisitRange) {
  const { from, to } = range;
  const days = diffDays(from, to) + 1;
  const rows = await prisma.$queryRaw<{ date: string; visits: number; visitors: number }[]>`
    SELECT
      ((created_at AT TIME ZONE 'Asia/Tashkent')::date)::text AS date,
      COUNT(*)::int                                           AS visits,
      COUNT(DISTINCT visitor_id)::int                         AS visitors
    FROM site_visit
    WHERE created_at BETWEEN ${dayToUtc(from, false)} AND ${dayToUtc(to, true)}
    GROUP BY 1 ORDER BY 1`;

  const byDate = new Map(rows.map((r) => [r.date, r]));
  const series = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    series.push(byDate.get(date) ?? { date, visits: 0, visitors: 0 });
  }
  return { date_from: from, date_to: to, series };
}

export async function getHours(range: VisitRange) {
  const rows = await prisma.$queryRaw<{ hour: number; visits: number }[]>`
    SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tashkent')::int AS hour, COUNT(*)::int AS visits
    FROM site_visit
    WHERE created_at BETWEEN ${dayToUtc(range.from, false)} AND ${dayToUtc(range.to, true)}
    GROUP BY 1 ORDER BY 1`;
  const byHour = new Map(rows.map((r) => [r.hour, r.visits]));
  return { hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, visits: byHour.get(h) ?? 0 })) };
}

export async function getGeo(range: VisitRange) {
  const fromUtc = dayToUtc(range.from, false);
  const toUtc = dayToUtc(range.to, true);
  const [countries, regions] = await Promise.all([
    prisma.$queryRaw<{ country: string; visits: number; visitors: number }[]>`
      SELECT country, COUNT(*)::int AS visits, COUNT(DISTINCT visitor_id)::int AS visitors
      FROM site_visit
      WHERE country IS NOT NULL AND created_at BETWEEN ${fromUtc} AND ${toUtc}
      GROUP BY country ORDER BY visits DESC LIMIT 12`,
    prisma.$queryRaw<{ region: string; city: string | null; visits: number }[]>`
      SELECT region, city, COUNT(*)::int AS visits
      FROM site_visit
      WHERE region IS NOT NULL AND created_at BETWEEN ${fromUtc} AND ${toUtc}
      GROUP BY region, city ORDER BY visits DESC LIMIT 15`,
  ]);
  return { countries, regions };
}

export async function getSources(range: VisitRange) {
  const fromUtc = dayToUtc(range.from, false);
  const toUtc = dayToUtc(range.to, true);
  const [referrers, utm] = await Promise.all([
    prisma.$queryRaw<{ source: string; visits: number }[]>`
      SELECT COALESCE(referrer_host, 'To''g''ridan-to''g''ri') AS source, COUNT(*)::int AS visits
      FROM site_visit
      WHERE created_at BETWEEN ${fromUtc} AND ${toUtc}
      GROUP BY 1 ORDER BY visits DESC LIMIT 12`,
    prisma.$queryRaw<{ utm_source: string; utm_medium: string | null; utm_campaign: string | null; visits: number }[]>`
      SELECT utm_source, utm_medium, utm_campaign, COUNT(*)::int AS visits
      FROM site_visit
      WHERE utm_source IS NOT NULL AND created_at BETWEEN ${fromUtc} AND ${toUtc}
      GROUP BY 1, 2, 3 ORDER BY visits DESC LIMIT 12`,
  ]);
  return { referrers, utm };
}

export async function getDevices(range: VisitRange) {
  const fromUtc = dayToUtc(range.from, false);
  const toUtc = dayToUtc(range.to, true);
  const group = async (col: 'device_type' | 'browser' | 'os' | 'locale') => {
    // col — qat'iy whitelist'dagi ustun nomi (SQL-injection xavfi yo'q)
    return prisma.$queryRawUnsafe<{ name: string; visits: number }[]>(
      `SELECT ${col}::text AS name, COUNT(*)::int AS visits
       FROM site_visit
       WHERE ${col} IS NOT NULL AND created_at BETWEEN $1 AND $2
       GROUP BY 1 ORDER BY visits DESC LIMIT 12`,
      fromUtc,
      toUtc,
    );
  };
  const [deviceTypes, browsers, oses, locales] = await Promise.all([
    group('device_type'),
    group('browser'),
    group('os'),
    group('locale'),
  ]);
  return { device_types: deviceTypes, browsers, oses, locales };
}

export interface VisitListFilters {
  range: VisitRange;
  country?: string;
  device_type?: string;
  search?: string;
}

export async function listVisits(filters: VisitListFilters, skip: number, take: number) {
  const where: Record<string, unknown> = {
    createdAt: { gte: dayToUtc(filters.range.from, false), lte: dayToUtc(filters.range.to, true) },
  };
  if (filters.country) where.country = filters.country;
  if (filters.device_type && ['desktop', 'mobile', 'tablet'].includes(filters.device_type)) {
    where.deviceType = filters.device_type;
  }
  if (filters.search) {
    where.OR = [
      { ip: { contains: filters.search, mode: 'insensitive' } },
      { city: { contains: filters.search, mode: 'insensitive' } },
      { region: { contains: filters.search, mode: 'insensitive' } },
      { referrerHost: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const [count, rows] = await prisma.$transaction([
    prisma.siteVisit.count({ where }),
    prisma.siteVisit.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
  ]);

  return {
    count,
    results: rows.map((v) => ({
      id: v.id,
      created_at: v.createdAt,
      ip: v.ip,
      country: v.country,
      region: v.region,
      city: v.city,
      device_type: v.deviceType,
      os: v.os,
      browser: v.browser,
      referrer_host: v.referrerHost,
      utm_source: v.utmSource,
      path: v.path,
      locale: v.locale,
      is_new_visitor: v.isNewVisitor,
      duration_seconds: v.durationSeconds,
    })),
  };
}
