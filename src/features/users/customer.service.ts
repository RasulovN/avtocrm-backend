import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound } from '../../common/errors.js';
import type { PageParams } from '../../common/pagination.js';

// DRF Customer viewlari: total_purchase_amount, total_debt, store_debts, sales.

type CustomerFull = Prisma.CustomerGetPayload<{
  include: {
    sales: { include: { store: true; items: { include: { product: true } } } };
    debts: { include: { sale: { include: { store: true } } } };
  };
}>;

function dec(v: Prisma.Decimal | number): number {
  return typeof v === 'number' ? v : v.toNumber();
}

function computeTotals(c: CustomerFull) {
  // total_purchase_amount: qaytarilmagan (status != 'r') sotuvlar yig'indisi
  const totalPurchase = c.sales
    .filter((s) => s.status !== 'r')
    .reduce((acc, s) => acc + dec(s.totalAmount), 0);

  // total_debt: CustomerDebt type "i" (kirim) - "d" (kamayish)
  const totalDebt = c.debts.reduce(
    (acc, d) => acc + (d.type === 'i' ? dec(d.amount) : -dec(d.amount)),
    0,
  );

  // store_debts: do'kon bo'yicha guruhlangan qarz
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

  return { totalPurchase, totalDebt, storeDebts };
}

function serializeFull(c: CustomerFull) {
  const { totalPurchase, totalDebt, storeDebts } = computeTotals(c);
  return {
    id: c.id,
    full_name: c.fullName,
    phone_number: c.phoneNumber,
    total_purchase_amount: totalPurchase.toFixed(2),
    total_debt: totalDebt.toFixed(2),
    store_debts: storeDebts,
    sales: c.sales
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((s) => ({
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

const fullInclude = {
  sales: { include: { store: true, items: { include: { product: true } } } },
  debts: { include: { sale: { include: { store: true } } } },
} satisfies Prisma.CustomerInclude;

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

  const count = await prisma.customer.count({ where });

  // Tartiblash: total_debt / total_purchase_amount uchun annotatsiya bo'lmagani sababli
  // full_name bo'yicha DB-da, qolganlari uchun xotirada tartiblanadi.
  const dbOrder: Prisma.CustomerOrderByWithRelationInput =
    opts.ordering === 'full_name'
      ? { fullName: 'asc' }
      : opts.ordering === '-full_name'
        ? { fullName: 'desc' }
        : { fullName: 'asc' };

  const customers = await prisma.customer.findMany({
    where,
    include: fullInclude,
    orderBy: dbOrder,
    skip: opts.page.skip,
    take: opts.page.take,
  });

  let results = customers.map(serializeFull);

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
  const c = await prisma.customer.findFirst({ where: { id, companyId }, include: fullInclude });
  if (!c) throw new NotFound();
  return serializeFull(c);
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
