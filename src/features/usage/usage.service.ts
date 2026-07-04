import { prisma } from '../../db/prisma.js';
import { BadRequest, NotFound } from '../../common/errors.js';
import { tashkentToday } from '../../common/usageTracker.js';

// ──────────────────────────────────────────────────────────────
// Foydalanish tahlili (super admin) — mijozlar tizimni qanchalik faol
// ishlatayotganini o'lchaydi: kirishlar, amallar, faol foydalanuvchilar.
// Maqsad: qiymat olmayotgan (churn xavfidagi) kompaniyalarni erta aniqlash.
// Manba: usage_daily (kunlik rollup) + audit_log (modul kesimi uchun).
// ──────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

export interface UsageRange {
  from: string; // YYYY-MM-DD (Asia/Tashkent kuni)
  to: string;
}

// Sana oralig'ini tekshirib normalizatsiya qiladi. Default: oxirgi 7 kun.
export function parseRange(q: Record<string, string | undefined>): UsageRange {
  const to = q.date_to && DATE_RE.test(q.date_to) ? q.date_to : tashkentToday();
  const from = q.date_from && DATE_RE.test(q.date_from) ? q.date_from : addDays(to, -6);
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

// O'sish foizi: oldingi davr 0 bo'lsa — yangi qiymat bor bo'lsa 100%, bo'lmasa 0%.
function growthPct(current: number, prev: number): number {
  if (prev === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - prev) / prev) * 100);
}

// Tashkent kuni chegaralarini UTC timestamp'ga o'tkazish (audit_log filtri uchun)
function tashkentDayToUtc(date: string, endOfDay: boolean): Date {
  return new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:00`);
}

/* ============================================================
   1) Umumiy ko'rinish — KPI + kunlik seriya + oldingi davr bilan taqqoslash
   ============================================================ */

interface SeriesRow {
  date: string;
  requests: number;
  logins: number;
  actions: number;
  active_users: number;
  active_companies: number;
}

interface TotalsRow {
  requests: number;
  logins: number;
  actions: number;
  active_users: number;
  active_companies: number;
}

async function rangeTotals(from: string, to: string): Promise<TotalsRow> {
  const rows = await prisma.$queryRaw<TotalsRow[]>`
    SELECT
      COALESCE(SUM(requests), 0)::int  AS requests,
      COALESCE(SUM(logins), 0)::int    AS logins,
      COALESCE(SUM(actions), 0)::int   AS actions,
      COUNT(DISTINCT user_id)::int     AS active_users,
      COUNT(DISTINCT company_id)::int  AS active_companies
    FROM usage_daily
    WHERE date BETWEEN ${from}::date AND ${to}::date`;
  return rows[0];
}

export async function getUsageOverview(range: UsageRange) {
  const { from, to } = range;
  const days = diffDays(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));

  const [seriesRaw, totals, prev, companiesTotal, usersTotal] = await Promise.all([
    prisma.$queryRaw<SeriesRow[]>`
      SELECT
        date::text                       AS date,
        SUM(requests)::int               AS requests,
        SUM(logins)::int                 AS logins,
        SUM(actions)::int                AS actions,
        COUNT(DISTINCT user_id)::int     AS active_users,
        COUNT(DISTINCT company_id)::int  AS active_companies
      FROM usage_daily
      WHERE date BETWEEN ${from}::date AND ${to}::date
      GROUP BY date
      ORDER BY date`,
    rangeTotals(from, to),
    rangeTotals(prevFrom, prevTo),
    prisma.company.count(),
    prisma.user.count({ where: { companyId: { not: null } } }),
  ]);

  // Bo'sh kunlarni 0 bilan to'ldirish — chart uzluksiz chiqishi uchun
  const byDate = new Map(seriesRaw.map((r) => [r.date, r]));
  const series: SeriesRow[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    series.push(byDate.get(date) ?? { date, requests: 0, logins: 0, actions: 0, active_users: 0, active_companies: 0 });
  }

  return {
    date_from: from,
    date_to: to,
    days,
    series,
    totals: {
      ...totals,
      prev_requests: prev.requests,
      prev_logins: prev.logins,
      prev_actions: prev.actions,
      prev_active_users: prev.active_users,
      prev_active_companies: prev.active_companies,
      requests_growth_pct: growthPct(totals.requests, prev.requests),
      logins_growth_pct: growthPct(totals.logins, prev.logins),
      actions_growth_pct: growthPct(totals.actions, prev.actions),
      active_users_growth_pct: growthPct(totals.active_users, prev.active_users),
      active_companies_growth_pct: growthPct(totals.active_companies, prev.active_companies),
    },
    context: { companies_total: companiesTotal, users_total: usersTotal },
  };
}

/* ============================================================
   2) Kompaniyalar kesimi — engagement score, trend, churn xavfi
   ============================================================ */

export type EngagementLevel = 'high' | 'medium' | 'low' | 'inactive';
export type ChurnRisk = 'high' | 'medium' | 'low' | 'none';

interface CompanyAggRow {
  company_id: number;
  active_users: number;
  logins: number;
  actions: number;
  requests: number;
  active_days: number;
  first_half: number;
  second_half: number;
}

interface LastActivityRow {
  company_id: number;
  last_activity: string;
}

// Engagement ball (0–100):
//   45% — faol kunlar ulushi (davr ichida necha kun ishlatilgan)
//   30% — faol foydalanuvchi ulushi (ro'yxatdagilarning nechasi kirgan)
//   25% — hajm (faol kuniga so'rovlar, log shkalada: ~100 so'rov/kun = maksimal)
function engagementScore(days: number, activeDays: number, activeUsers: number, totalUsers: number, requests: number): number {
  const dayRatio = days > 0 ? activeDays / days : 0;
  const userRatio = totalUsers > 0 ? Math.min(1, activeUsers / totalUsers) : 0;
  const perDay = activeDays > 0 ? requests / activeDays : 0;
  const volume = Math.min(1, Math.log10(1 + perDay) / 2);
  return Math.round(100 * (0.45 * dayRatio + 0.3 * userRatio + 0.25 * volume));
}

function engagementLevel(score: number): EngagementLevel {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  if (score >= 1) return 'low';
  return 'inactive';
}

// Churn xavfi: oxirgi faollikdan o'tgan kunlar + davr ichidagi pasayish trendi.
// Hech qachon faol bo'lmagan (onboardingdan keyin kirmagan) — 'none' (nofaol).
function churnRisk(daysSince: number | null, trendPct: number, hadActivity: boolean): ChurnRisk {
  if (daysSince === null) return 'none';
  if (daysSince > 14) return 'high';
  if (daysSince > 7) return 'medium';
  if (hadActivity && trendPct <= -50) return 'high';
  if (hadActivity && trendPct <= -25) return 'medium';
  return 'low';
}

export async function getUsageByCompany(range: UsageRange) {
  const { from, to } = range;
  const days = diffDays(from, to) + 1;
  // Trend: davrning ikkinchi yarmi birinchi yarmiga nisbatan (so'rovlar hajmi)
  const mid = addDays(from, Math.floor((days - 1) / 2));

  const [companies, aggRows, lastRows] = await Promise.all([
    prisma.company.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        isActive: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.$queryRaw<CompanyAggRow[]>`
      SELECT
        company_id,
        COUNT(DISTINCT user_id)::int AS active_users,
        SUM(logins)::int             AS logins,
        SUM(actions)::int            AS actions,
        SUM(requests)::int           AS requests,
        COUNT(DISTINCT date)::int    AS active_days,
        COALESCE(SUM(requests) FILTER (WHERE date <= ${mid}::date), 0)::int AS first_half,
        COALESCE(SUM(requests) FILTER (WHERE date > ${mid}::date), 0)::int  AS second_half
      FROM usage_daily
      WHERE date BETWEEN ${from}::date AND ${to}::date
      GROUP BY company_id`,
    prisma.$queryRaw<LastActivityRow[]>`
      SELECT company_id, MAX(date)::text AS last_activity
      FROM usage_daily
      GROUP BY company_id`,
  ]);

  const aggByCompany = new Map(aggRows.map((r) => [r.company_id, r]));
  const lastByCompany = new Map(lastRows.map((r) => [r.company_id, r.last_activity]));
  const today = tashkentToday();

  const results = companies.map((c) => {
    const agg = aggByCompany.get(c.id);
    const lastActivity = lastByCompany.get(c.id) ?? null;
    const daysSince = lastActivity ? diffDays(lastActivity, today) : null;

    const requests = agg?.requests ?? 0;
    const firstHalf = agg?.first_half ?? 0;
    const secondHalf = agg?.second_half ?? 0;
    // Bir kunlik oraliqda trend ma'nosiz — 0 qaytariladi
    const trendPct = days < 2 ? 0 : growthPct(secondHalf, firstHalf);

    const score = engagementScore(days, agg?.active_days ?? 0, agg?.active_users ?? 0, c._count.users, requests);

    return {
      id: c.id,
      name: c.name,
      status: c.status,
      is_active: c.isActive,
      created_at: c.createdAt,
      total_users: c._count.users,
      active_users: agg?.active_users ?? 0,
      logins: agg?.logins ?? 0,
      actions: agg?.actions ?? 0,
      requests,
      active_days: agg?.active_days ?? 0,
      period_days: days,
      last_activity: lastActivity,
      days_since_activity: daysSince,
      trend_pct: trendPct,
      engagement_score: score,
      engagement_level: engagementLevel(score),
      churn_risk: churnRisk(daysSince, trendPct, requests > 0),
    };
  });

  // Xavf yuqorilari birinchi: risk og'irligi bo'yicha, so'ng past ball birinchi
  const riskWeight: Record<ChurnRisk, number> = { high: 3, medium: 2, low: 1, none: 0 };
  results.sort((a, b) => riskWeight[b.churn_risk] - riskWeight[a.churn_risk] || a.engagement_score - b.engagement_score);

  return { date_from: from, date_to: to, days, results };
}

/* ============================================================
   3) Bitta kompaniya kesimi — kunlik seriya, top foydalanuvchilar, modullar
   ============================================================ */

interface CompanySeriesRow {
  date: string;
  requests: number;
  logins: number;
  actions: number;
  active_users: number;
}

interface TopUserRow {
  user_id: number;
  full_name: string | null;
  phone_number: string | null;
  email: string | null;
  requests: number;
  logins: number;
  actions: number;
  last_activity: string;
}

interface ModuleRow {
  entity: string;
  count: number;
}

export async function getCompanyUsage(companyId: number, range: UsageRange) {
  const { from, to } = range;
  const days = diffDays(from, to) + 1;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, status: true, createdAt: true, _count: { select: { users: true } } },
  });
  if (!company) throw new NotFound({ detail: 'Kompaniya topilmadi.' });

  const fromUtc = tashkentDayToUtc(from, false);
  const toUtc = tashkentDayToUtc(to, true);

  const [seriesRaw, topUsers, modules] = await Promise.all([
    prisma.$queryRaw<CompanySeriesRow[]>`
      SELECT
        date::text                   AS date,
        SUM(requests)::int           AS requests,
        SUM(logins)::int             AS logins,
        SUM(actions)::int            AS actions,
        COUNT(DISTINCT user_id)::int AS active_users
      FROM usage_daily
      WHERE company_id = ${companyId} AND date BETWEEN ${from}::date AND ${to}::date
      GROUP BY date
      ORDER BY date`,
    prisma.$queryRaw<TopUserRow[]>`
      SELECT
        d.user_id,
        u.full_name,
        u.phone_number,
        u.email,
        SUM(d.requests)::int  AS requests,
        SUM(d.logins)::int    AS logins,
        SUM(d.actions)::int   AS actions,
        MAX(d.date)::text     AS last_activity
      FROM usage_daily d
      JOIN users_user u ON u.id = d.user_id
      WHERE d.company_id = ${companyId} AND d.date BETWEEN ${from}::date AND ${to}::date
      GROUP BY d.user_id, u.full_name, u.phone_number, u.email
      ORDER BY SUM(d.requests) DESC
      LIMIT 10`,
    // Modul kesimi audit_log'dan: qaysi bo'limlar (sotuv, mahsulot, ...) ishlatilgan
    prisma.$queryRaw<ModuleRow[]>`
      SELECT entity, COUNT(*)::int AS count
      FROM audit_log
      WHERE company_id = ${companyId}
        AND action NOT IN ('login', 'logout')
        AND entity IS NOT NULL
        AND created_at BETWEEN ${fromUtc} AND ${toUtc}
      GROUP BY entity
      ORDER BY count DESC
      LIMIT 12`,
  ]);

  const byDate = new Map(seriesRaw.map((r) => [r.date, r]));
  const series: CompanySeriesRow[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    series.push(byDate.get(date) ?? { date, requests: 0, logins: 0, actions: 0, active_users: 0 });
  }

  return {
    company: {
      id: company.id,
      name: company.name,
      status: company.status,
      created_at: company.createdAt,
      total_users: company._count.users,
    },
    date_from: from,
    date_to: to,
    series,
    top_users: topUsers.map((u) => ({
      user_id: u.user_id,
      name: u.full_name || u.phone_number || u.email || `#${u.user_id}`,
      requests: u.requests,
      logins: u.logins,
      actions: u.actions,
      last_activity: u.last_activity,
    })),
    modules,
  };
}
