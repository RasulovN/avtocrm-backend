import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { dateFromISO, localDate, addDays, endOfDay } from './dateFilters.js';
import {
  SALE_STATUS,
  dec,
  num,
  getStoreSalesAggregates,
  getSummary,
} from './summary.service.js';

// ─────────────────────────────────────────────
//  Report facade — Django apps/reports/services/report_service.py
//  ReportFilterService, BranchService, CategoryStatisticsService,
//  TopProductsService, PaymentStructureService, DebtService, ReportService.
// ─────────────────────────────────────────────

const TOP_PRODUCTS_LIMIT = 5;

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Naqd',
  card: 'Karta',
  debt: 'Qarz',
};

const D0 = new Prisma.Decimal(0);

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── ReportFilterService.resolve_dates ──
//   from/to berilsa -> [from, to] (ISO YYYY-MM-DD)
//   aks holda filter_type bo'yicha:
//     weekly -> joriy haftaning Dushanbasi .. bugun
//     yearly -> bugun-365 .. bugun
//     default(monthly) -> bugun-30 .. bugun
// Qaytariladigan qiymatlar — kun chegaralari (Django created_at__date__gte/lte ekvivalenti
// uchun [from 00:00, to 23:59:59.999]).
export function resolveDates(
  filterType: string | undefined,
  fromRaw: string | undefined,
  toRaw: string | undefined,
): { dateFrom: Date; dateTo: Date } {
  if (fromRaw && toRaw) {
    const from = dateFromISO(fromRaw);
    const to = dateFromISO(toRaw);
    return { dateFrom: from, dateTo: endOfDay(to) };
  }

  const today = localDate();
  if (filterType === 'weekly') {
    const isoWeekday = (today.getDay() + 6) % 7; // 0=Dushanba
    return { dateFrom: addDays(today, -isoWeekday), dateTo: endOfDay(today) };
  }
  if (filterType === 'yearly') {
    return { dateFrom: addDays(today, -365), dateTo: endOfDay(today) };
  }
  // default monthly
  return { dateFrom: addDays(today, -30), dateTo: endOfDay(today) };
}

// ── BranchService.get ──
// Har do'kon: revenue=Σ(total_amount-refunded), orders=count, customers=distinct(customer)
// revenue bo'yicha kamayish tartibi. To'liq SQL GROUP BY (getStoreSalesAggregates).
export async function getBranchStatistics(
  dateFrom: Date,
  dateTo: Date,
  storeIds: number[],
) {
  const aggregates = await getStoreSalesAggregates(dateFrom, dateTo, storeIds);
  return aggregates.map((a) => ({
    store_id: a.storeId,
    store__name: a.storeName,
    revenue: num(a.revenue),
    orders: a.orders,
    customers: a.customers,
  }));
}

// ── CategoryStatisticsService.get ──
// SaleItem (status paid/partial) -> product.category.name bo'yicha revenue=Σ(total_price)
// percent = revenue / total * 100 (1 kasr). revenue bo'yicha kamayish.
// PERF: SQL GROUP BY (productId) + faqat sotilgan productlarning kategoriya nomlari —
// barcha SaleItem qatorlarini JS'ga yuklamaymiz.
export async function getCategoryStatistics(
  dateFrom: Date,
  dateTo: Date,
  storeIds: number[],
) {
  const grouped = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: {
      sale: {
        createdAt: { gte: dateFrom, lte: dateTo },
        status: { in: [SALE_STATUS.PAID, SALE_STATUS.PARTIAL] },
        storeId: { in: storeIds },
      },
    },
    _sum: { totalPrice: true },
  });

  if (grouped.length === 0) return [];

  // Sotilgan productlar -> kategoriya nomi (2 ta yengil so'rov)
  const products = await prisma.product.findMany({
    where: { id: { in: grouped.map((g) => g.productId) } },
    select: { id: true, categoryId: true },
  });
  const categoryByProduct = new Map(products.map((p) => [p.id, p.categoryId]));
  const categoryIds = [...new Set(products.map((p) => p.categoryId).filter((c): c is number => c !== null))];
  const categories = categoryIds.length
    ? await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
    : [];
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));

  const map = new Map<string | null, Prisma.Decimal>();
  for (const g of grouped) {
    const categoryId = categoryByProduct.get(g.productId) ?? null;
    const name = categoryId !== null ? categoryNames.get(categoryId) ?? null : null;
    map.set(name, (map.get(name) ?? D0).add(dec(g._sum.totalPrice)));
  }

  let total = D0;
  for (const v of map.values()) total = total.add(v);
  if (total.isZero()) total = new Prisma.Decimal(1);

  const rows = [...map.entries()].map(([name, revenue]) => ({
    categoryName: name ?? "Noma'lum",
    revenue: num(revenue),
    percent: round1(revenue.div(total).mul(100).toNumber()),
    _rev: revenue,
  }));
  rows.sort((a, b) => b._rev.cmp(a._rev));
  return rows.map(({ _rev, ...r }) => r);
}

// ── TopProductsService.get (report) ──
// SaleItem -> product(+category) bo'yicha totalSold=Σquantity, totalRevenue=Σtotal_price
// totalSold bo'yicha kamayish, TOP 5; rank 1..N.
export async function getTopSellingProducts(
  dateFrom: Date,
  dateTo: Date,
  storeIds: number[],
) {
  const grouped = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: {
      sale: {
        createdAt: { gte: dateFrom, lte: dateTo },
        storeId: { in: storeIds },
      },
    },
    _sum: { quantity: true, totalPrice: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: TOP_PRODUCTS_LIMIT,
  });

  const productIds = grouped.map((g) => g.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, category: { select: { name: true } } },
  });
  const pmap = new Map(products.map((p) => [p.id, p]));

  return grouped.map((g, i) => {
    const p = pmap.get(g.productId);
    return {
      rank: i + 1,
      productId: g.productId,
      name: p?.name ?? null,
      category: p?.category?.name ?? "Noma'lum",
      totalSold: g._sum.quantity ?? 0,
      totalRevenue: num(g._sum.totalPrice ?? D0),
    };
  });
}

// ── PaymentStructureService.get ──
// Payment (sale.storeId filtri) -> type + methodId bo'yicha count, amount:
//   naqd bitta qator; karta to'lovlari kanal (Uzcard/Humo/Visa/Payme/...) bo'yicha
//   alohida qatorlarga ajratiladi (kanal ko'rsatilmagan eski kartalar — "Karta").
// 'debt' type Payment'dan chiqarib tashlanadi; qarz Sale.status='debt' orqali qo'shiladi.
// percent = amount / total_amount * 100 (1 kasr) + '%'.
export async function getPaymentStructure(
  dateFrom: Date,
  dateTo: Date,
  storeIds: number[],
) {
  const grouped = await prisma.payment.groupBy({
    by: ['type', 'methodId'],
    where: {
      createdAt: { gte: dateFrom, lte: dateTo },
      sale: { storeId: { in: storeIds } },
    },
    _count: { _all: true },
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'desc' } },
  });

  let totalAmount = D0;
  for (const r of grouped) totalAmount = totalAmount.add(dec(r._sum.amount));
  if (totalAmount.isZero()) totalAmount = new Prisma.Decimal(1);

  // Kanal nomlari (Uzcard, Humo, Payme...)
  const methodIds = [...new Set(grouped.map((r) => r.methodId).filter((m): m is number => m !== null))];
  const methods = methodIds.length
    ? await prisma.paymentMethod.findMany({ where: { id: { in: methodIds } }, select: { id: true, name: true } })
    : [];
  const methodNames = new Map(methods.map((m) => [m.id, m.name]));

  // Qarz — Sale.status='debt' orqali: bitta aggregate (Σtotal - Σpaid), qatorlar yuklanmaydi
  const debtSales = await prisma.sale.aggregate({
    where: {
      createdAt: { gte: dateFrom, lte: dateTo },
      status: SALE_STATUS.DEBT,
      storeId: { in: storeIds },
    },
    _count: { _all: true },
    _sum: { totalAmount: true, paidAmount: true },
  });
  const debtAmount = dec(debtSales._sum.totalAmount).sub(dec(debtSales._sum.paidAmount));

  // type+method bo'yicha yig'ish: naqd hammasi bitta, karta kanal bo'yicha
  interface Acc { count: number; amount: Prisma.Decimal }
  const buckets = new Map<string, Acc>();
  for (const r of grouped) {
    if (r.type === 'debt') continue; // Sale orqali alohida
    const label =
      r.type === 'card'
        ? (r.methodId !== null ? methodNames.get(r.methodId) ?? PAYMENT_METHOD_LABELS.card : PAYMENT_METHOD_LABELS.card)
        : PAYMENT_METHOD_LABELS[r.type] ?? r.type;
    const acc = buckets.get(label) ?? { count: 0, amount: D0 };
    acc.count += r._count._all;
    acc.amount = acc.amount.add(dec(r._sum.amount));
    buckets.set(label, acc);
  }

  const result: Array<{ method: string; count: number; amount: number; percent: string }> = [];
  const rows = [...buckets.entries()].sort(([, a], [, b]) => b.amount.cmp(a.amount));
  for (const [label, acc] of rows) {
    result.push({
      method: label,
      count: acc.count,
      amount: num(acc.amount),
      percent: `${round1(acc.amount.div(totalAmount).mul(100).toNumber())}%`,
    });
  }

  if (!debtAmount.isZero()) {
    result.push({
      method: 'Qarz',
      count: debtSales._count._all,
      amount: num(debtAmount),
      percent: `${round1(debtAmount.div(totalAmount).mul(100).toNumber())}%`,
    });
  }

  return result;
}

// ── DebtService.customer_debts ──
// CustomerDebt (sale.storeId filtri) -> customer bo'yicha inc(type='i') - dec(type='d')
// faqat musbat qarzlar.
// PERF: SQL GROUP BY — har mijozga bitta qator, keyin faqat qarzdor
// mijozlarning nomi/telefoni olinadi (barcha qarz qatorlari JS'ga yuklanmaydi).
export async function getCustomerDebts(storeIds: number[]) {
  if (storeIds.length === 0) return [];

  const grouped = await prisma.customerDebt.groupBy({
    by: ['customerId', 'type'],
    where: { sale: { storeId: { in: storeIds } } },
    _sum: { amount: true },
  });

  const debtByCustomer = new Map<number, Prisma.Decimal>();
  for (const g of grouped) {
    const prev = debtByCustomer.get(g.customerId) ?? D0;
    const amount = dec(g._sum.amount);
    debtByCustomer.set(g.customerId, g.type === 'i' ? prev.add(amount) : prev.sub(amount));
  }

  const debtorIds = [...debtByCustomer.entries()].filter(([, d]) => d.gt(0)).map(([id]) => id);
  if (debtorIds.length === 0) return [];

  const customers = await prisma.customer.findMany({
    where: { id: { in: debtorIds } },
    select: { id: true, fullName: true, phoneNumber: true },
  });

  const out: Array<{ customerName: string; phone: string; debt: number }> = [];
  for (const c of customers) {
    const debt = debtByCustomer.get(c.id);
    if (debt && debt.gt(0)) {
      out.push({ customerName: c.fullName, phone: c.phoneNumber, debt: num(debt) });
    }
  }
  out.sort((a, b) => b.debt - a.debt);
  return out;
}

// ── DebtService.supplier_debts ──
// SupplierTransaction (entry.storeId filtri) -> supplier bo'yicha
// inc(type='in') - dec(type='pay'); faqat musbat qarzlar.
// PERF: SQL GROUP BY — tranzaksiya qatorlari JS'ga yuklanmaydi.
export async function getSupplierDebts(storeIds: number[]) {
  if (storeIds.length === 0) return [];

  const grouped = await prisma.supplierTransaction.groupBy({
    by: ['supplierId', 'type'],
    where: { entry: { storeId: { in: storeIds } } },
    _sum: { amount: true },
  });

  const debtBySupplier = new Map<number, Prisma.Decimal>();
  for (const g of grouped) {
    const prev = debtBySupplier.get(g.supplierId) ?? D0;
    const amount = dec(g._sum.amount);
    debtBySupplier.set(g.supplierId, g.type === 'in' ? prev.add(amount) : prev.sub(amount));
  }

  const debtorIds = [...debtBySupplier.entries()].filter(([, d]) => d.gt(0)).map(([id]) => id);
  if (debtorIds.length === 0) return [];

  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: debtorIds } },
    select: { id: true, name: true },
  });

  const out: Array<{ supplierName: string; debt: number }> = [];
  for (const s of suppliers) {
    const debt = debtBySupplier.get(s.id);
    if (debt && debt.gt(0)) {
      out.push({ supplierName: s.name, debt: num(debt) });
    }
  }
  out.sort((a, b) => b.debt - a.debt);
  return out;
}

// ── ReportService.get facade ──
export interface ReportData {
  summary: Awaited<ReturnType<typeof getSummary>>;
  branchStatistics: Awaited<ReturnType<typeof getBranchStatistics>>;
  categoryStatistics: Awaited<ReturnType<typeof getCategoryStatistics>>;
  topSellingProducts: Awaited<ReturnType<typeof getTopSellingProducts>>;
  paymentStructure: Awaited<ReturnType<typeof getPaymentStructure>>;
  debts: {
    customerDebts: Awaited<ReturnType<typeof getCustomerDebts>>;
    supplierDebts: Awaited<ReturnType<typeof getSupplierDebts>>;
  };
}

export async function getReport(
  params: {
    filter?: string;
    from?: string;
    to?: string;
  },
  // Tenant izolyatsiyasi: chaqiruvchi kompaniya/foydalanuvchiga ruxsat etilgan
  // do'kon ID'lari (route qatlamida resolveReportStoreIds bilan hal qilinadi).
  storeIds: number[],
): Promise<ReportData> {
  const filterType = params.filter ?? 'monthly';
  const { dateFrom, dateTo } = resolveDates(filterType, params.from, params.to);

  const [
    summary,
    branchStatistics,
    categoryStatistics,
    topSellingProducts,
    paymentStructure,
    customerDebts,
    supplierDebts,
  ] = await Promise.all([
    getSummary(dateFrom, dateTo, storeIds),
    getBranchStatistics(dateFrom, dateTo, storeIds),
    getCategoryStatistics(dateFrom, dateTo, storeIds),
    getTopSellingProducts(dateFrom, dateTo, storeIds),
    getPaymentStructure(dateFrom, dateTo, storeIds),
    getCustomerDebts(storeIds),
    getSupplierDebts(storeIds),
  ]);

  return {
    summary,
    branchStatistics,
    categoryStatistics,
    topSellingProducts,
    paymentStructure,
    debts: { customerDebts, supplierDebts },
  };
}
