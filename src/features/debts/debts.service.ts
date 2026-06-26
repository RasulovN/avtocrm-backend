import { Prisma } from '@prisma/client';
import type { CustomerDebt, Customer, Sale, Payment } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound, ValidationError } from '../../common/errors.js';
import type { PayDebtInput } from './debts.schemas.js';

// ── Yordamchilar ──────────────────────────────────────────

// Decimal -> string ("0.00" formatida). DRF DecimalField kabi.
function decimalToString(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

// ── Serializatsiya ────────────────────────────────────────

type CustomerDebtWithCustomer = CustomerDebt & { customer: Customer | null };

// Django (intended) CustomerDebtListSerializer:
//   fields = ("id", "sale", "customer", "customer_name", "amount", "type", "created_at")
//   customer_name = customer.full_name
//
// IZOH: Django views.py/serializers.py'da PayDebtListSerializer Meta.model = `Payment`
// bo'lib qo'yilgan (KRITIK bug, fayl ichida o'zi belgilab ketgan). Ammo view AYNAN
// `CustomerDebt` querysetini uzatadi va field nomlari CustomerDebt bilan mos keladi.
// Shu sababli bu yerda haqiqiy domen modeli — CustomerDebt — serializatsiya qilinadi.
function serializeCustomerDebt(debt: CustomerDebtWithCustomer) {
  return {
    id: debt.id,
    sale: debt.saleId,
    customer: debt.customerId,
    customer_name: debt.customer ? debt.customer.fullName : '',
    amount: decimalToString(debt.amount),
    type: debt.type,
    created_at: debt.createdAt,
  };
}

const customerInclude = {
  customer: true,
} satisfies Prisma.CustomerDebtInclude;

// ── Selectorlar (views) ───────────────────────────────────

// Django PayDebtListAPIView.get -> CustomerDebt ro'yxati.
// Django'da pagination yo'q — barcha yozuvlar qaytariladi (faithful port).
export async function listCustomerDebts(companyId: number) {
  const debts = await prisma.customerDebt.findMany({
    where: { companyId },
    include: customerInclude,
    orderBy: { createdAt: 'desc' },
  });
  return (debts as CustomerDebtWithCustomer[]).map(serializeCustomerDebt);
}

// Django PayDebtDetailAPIView.get -> get_object_or_404(CustomerDebt, pk=pk)
export async function getCustomerDebt(companyId: number, pk: number) {
  const debt = await prisma.customerDebt.findFirst({
    where: { id: pk, companyId },
    include: customerInclude,
  });
  if (!debt) throw new NotFound();
  return serializeCustomerDebt(debt as CustomerDebtWithCustomer);
}

// ── Qarz hisoblash mantig'i (DebtService) ─────────────────

// Django DebtService.get_sale_debt:
//   increases = SUM(amount) WHERE type = INCREASE ("i")
//   decreases = SUM(amount) WHERE type = DECREASE ("d")
//   return increases - decreases
// Prisma.Decimal bilan aniq hisob-kitob (float emas).
async function getSaleDebt(
  tx: Prisma.TransactionClient,
  saleId: number,
): Promise<Prisma.Decimal> {
  const increases = await tx.customerDebt.aggregate({
    where: { saleId, type: 'i' },
    _sum: { amount: true },
  });
  const decreases = await tx.customerDebt.aggregate({
    where: { saleId, type: 'd' },
    _sum: { amount: true },
  });

  const inc = increases._sum.amount ?? new Prisma.Decimal(0);
  const dec = decreases._sum.amount ?? new Prisma.Decimal(0);
  return inc.minus(dec);
}

// Django DebtService.pay_debt (@transaction.atomic):
//   - Sale'ni select_for_update bilan qulflash
//   - amount <= 0  -> "Miqdor ijobiy bo'lishi kerak"
//   - current_debt <= 0 -> "Bu sotuvda qarz yo'q"
//   - amount > current_debt -> "Miqdor qarzdan oshib ketdi"
//   - Payment yaratish (customer=sale.customer, amount, type=payment_type, sale)
//   - CustomerDebt yaratish (type = DECREASE "d", sale, customer)
//   - return payment
export async function payDebt(companyId: number, input: PayDebtInput): Promise<Payment> {
  const amount = new Prisma.Decimal(input.amount);

  return prisma.$transaction(async (tx) => {
    // 🔴 LOCK SALE (Django: Sale.objects.select_for_update().get(id=sale_id))
    // Tenant scope: faqat shu company'ning sotuvi. Topilmasa -> 404.
    const locked = await tx.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`SELECT id FROM sales_sale WHERE id = ${input.sale} AND company_id = ${companyId} FOR UPDATE`,
    );
    if (locked.length === 0) {
      throw new NotFound();
    }

    const sale = (await tx.sale.findFirst({ where: { id: input.sale, companyId } })) as Sale;

    if (amount.lessThanOrEqualTo(0)) {
      throw new ValidationError({ message: "Miqdor ijobiy bo'lishi kerak" });
    }

    const currentDebt = await getSaleDebt(tx, sale.id);

    if (currentDebt.lessThanOrEqualTo(0)) {
      throw new ValidationError({ message: "Bu sotuvda qarz yo'q" });
    }

    if (amount.greaterThan(currentDebt)) {
      throw new ValidationError({ message: 'Miqdor qarzdan oshib ketdi' });
    }

    // 🔴 PAYMENT
    const payment = await tx.payment.create({
      data: {
        companyId,
        customerId: sale.customerId,
        amount,
        type: input.type,
        saleId: sale.id,
      },
    });

    // 🔴 DEBT REDUCE (SALE BILAN) — type = DECREASE ("d")
    await tx.customerDebt.create({
      data: {
        companyId,
        customerId: sale.customerId!,
        saleId: sale.id,
        amount,
        type: 'd',
      },
    });

    return payment;
  });
}

// Django DebtService.increase_debt (@transaction.atomic):
//   - customer majburiy -> "Customer bo'lishi kerak"
//   - amount > 0 -> "Amount > 0 bo'lishi kerak"
//   - CustomerDebt yaratish (type = INCREASE "i", due_date)
// IZOH: urls.py'da endpoint sifatida ulanmagan; boshqa modullar (sales) ichki chaqirishi uchun.
export async function increaseDebt(params: {
  companyId: number;
  customerId: number | null | undefined;
  saleId: number | null;
  amount: Prisma.Decimal | string | number;
  dueDate?: Date | null;
}): Promise<CustomerDebt> {
  const amount = new Prisma.Decimal(params.amount);
  if (!params.customerId) {
    throw new ValidationError({ message: "Customer bo'lishi kerak" });
  }
  if (amount.lessThanOrEqualTo(0)) {
    throw new ValidationError({ message: 'Amount > 0 bo‘lishi kerak' });
  }
  return prisma.customerDebt.create({
    data: {
      companyId: params.companyId,
      customerId: params.customerId,
      saleId: params.saleId,
      amount,
      type: 'i',
      dueDate: params.dueDate ?? null,
    },
  });
}

// Django DebtService.decrease_debt (@transaction.atomic):
//   - customer majburiy -> "Customer bo‘lishi kerak"
//   - amount > 0 -> "Amount > 0 bo‘lishi kerak"
//   - CustomerDebt yaratish (type = DECREASE "d")
// IZOH: urls.py'da endpoint sifatida ulanmagan; ichki chaqirish uchun.
export async function decreaseDebt(params: {
  companyId: number;
  customerId: number | null | undefined;
  saleId: number | null;
  amount: Prisma.Decimal | string | number;
}): Promise<CustomerDebt> {
  const amount = new Prisma.Decimal(params.amount);
  if (!params.customerId) {
    throw new ValidationError({ message: 'Customer bo‘lishi kerak' });
  }
  if (amount.lessThanOrEqualTo(0)) {
    throw new ValidationError({ message: 'Amount > 0 bo‘lishi kerak' });
  }
  return prisma.customerDebt.create({
    data: {
      companyId: params.companyId,
      customerId: params.customerId,
      saleId: params.saleId,
      amount,
      type: 'd',
    },
  });
}

// Django CustomerDebtService.get(store_ids):
//   Mijoz bo'yicha qarz balansi. Django'dagi `Sum("amount")` type farqini hisobga
//   olmaydi (KRITIK bug, fayl o'zi belgilab ketgan). To'g'ri domen mantig'i:
//   increase ("i") qo'shiladi, decrease ("d") ayriladi.
// IZOH: urls.py'da endpoint sifatida ulanmagan; hisobotlar uchun yordamchi.
export async function getCustomerDebtBalances(storeIds?: number[]) {
  const where: Prisma.CustomerDebtWhereInput = {};
  if (storeIds && storeIds.length > 0) {
    where.sale = { storeId: { in: storeIds } };
  }

  const debts = await prisma.customerDebt.findMany({
    where,
    include: { customer: true },
  });

  const balances = new Map<string, Prisma.Decimal>();
  for (const d of debts) {
    const name = d.customer ? d.customer.fullName : '';
    const delta = d.type === 'i' ? d.amount : d.amount.negated();
    balances.set(name, (balances.get(name) ?? new Prisma.Decimal(0)).plus(delta));
  }

  return [...balances.entries()].map(([customer__full_name, debt]) => ({
    customer__full_name,
    debt: decimalToString(debt),
  }));
}
