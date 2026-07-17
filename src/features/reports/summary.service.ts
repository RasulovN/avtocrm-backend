import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

// ─────────────────────────────────────────────
//  Summary + shared sales helpers
//  Django apps/reports/services/report_service.py:
//    _store_q, _returns_subquery, _base_sales_qs, SummaryService
//  Decimal -> number (DRF JSON encoder bilan moslangan).
//
//  PERF: barcha yig'indilar SQL darajasida (GROUP BY / aggregate) hisoblanadi —
//  avvalgi "hamma qatorlarni yuklab JS'da yig'ish" yondashuvi katta bazada
//  sekundlab vaqt olar va katta payload keltirar edi.
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

// ── Do'kon kesimidagi sotuv agregatlari (RETURNED bo'lmagan sotuvlar) ──
// revenue = Σ(total_amount - refunded), orders = count, customers = distinct.
// Bitta SQL: sale_return yig'indisi LEFT JOIN subquery orqali (kartezian yo'q).
export interface StoreSalesAggregate {
  storeId: number;
  storeName: string;
  revenue: Prisma.Decimal;
  orders: number;
  customers: number;
}

export async function getStoreSalesAggregates(
  dateFrom: Date,
  dateTo: Date,
  storeIds: number[],
): Promise<StoreSalesAggregate[]> {
  if (storeIds.length === 0) return [];

  const rows = await prisma.$queryRaw<
    Array<{ store_id: number; store_name: string; revenue: Prisma.Decimal; orders: bigint; customers: bigint }>
  >(Prisma.sql`
    SELECT
      s.store_id,
      st.name AS store_name,
      COALESCE(SUM(s.total_amount - COALESCE(r.refund, 0)), 0) AS revenue,
      COUNT(*) AS orders,
      COUNT(DISTINCT s.customer_id) AS customers
    FROM sales_sale s
    JOIN store st ON st.id = s.store_id
    LEFT JOIN (
      SELECT sale_id, SUM(total_refund) AS refund
      FROM sale_return
      GROUP BY sale_id
    ) r ON r.sale_id = s.id
    WHERE s.created_at >= ${dateFrom}
      AND s.created_at <= ${dateTo}
      AND s.status <> ${SALE_STATUS.RETURNED}
      AND s.store_id IN (${Prisma.join(storeIds)})
    GROUP BY s.store_id, st.name
    ORDER BY revenue DESC
  `);

  return rows.map((r) => ({
    storeId: r.store_id,
    storeName: r.store_name,
    revenue: dec(r.revenue),
    orders: Number(r.orders),
    customers: Number(r.customers),
  }));
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
  if (storeIds.length === 0) {
    return {
      totalRevenue: 0,
      totalProfit: 0,
      totalExpenses: 0,
      totalOrders: 0,
      averageOrderValue: 0,
      totalCustomers: 0,
    };
  }

  // Umumiy revenue/orders/distinct-customers — bitta SQL (do'konlar kesimisiz,
  // distinct mijozlar do'konlar orasida takrorlansa ham 1 marta sanaladi)
  const [summaryRows, profitRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{ revenue: Prisma.Decimal; orders: bigint; customers: bigint }>
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(s.total_amount - COALESCE(r.refund, 0)), 0) AS revenue,
        COUNT(*) AS orders,
        COUNT(DISTINCT s.customer_id) AS customers
      FROM sales_sale s
      LEFT JOIN (
        SELECT sale_id, SUM(total_refund) AS refund
        FROM sale_return
        GROUP BY sale_id
      ) r ON r.sale_id = s.id
      WHERE s.created_at >= ${dateFrom}
        AND s.created_at <= ${dateTo}
        AND s.status <> ${SALE_STATUS.RETURNED}
        AND s.store_id IN (${Prisma.join(storeIds)})
    `),
    // Foyda — SaleItem (status paid/partial), to'liq SQL yig'indi
    prisma.$queryRaw<Array<{ profit: Prisma.Decimal }>>(Prisma.sql`
      SELECT COALESCE(SUM((i.unit_price - COALESCE(i.purchase_price, 0)) * i.quantity), 0) AS profit
      FROM sales_saleitem i
      JOIN sales_sale s ON s.id = i.sale_id
      WHERE s.created_at >= ${dateFrom}
        AND s.created_at <= ${dateTo}
        AND s.status IN (${SALE_STATUS.PAID}, ${SALE_STATUS.PARTIAL})
        AND s.store_id IN (${Prisma.join(storeIds)})
    `),
  ]);

  const totalRevenue = dec(summaryRows[0]?.revenue);
  const totalOrders = Number(summaryRows[0]?.orders ?? 0);
  const totalCustomers = Number(summaryRows[0]?.customers ?? 0);
  const totalProfit = dec(profitRows[0]?.profit);

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
