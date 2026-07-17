import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { addDays, resolveDashboardRange, type DashboardDateRange } from './dateFilters.js';
import { buildChart } from './chart.service.js';
import { getSummary } from './summary.service.js';

// ─────────────────────────────────────────────
//  Dashboard service — Django apps/reports/services/dashboard_service.py
//  DashboardAPIView uchun: kpi, topParts, lowStock, recentSales, chart.
// ─────────────────────────────────────────────

const LOW_STOCK_THRESHOLD = 5;
const RECENT_SALES_LIMIT = 1;
const TOP_PARTS_LIMIT = 5;
const LOW_STOCK_LIMIT = 3;

const D0 = new Prisma.Decimal(0);

// Decimal -> number (DRF JSON encoder Decimal'ni son sifatida chiqaradi).
function num(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return value;
}

// Tenant izolyatsiyasi: hisobot HAR DOIM kompaniyaning do'konlari bilan cheklanadi.
// storeIds — resolveReportStoreIds (route) tomonidan hal qilingan ruxsatli do'kon ID'lari.
function storeFilter(storeIds: number[]): { storeId: { in: number[] } } {
  return { storeId: { in: storeIds } };
}

// _growth: ((cur - prev) / prev) * 100; prev=0 -> cur>0 ? 100.0 : 0.0; 1 kasrgacha.
function growth(current: number, previous: number): number {
  if (!previous) {
    return current ? 100.0 : 0.0;
  }
  return round1(((current - previous) / previous) * 100);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── KPIService.get ──
// 2 ta sales aggregate (joriy + oldingi) + low stock count.
export async function getDashboardKpi(
  storeIds: number[],
  dr: DashboardDateRange,
) {
  const sf = storeFilter(storeIds);

  const cur = await prisma.sale.aggregate({
    where: { ...sf, createdAt: { gte: dr.currentFrom, lte: dr.currentTo } },
    _sum: { totalAmount: true, paidAmount: true },
    _count: { _all: true },
  });
  const prev = await prisma.sale.aggregate({
    where: { ...sf, createdAt: { gte: dr.prevFrom, lte: dr.prevTo } },
    _sum: { totalAmount: true, paidAmount: true },
    _count: { _all: true },
  });

  const curRevenue = num(cur._sum.totalAmount);
  const curPaid = num(cur._sum.paidAmount);
  const curDebt = curRevenue - curPaid;
  const curOrders = cur._count._all;

  const prevRevenue = num(prev._sum.totalAmount);
  const prevPaid = num(prev._sum.paidAmount);
  const prevDebt = prevRevenue - prevPaid;
  const prevOrders = prev._count._all;

  // lowStockCount — ProductBatch.quantity < threshold, is_active=true
  const lowStockCount = await prisma.productBatch.count({
    where: { ...sf, quantity: { lt: LOW_STOCK_THRESHOLD }, isActive: true },
  });

  return {
    revenue: curRevenue,
    revenueGrowth: growth(curRevenue, prevRevenue),
    debt: curDebt,
    debtGrowth: growth(curDebt, prevDebt),
    orders: curOrders,
    ordersGrowth: growth(curOrders, prevOrders),
    lowStockCount,
  };
}

// ── TopPartsService.get ──
// SaleItem -> product, sotilgan miqdor (sold) bo'yicha tartiblangan TOP 5.
export async function getTopParts(storeIds: number[], dr: DashboardDateRange) {
  const saleWhere: Prisma.SaleItemWhereInput = {
    sale: {
      createdAt: { gte: dr.currentFrom, lte: dr.currentTo },
      storeId: { in: storeIds },
    },
  };

  const grouped = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: saleWhere,
    _sum: { quantity: true, totalPrice: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: TOP_PARTS_LIMIT,
  });

  const productIds = grouped.map((g) => g.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(products.map((p) => [p.id, p.name]));

  return grouped.map((g) => ({
    id: g.productId,
    name: nameMap.get(g.productId) ?? null,
    sold: g._sum.quantity ?? 0,
    rev: num(g._sum.totalPrice ?? D0),
  }));
}

// ── LowStockService.get ──
// quantity < threshold, is_active; quantity bo'yicha o'sish tartibi; LIMIT 3.
export async function getLowStock(storeIds: number[]) {
  const sf = storeFilter(storeIds);
  const batches = await prisma.productBatch.findMany({
    where: { ...sf, quantity: { lt: LOW_STOCK_THRESHOLD }, isActive: true },
    select: { id: true, quantity: true, product: { select: { name: true } } },
    orderBy: { quantity: 'asc' },
    take: LOW_STOCK_LIMIT,
  });

  return batches.map((b) => ({
    id: b.id,
    name: b.product.name,
    quantity: b.quantity,
  }));
}

// ── RecentSalesService.get ──
// Oxirgi N ta sotuv; mijoz bo'lmasa seller.full_name; minutesAgo.
export async function getRecentSales(storeIds: number[]) {
  const now = Date.now();
  const sf = storeFilter(storeIds);
  const sales = await prisma.sale.findMany({
    where: { ...sf },
    select: {
      id: true,
      totalAmount: true,
      status: true,
      createdAt: true,
      customer: { select: { fullName: true } },
      seller: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: RECENT_SALES_LIMIT,
  });

  return sales.map((s) => ({
    id: s.id,
    client: s.customer
      ? s.customer.fullName
      : `${s.seller.fullName ?? ''}`.trim(),
    amount: num(s.totalAmount),
    minutesAgo: Math.max(0, Math.floor((now - s.createdAt.getTime()) / 1000 / 60)),
    type: s.status,
  }));
}

// ── Kunlik (bugungi) statistika ──
// Davr tanlovidan mustaqil: bugun 00:00 → hozir; o'sish — kechagi xuddi shu
// vaqt oynasiga nisbatan (kecha 00:00 → kecha hozirgi soat). getSummary
// SQL agregatlarini qayta ishlatadi (tushum/foyda/buyurtma/mijoz).
export async function getTodayStats(storeIds: number[]) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const prevStart = addDays(todayStart, -1);
  const prevEnd = addDays(now, -1);

  const [today, yesterday] = await Promise.all([
    getSummary(todayStart, now, storeIds),
    getSummary(prevStart, prevEnd, storeIds),
  ]);

  return {
    revenue: today.totalRevenue,
    revenueGrowth: growth(today.totalRevenue, yesterday.totalRevenue),
    profit: today.totalProfit,
    profitGrowth: growth(today.totalProfit, yesterday.totalProfit),
    orders: today.totalOrders,
    ordersGrowth: growth(today.totalOrders, yesterday.totalOrders),
    customers: today.totalCustomers,
    avgReceipt: today.averageOrderValue,
  };
}

// ── DashboardAPIView.get facade ──
// period validatsiyasi view'da bo'ladi; bu yerda barcha bloklar yig'iladi.
export async function getDashboard(period: string, storeIds: number[]) {
  const dr = resolveDashboardRange(period);

  const [kpi, today, topParts, lowStock, recentSales, chart] = await Promise.all([
    getDashboardKpi(storeIds, dr),
    getTodayStats(storeIds),
    getTopParts(storeIds, dr),
    getLowStock(storeIds),
    getRecentSales(storeIds),
    buildChart(storeIds, dr, period),
  ]);

  return {
    kpi,
    today,
    topParts,
    lowStock,
    recentSales,
    chart,
  };
}
