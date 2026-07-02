import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

// ─────────────────────────────────────────────
//  Summary + shared sales helpers
//  Django apps/reports/services/report_service.py:
//    _store_q, _returns_subquery, _base_sales_qs, SummaryService
//  Decimal -> number (DRF JSON encoder bilan moslangan).
// ─────────────────────────────────────────────

// Sale.Status: paid/partial/debt; returned (RETURNED) = 'r' (schema: paid/partial/debt/r)
export const SALE_STATUS = {
  PAID: 'paid',
  PARTIAL: 'partial',
  DEBT: 'debt',
  RETURNED: 'r',
} as const;

const D0 = new Prisma.Decimal(0);

export function dec(value: Prisma.Decimal | number | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined) return D0;
  if (value instanceof Prisma.Decimal) return value;
  return new Prisma.Decimal(value);
}

export function num(value: Prisma.Decimal | number | null | undefined): number {
  return dec(value).toNumber();
}

// _store_q(store_id, field): store_id null -> bo'sh shart.
// date filtri Django'da created_at__date__gte/lte — bu yerda kun chegaralari
// chaqiruvchi tomonidan [date_from 00:00, date_to 23:59:59.999] sifatida beriladi.

// _base_sales_qs natijasiga ekvivalent: RETURNED bo'lmagan sotuvlar + har biriga
// refunded summasi (SaleReturn.total_refund yig'indisi). Prisma'da Sale + returns
// ni o'qib, JS'da refunded ni hisoblaymiz (Subquery ekvivalenti).
export interface SaleWithRefund {
  id: number;
  storeId: number;
  storeName: string;
  customerId: number | null;
  totalAmount: Prisma.Decimal;
  refunded: Prisma.Decimal;
}

export async function getBaseSales(
  dateFrom: Date,
  dateTo: Date,
  storeIds: number[],
): Promise<SaleWithRefund[]> {
  const where: Prisma.SaleWhereInput = {
    createdAt: { gte: dateFrom, lte: dateTo },
    status: { not: SALE_STATUS.RETURNED },
    // Tenant izolyatsiyasi: faqat kompaniyaning do'konlari.
    storeId: { in: storeIds },
  };

  const sales = await prisma.sale.findMany({
    where,
    select: {
      id: true,
      storeId: true,
      customerId: true,
      totalAmount: true,
      store: { select: { name: true } },
      returns: { select: { totalRefund: true } },
    },
  });

  return sales.map((s) => {
    let refunded = D0;
    for (const r of s.returns) refunded = refunded.add(dec(r.totalRefund));
    return {
      id: s.id,
      storeId: s.storeId,
      storeName: s.store.name,
      customerId: s.customerId,
      totalAmount: dec(s.totalAmount),
      refunded,
    };
  });
}

// ── SummaryService.get ──
// totalRevenue = Σ(total_amount - refunded)
// totalOrders  = count
// totalCustomers = distinct customer (customer != null)
// totalProfit  = Σ (unit_price - coalesce(purchase_price,0)) * quantity
//                faqat status in [paid, partial] SaleItem'lar uchun
// totalExpenses = revenue - profit
// averageOrderValue = orders ? round(revenue/orders, 2) : 0
export async function getSummary(
  dateFrom: Date,
  dateTo: Date,
  storeIds: number[],
) {
  const sales = await getBaseSales(dateFrom, dateTo, storeIds);

  let totalRevenue = D0;
  const customerSet = new Set<number>();
  for (const s of sales) {
    totalRevenue = totalRevenue.add(s.totalAmount.sub(s.refunded));
    if (s.customerId !== null) customerSet.add(s.customerId);
  }
  const totalOrders = sales.length;
  const totalCustomers = customerSet.size;

  // Foyda — SaleItem (status paid/partial)
  const itemWhere: Prisma.SaleItemWhereInput = {
    sale: {
      createdAt: { gte: dateFrom, lte: dateTo },
      status: { in: [SALE_STATUS.PAID, SALE_STATUS.PARTIAL] },
      storeId: { in: storeIds },
    },
  };
  const items = await prisma.saleItem.findMany({
    where: itemWhere,
    select: { unitPrice: true, purchasePrice: true, quantity: true },
  });

  let totalProfit = D0;
  for (const it of items) {
    const pp = it.purchasePrice === null ? D0 : dec(it.purchasePrice);
    totalProfit = totalProfit.add(dec(it.unitPrice).sub(pp).mul(it.quantity));
  }

  const totalExpenses = totalRevenue.sub(totalProfit);
  const averageOrderValue = totalOrders
    ? totalRevenue.div(totalOrders).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : D0;

  return {
    totalRevenue: num(totalRevenue),
    totalProfit: num(totalProfit),
    totalExpenses: num(totalExpenses),
    totalOrders,
    averageOrderValue: num(averageOrderValue),
    totalCustomers,
  };
}
