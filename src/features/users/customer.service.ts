import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound } from '../../common/errors.js';
import type { PageParams } from '../../common/pagination.js';

// DRF Customer viewlari: total_purchase_amount, total_debt, store_debts, sales.
//
// PERF: ro'yxat (list) endi har mijozning TO'LIQ sotuv tarixini yuklamaydi —
// jami xarid/qarz SQL GROUP BY bilan hisoblanadi. To'liq tarix (sales,
// store_debts) faqat detail (getCustomer) da qaytadi.

// Detail'da sotuvlar soni cheklanadi — juda katta tarixli mijoz ham 1s ichida ochiladi
const DETAIL_SALES_LIMIT = 100;

type CustomerDetail = Prisma.CustomerGetPayload<{
  include: {
    sales: { include: { store: true; items: { include: { product: true } } } };
    debts: { include: { sale: { include: { store: true } } } };
  };
}>;

function dec(v: Prisma.Decimal | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'number' ? v : v.toNumber();
}

// Sahifadagi mijozlar uchun jami xarid/qarz — 2 ta GROUP BY so'rovi
async function customerTotals(customerIds: number[]) {
  const purchase = new Map<number, number>();
  const debt = new Map<number, number>();
  if (customerIds.length === 0) return { purchase, debt };

  const [saleGroups, debtGroups] = await Promise.all([
    // total_purchase_amount: qaytarilmagan (status != 'r') sotuvlar yig'indisi
    prisma.sale.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds }, status: { not: 'r' } },
      _sum: { totalAmount: true },
    }),
    // total_debt: CustomerDebt type "i" (kirim) - "d" (kamayish)
    prisma.customerDebt.groupBy({
      by: ['customerId', 'type'],
      where: { customerId: { in: customerIds } },
      _sum: { amount: true },
    }),
  ]);

  for (const g of saleGroups) {
    if (g.customerId !== null) purchase.set(g.customerId, dec(g._sum.totalAmount));
  }
  for (const g of debtGroups) {
    const prev = debt.get(g.customerId) ?? 0;
    const amount = dec(g._sum.amount);
    debt.set(g.customerId, g.type === 'i' ? prev + amount : prev - amount);
  }
  return { purchase, debt };
}

function serializeDetail(c: CustomerDetail, totalPurchase: number) {
  // total_debt + store_debts — yuklangan qarz yozuvlaridan (mijoz uchun to'liq)
  const totalDebt = c.debts.reduce(
    (acc, d) => acc + (d.type === 'i' ? dec(d.amount) : -dec(d.amount)),
    0,
  );

  const storeMap = new Map<string, number>();
  for (const d of c.debts) {
    const storeName = d.sale?.store?.name;
    if (!storeName) continue;
    const delta = d.type === 'i' ? dec(d.amount) : -dec(d.amount);
    storeMap.set(storeName, (storeMap.get(storeName) ?? 0) + delta);
  }
  const storeDebts = [...storeMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([store, debt]) => ({ store, debt: Math.round(debt * 100) / 100 }));

  return {
    id: c.id,
    full_name: c.fullName,
    phone_number: c.phoneNumber,
    total_purchase_amount: totalPurchase.toFixed(2),
    total_debt: totalDebt.toFixed(2),
    store_debts: storeDebts,
    sales: c.sales.map((s) => ({
      id: s.id,
      store_name: s.store.name,
      total_amount: dec(s.totalAmount).toFixed(2),
      paid_amount: dec(s.paidAmount).toFixed(2),
      status: s.status,
      created_at: s.createdAt,
      items: s.items.map((it) => ({
        id: it.id,
        product: it.productId,
        product_name: it.product.name,
        quantity: it.quantity,
        total_price: dec(it.totalPrice).toFixed(2),
      })),
    })),
  };
}

export async function listCustomers(opts: {
  companyId: number;
  search?: string;
  ordering?: string;
  page: PageParams;
}) {
  const where: Prisma.CustomerWhereInput = { companyId: opts.companyId };
  if (opts.search) {
    where.OR = [
      { fullName: { contains: opts.search, mode: 'insensitive' } },
      { phoneNumber: { contains: opts.search, mode: 'insensitive' } },
    ];
  }

  // Tartiblash: total_debt / total_purchase_amount uchun annotatsiya bo'lmagani sababli
  // full_name bo'yicha DB-da, qolganlari uchun xotirada tartiblanadi.
  const dbOrder: Prisma.CustomerOrderByWithRelationInput =
    opts.ordering === '-full_name' ? { fullName: 'desc' } : { fullName: 'asc' };

  const [count, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: dbOrder,
      skip: opts.page.skip,
      take: opts.page.take,
    }),
  ]);

  const totals = await customerTotals(customers.map((c) => c.id));

  let results = customers.map((c) => ({
    id: c.id,
    full_name: c.fullName,
    phone_number: c.phoneNumber,
    total_purchase_amount: (totals.purchase.get(c.id) ?? 0).toFixed(2),
    total_debt: (totals.debt.get(c.id) ?? 0).toFixed(2),
    // To'liq tarix faqat detail'da — ro'yxat javobi yengil qoladi
    store_debts: [] as Array<{ store: string; debt: number }>,
    sales: [] as never[],
  }));

  if (opts.ordering && /(total_debt|total_purchase_amount)/.test(opts.ordering)) {
    const desc = opts.ordering.startsWith('-');
    const key = opts.ordering.replace('-', '') as 'total_debt' | 'total_purchase_amount';
    results = results.sort((a, b) => {
      const av = Number(a[key]);
      const bv = Number(b[key]);
      return desc ? bv - av : av - bv;
    });
  }

  return { results, count };
}

export async function getCustomer(companyId: number, id: number) {
  const c = await prisma.customer.findFirst({
    where: { id, companyId },
    include: {
      sales: {
        include: { store: true, items: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
        take: DETAIL_SALES_LIMIT,
      },
      debts: { include: { sale: { include: { store: true } } } },
    },
  });
  if (!c) throw new NotFound();

  // Jami xarid — barcha sotuvlar bo'yicha (sales ro'yxati cheklangani uchun aggregate bilan)
  const purchaseAgg = await prisma.sale.aggregate({
    where: { customerId: c.id, status: { not: 'r' } },
    _sum: { totalAmount: true },
  });

  return serializeDetail(c, dec(purchaseAgg._sum.totalAmount));
}

export async function createCustomer(companyId: number, data: { full_name: string; phone_number: string }) {
  const c = await prisma.customer.create({
    data: { companyId, fullName: data.full_name, phoneNumber: data.phone_number },
  });
  return { id: c.id, full_name: c.fullName, phone_number: c.phoneNumber };
}

export async function updateCustomer(
  companyId: number,
  id: number,
  data: { full_name?: string; phone_number?: string },
) {
  const exists = await prisma.customer.findFirst({ where: { id, companyId } });
  if (!exists) throw new NotFound();
  const c = await prisma.customer.update({
    where: { id },
    data: { fullName: data.full_name, phoneNumber: data.phone_number },
  });
  return { id: c.id, full_name: c.fullName, phone_number: c.phoneNumber };
}

export async function deleteCustomer(companyId: number, id: number) {
  const exists = await prisma.customer.findFirst({ where: { id, companyId } });
  if (!exists) throw new NotFound();
  await prisma.customer.delete({ where: { id } });
}
