import { Prisma } from '@prisma/client';
import type { CustomerDebt, Customer, Sale, Payment } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound, ValidationError } from '../../common/errors.js';
import type { PayDebtBulkInput, PayDebtInput } from './debts.schemas.js';

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

// Django DebtService._normalize_payment_chunks ekvivalenti:
// split (payments ro'yxati) yoki eski bitta usulli argumentlarni yagona shaklga
// keltiradi. Har bir karta qatorining method'i faol va sotuv uchun ruxsat etilgan
// (scope sale/both) PaymentMethod bo'lishi shart. Naqd qatorida kanal saqlanmaydi.
interface DebtChunk {
  type: 'cash' | 'card';
  amount: Prisma.Decimal;
  methodId: number | null;
}

async function normalizeChunks(
  tx: Prisma.TransactionClient,
  input: {
    amount?: string;
    type?: 'cash' | 'card';
    method?: number | null;
    payments?: Array<{ type: 'cash' | 'card'; amount: string; method: number | null }>;
  },
): Promise<DebtChunk[]> {
  let chunks: DebtChunk[];
  if (input.payments && input.payments.length > 0) {
    chunks = input.payments
      .filter((p) => Number(p.amount) > 0)
      .map((p) => ({
        type: p.type,
        amount: new Prisma.Decimal(p.amount),
        methodId: p.type === 'card' ? (p.method ?? null) : null,
      }));
  } else if (input.amount !== undefined) {
    const type = input.type ?? 'cash';
    chunks = [
      {
        type,
        amount: new Prisma.Decimal(input.amount),
        methodId: type === 'card' ? (input.method ?? null) : null,
      },
    ];
  } else {
    chunks = [];
  }

  if (chunks.length === 0) {
    throw new ValidationError({ message: "To'lov qatorlari bo'sh" });
  }

  const methodIds = [...new Set(chunks.map((c) => c.methodId).filter((m): m is number => m != null))];
  if (methodIds.length > 0) {
    const valid = await tx.paymentMethod.findMany({
      where: { id: { in: methodIds }, isActive: true, scope: { in: ['sale', 'both'] } },
      select: { id: true },
    });
    const validIds = new Set(valid.map((m) => m.id));
    for (const id of methodIds) {
      if (!validIds.has(id)) {
        throw new ValidationError({ message: "Tanlangan to'lov turi mavjud emas yoki nofaol" });
      }
    }
  }

  return chunks;
}

function chunksTotal(chunks: DebtChunk[]): Prisma.Decimal {
  return chunks.reduce((sum, c) => sum.plus(c.amount), new Prisma.Decimal(0));
}

// Qarz to'lovi sale holatini ham yangilaydi: paid_amount oshadi, to'liq yopilsa
// status 'paid', qisman bo'lsa 'partial'. (Mijoz modali va ro'yxatlar
// total_amount - paid_amount dan qarzni hisoblaydi — sinxron bo'lishi shart.)
// Har bir split qator uchun alohida Payment yoziladi — qaysi kartadan qancha
// to'langani tarixda qoladi; CustomerDebt DECREASE esa jami summa bilan bitta.
async function applySalePayment(
  tx: Prisma.TransactionClient,
  params: {
    companyId: number;
    sale: Sale;
    chunks: DebtChunk[];
  },
): Promise<Payment[]> {
  const { companyId, sale, chunks } = params;
  const total = chunksTotal(chunks);

  // 🔴 PAYMENTS — har split qator alohida yozuv
  const payments: Payment[] = [];
  for (const chunk of chunks) {
    payments.push(
      await tx.payment.create({
        data: {
          companyId,
          customerId: sale.customerId,
          amount: chunk.amount,
          type: chunk.type,
          methodId: chunk.methodId,
          saleId: sale.id,
        },
      }),
    );
  }

  // 🔴 DEBT REDUCE (SALE BILAN) — type = DECREASE ("d"), jami summa
  await tx.customerDebt.create({
    data: {
      companyId,
      customerId: sale.customerId!,
      saleId: sale.id,
      amount: total,
      type: 'd',
    },
  });

  // 🔴 SALE STATUS/PAID: qolgan qarzga qarab yangilanadi
  const remainingDebt = await getSaleDebt(tx, sale.id);
  await tx.sale.update({
    where: { id: sale.id },
    data: {
      paidAmount: { increment: total },
      status: remainingDebt.lessThanOrEqualTo(0) ? 'paid' : 'partial',
    },
  });

  return payments;
}

export interface PayDebtResult {
  payments: Payment[];
  total: Prisma.Decimal;
}

export async function payDebt(companyId: number, input: PayDebtInput): Promise<PayDebtResult> {
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

    const chunks = await normalizeChunks(tx, input);
    const total = chunksTotal(chunks);

    if (total.lessThanOrEqualTo(0)) {
      throw new ValidationError({ message: "Miqdor ijobiy bo'lishi kerak" });
    }

    const currentDebt = await getSaleDebt(tx, sale.id);

    if (currentDebt.lessThanOrEqualTo(0)) {
      throw new ValidationError({ message: "Bu sotuvda qarz yo'q" });
    }

    if (total.greaterThan(currentDebt)) {
      throw new ValidationError({ message: 'Miqdor qarzdan oshib ketdi' });
    }

    const payments = await applySalePayment(tx, { companyId, sale, chunks });
    return { payments, total };
  });
}

// ── Bulk qarz to'lash (FIFO) ──────────────────────────────
//
// Bir mijozning bir nechta qarzli sotuvini bitta summa bilan yopish.
// Taqsimlash FIFO: eng eski (created_at) sotuvdan boshlab — har biriga
// qarzi to'lguncha, qolgani keyingisiga o'tadi. Har sotuv uchun alohida
// Payment + CustomerDebt('d') yoziladi — qachon/qancha to'langani logda qoladi.
export interface PayDebtBulkResult {
  total_paid: string;
  payments: Array<{ sale: number; amount: string; payment_id: number; remaining_debt: string }>;
}

export async function payDebtBulk(
  companyId: number,
  input: PayDebtBulkInput,
): Promise<PayDebtBulkResult> {
  return prisma.$transaction(async (tx) => {
    // Mijoz tenant doirasida mavjudligini tekshiramiz
    const customer = await tx.customer.findFirst({
      where: { id: input.customer, companyId },
    });
    if (!customer) throw new NotFound();

    // Split (payments[]) yoki eski bitta usulli argumentlar — yagona chunks shakli
    const chunks = await normalizeChunks(tx, input);
    const totalAmount = chunksTotal(chunks);
    if (totalAmount.lessThanOrEqualTo(0)) {
      throw new ValidationError({ message: "Miqdor ijobiy bo'lishi kerak" });
    }

    // 🔴 LOCK: mijozning (tanlangan) sotuvlarini FIFO tartibida qulflaymiz —
    // parallel to'lovlar bir qarzni ikki marta yopib qo'ymasligi uchun.
    const lockedRows = input.sales?.length
      ? await tx.$queryRaw<Array<{ id: number }>>(
          Prisma.sql`SELECT id FROM sales_sale
                     WHERE company_id = ${companyId} AND customer_id = ${customer.id}
                       AND id IN (${Prisma.join(input.sales)})
                     ORDER BY created_at ASC, id ASC FOR UPDATE`,
        )
      : await tx.$queryRaw<Array<{ id: number }>>(
          Prisma.sql`SELECT id FROM sales_sale
                     WHERE company_id = ${companyId} AND customer_id = ${customer.id}
                     ORDER BY created_at ASC, id ASC FOR UPDATE`,
        );

    if (input.sales?.length && lockedRows.length !== input.sales.length) {
      throw new ValidationError({ message: "Tanlangan sotuvlar mijozga tegishli emas yoki topilmadi" });
    }
    if (lockedRows.length === 0) {
      throw new ValidationError({ message: "Mijozda sotuvlar topilmadi" });
    }

    // Har sotuvning joriy qarzini hisoblaymiz (FIFO tartib saqlangan)
    const debtSales: Array<{ sale: Sale; debt: Prisma.Decimal }> = [];
    let totalDebt = new Prisma.Decimal(0);
    for (const row of lockedRows) {
      const sale = (await tx.sale.findFirst({ where: { id: row.id, companyId } })) as Sale;
      const debt = await getSaleDebt(tx, sale.id);
      if (debt.greaterThan(0)) {
        debtSales.push({ sale, debt });
        totalDebt = totalDebt.plus(debt);
      }
    }

    if (debtSales.length === 0) {
      throw new ValidationError({ message: "Tanlangan sotuvlarda qarz yo'q" });
    }
    if (totalAmount.greaterThan(totalDebt)) {
      throw new ValidationError({
        message: 'Miqdor qarzdan oshib ketdi',
        total_debt: totalDebt.toFixed(2),
        attempted: totalAmount.toFixed(2),
      });
    }

    // 🔴 FIFO taqsimlash: eng eski sotuvdan boshlab. Split rejimda chunklar
    // "hovuz" sifatida navbat bilan ishlatiladi (Django pay_customer_debt kabi) —
    // umumiy naqd/karta yig'indilari foydalanuvchi kiritganiga aynan teng bo'ladi,
    // har sotuvda esa qaysi usuldan qancha to'langani Payment qatorlarida qoladi.
    const pools = chunks.map((c) => ({ ...c }));
    let poolIdx = 0;

    const results: PayDebtBulkResult['payments'] = [];
    let remaining = totalAmount;
    for (const { sale, debt } of debtSales) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const alloc = Prisma.Decimal.min(remaining, debt);

      // Shu sotuv uchun hovuzlardan chunklar yig'iladi
      const saleChunks: DebtChunk[] = [];
      let need = alloc;
      while (need.greaterThan(0) && poolIdx < pools.length) {
        const pool = pools[poolIdx];
        const take = Prisma.Decimal.min(pool.amount, need);
        if (take.greaterThan(0)) {
          saleChunks.push({ type: pool.type, amount: take, methodId: pool.methodId });
          pool.amount = pool.amount.minus(take);
          need = need.minus(take);
        }
        if (pool.amount.lessThanOrEqualTo(0)) poolIdx += 1;
      }

      const created = await applySalePayment(tx, { companyId, sale, chunks: saleChunks });
      remaining = remaining.minus(alloc);
      results.push({
        sale: sale.id,
        amount: alloc.toFixed(2),
        payment_id: created[0].id,
        remaining_debt: debt.minus(alloc).toFixed(2),
      });
    }

    return { total_paid: totalAmount.toFixed(2), payments: results };
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
