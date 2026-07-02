import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { DashboardDateRange } from './dateFilters.js';

// ─────────────────────────────────────────────
//  Chart service — Django dashboard_service.py:ChartService
//  weekly  -> 7 kun (Dushanba–Yakshanba), TruncDay
//  monthly -> 4 hafta (1-hafta..4-hafta), TruncWeek
//  yearly  -> 12 oy (Yanvar–Dekabr), TruncMonth
//  Barcha label'lar to'ldiriladi (ma'lumotsiz davr 0). Kelajak kunlar weekly'da null.
// ─────────────────────────────────────────────

const UZ_WEEKDAYS = [
  'Dushanba',
  'Seshanba',
  'Chorshanba',
  'Payshanba',
  'Juma',
  'Shanba',
  'Yakshanba',
];
const UZ_MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
];

export interface ChartData {
  labels: string[];
  data: (number | null)[];
}

function num(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return value;
}

// Django weekday(): 0=Dushanba..6=Yakshanba
function isoWeekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Joriy oraliqdagi sotuvlarni o'qiydi (kompaniya do'konlari bilan cheklangan).
async function fetchSales(storeIds: number[], dr: DashboardDateRange) {
  const where: Prisma.SaleWhereInput = {
    createdAt: { gte: dr.currentFrom, lte: dr.currentTo },
    storeId: { in: storeIds },
  };
  return prisma.sale.findMany({
    where,
    select: { createdAt: true, totalAmount: true },
  });
}

export async function buildChart(
  storeIds: number[],
  dr: DashboardDateRange,
  period: string,
): Promise<ChartData> {
  const sales = await fetchSales(storeIds, dr);

  if (period === 'weekly') return weeklyChart(sales, dr);
  if (period === 'monthly') return monthlyChart(sales, dr);
  return yearlyChart(sales);
}

// ── weekly: TruncDay; 7 kun Dushanba'dan, kelajak kunlar null ──
function weeklyChart(
  sales: { createdAt: Date; totalAmount: Prisma.Decimal }[],
  dr: DashboardDateRange,
): ChartData {
  const dayTotals = new Map<number, number>(); // kun (00:00 ts) -> total
  for (const s of sales) {
    const key = startOfDay(s.createdAt).getTime();
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + num(s.totalAmount));
  }

  const today = startOfDay(dr.currentTo);
  const monday = startOfDay(dr.currentFrom);

  const labels: string[] = [];
  const data: (number | null)[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    labels.push(UZ_WEEKDAYS[isoWeekdayIndex(day)]!);
    // Kelajak kunlar -> null; aks holda total (yo'q bo'lsa 0)
    if (day.getTime() <= today.getTime() || sameDay(day, today)) {
      data.push(dayTotals.get(day.getTime()) ?? 0);
    } else {
      data.push(null);
    }
  }

  return { labels, data };
}

// ── monthly: TruncWeek; 4 hafta (1-hafta..4-hafta) ──
function monthlyChart(
  sales: { createdAt: Date; totalAmount: Prisma.Decimal }[],
  dr: DashboardDateRange,
): ChartData {
  const fromDay = startOfDay(dr.currentFrom);
  const weekTotals = new Map<number, number>();

  for (const s of sales) {
    const day = startOfDay(s.createdAt);
    const diffDays = Math.floor((day.getTime() - fromDay.getTime()) / 86400000);
    const weekNum = Math.floor(diffDays / 7) + 1;
    if (weekNum >= 1 && weekNum <= 4) {
      weekTotals.set(weekNum, (weekTotals.get(weekNum) ?? 0) + num(s.totalAmount));
    }
  }

  const labels: string[] = [];
  const data: (number | null)[] = [];
  for (let i = 1; i <= 4; i += 1) {
    labels.push(`${i}-hafta`);
    data.push(weekTotals.get(i) ?? 0);
  }

  return { labels, data };
}

// ── yearly: TruncMonth; 12 oy (Yanvar–Dekabr) ──
function yearlyChart(
  sales: { createdAt: Date; totalAmount: Prisma.Decimal }[],
): ChartData {
  const monthTotals = new Map<number, number>(); // 1..12 -> total
  for (const s of sales) {
    const m = s.createdAt.getMonth() + 1;
    monthTotals.set(m, (monthTotals.get(m) ?? 0) + num(s.totalAmount));
  }

  const labels = [...UZ_MONTHS];
  const data: (number | null)[] = [];
  for (let m = 1; m <= 12; m += 1) {
    data.push(monthTotals.get(m) ?? 0);
  }

  return { labels, data };
}
