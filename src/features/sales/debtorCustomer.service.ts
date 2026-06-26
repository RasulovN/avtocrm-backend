import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

// ─────────────────────────────────────────────
// Django: apps/sales/services/debtor_customer_service.py
//   CustomerDebtService.get_customer_debts + format_debt_response
//
//   Qarzdor mijozlar ro'yxati. (customer_id, customer__full_name, sale__store_id)
//   bo'yicha guruhlanadi va balans = SUM(CASE type='i' -> +amount, 'd' -> -amount).
//   Faqat total_debt > 0 bo'lgan guruhlar qaytariladi.
//
//   ROLE LOGIC: superuser yoki is_sklad -> hammasi; aks holda sale.seller = user.
//   (Node User modelida `is_sklad` yo'q -> getattr(...,False) kabi har doim False.)
//
//   Faqat sale__isnull=False yozuvlar (sale'ga bog'langan qarzlar).
// ─────────────────────────────────────────────

export interface DebtorCustomerRow {
  store_id: number;
  customer_id: number;
  customer_name: string;
  total_debt: string;
}

interface DebtGroupKey {
  customerId: number;
  storeId: number;
}

function groupKey(k: DebtGroupKey): string {
  return `${k.customerId}::${k.storeId}`;
}

// Django: get_customer_debts(user) + format_debt_response — barcha qarzdor
// guruhlarni (filtrlanmagan) qaytaradi. Pagination route qatlamida qo'llanadi.
export async function getDebtorCustomers(companyId: number, user: User): Promise<DebtorCustomerRow[]> {
  const where: Prisma.CustomerDebtWhereInput = {
    companyId,
    saleId: { not: null },
  };

  // 🔐 ROLE LOGIC: superuser (yoki is_sklad — Node'da mavjud emas) hammasini ko'radi;
  // aks holda faqat o'zi sotgan sotuvlarning qarzlari.
  if (!user.isSuperuser) {
    where.sale = { sellerId: user.id };
  }

  const debts = await prisma.customerDebt.findMany({
    where,
    select: {
      amount: true,
      type: true,
      customerId: true,
      customer: { select: { fullName: true } },
      sale: { select: { storeId: true } },
    },
  });

  // (customer_id, sale.store_id) bo'yicha balans yig'amiz.
  const balances = new Map<string, Prisma.Decimal>();
  const meta = new Map<string, { customerId: number; storeId: number; name: string }>();

  for (const d of debts) {
    if (!d.sale) continue; // saleId: { not: null } kafolatlaydi, lekin TS uchun guard
    const key = groupKey({ customerId: d.customerId, storeId: d.sale.storeId });
    const delta = d.type === 'i' ? d.amount : d.amount.negated();
    balances.set(key, (balances.get(key) ?? new Prisma.Decimal(0)).plus(delta));
    if (!meta.has(key)) {
      meta.set(key, {
        customerId: d.customerId,
        storeId: d.sale.storeId,
        name: d.customer ? d.customer.fullName : '',
      });
    }
  }

  const rows: DebtorCustomerRow[] = [];
  for (const [key, balance] of balances.entries()) {
    // total_debt__gt=0
    if (balance.greaterThan(0)) {
      const m = meta.get(key)!;
      rows.push({
        store_id: m.storeId,
        customer_id: m.customerId,
        customer_name: m.name,
        total_debt: balance.toFixed(2),
      });
    }
  }

  return rows;
}
