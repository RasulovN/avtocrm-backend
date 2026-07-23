import { Prisma } from '@prisma/client';
import type { Supplier, SupplierTransaction } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound, ValidationError } from '../../common/errors.js';
import { checkValidPhone } from '../../common/validators.js';
import { mediaUrl } from '../../common/media.js';
import type { PageParams } from '../../common/pagination.js';
import type { SupplierCreateInput, SupplierUpdateInput } from './contract.schemas.js';

// ─────────────────────────────────────────────
// Serializatsiya (DRF -> snake_case javob)
// ─────────────────────────────────────────────

// SupplierGetSerializer
export function serializeSupplierGet(s: Supplier) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    address: s.address,
    phone_number: s.phoneNumber,
    inn: s.inn,
    is_active: s.isActive,
  };
}

// SupplierSerializer (detail GET) — translation maydonlari bilan
export function serializeSupplierDetail(s: Supplier) {
  return {
    id: s.id,
    name_uz: s.name,
    name_uz_cyrl: s.nameUzCyrl,
    description_uz: s.description,
    description_uz_cyrl: s.descriptionUzCyrl,
    address_uz: s.address,
    address_uz_cyrl: s.addressUzCyrl,
    phone_number: s.phoneNumber,
    inn: s.inn,
    is_active: s.isActive,
  };
}

// SupplierListSerializer (+ annotatsiyalar)
export function serializeSupplierListRow(
  s: Supplier,
  totalPurchaseAmount: string,
  totalDebt: string,
) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    address: s.address,
    phone_number: s.phoneNumber,
    inn: s.inn,
    is_active: s.isActive,
    total_purchase_amount: totalPurchaseAmount,
    total_debt: totalDebt,
  };
}

// translation maydonlarni Prisma ustunlariga map qiladi
function mapTranslatedFields(data: Partial<SupplierCreateInput>): Prisma.SupplierUncheckedUpdateInput {
  const out: Prisma.SupplierUncheckedUpdateInput = {};
  if (data.name_uz !== undefined) out.name = data.name_uz;
  if (data.name_uz_cyrl !== undefined) out.nameUzCyrl = data.name_uz_cyrl;
  if (data.description_uz !== undefined) out.description = data.description_uz;
  if (data.description_uz_cyrl !== undefined) out.descriptionUzCyrl = data.description_uz_cyrl;
  if (data.address_uz !== undefined) out.address = data.address_uz;
  if (data.address_uz_cyrl !== undefined) out.addressUzCyrl = data.address_uz_cyrl;
  if (data.phone_number !== undefined) out.phoneNumber = data.phone_number;
  if (data.inn !== undefined) out.inn = data.inn;
  return out;
}

// ─────────────────────────────────────────────
// INN validatsiyasi (SupplierCreateSerializer.validate_inn)
// ─────────────────────────────────────────────
async function validateInn(companyId: number, inn: string, excludeId?: number): Promise<void> {
  // INN noyobligi tenant (companyId) doirasida tekshiriladi (@@unique([companyId, inn])).
  const existing = await prisma.supplier.findFirst({
    where: { companyId, inn, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (existing) {
    throw new ValidationError({ inn: ['Supplier with this INN already exists'] });
  }
  if (!/^\d+$/.test(inn)) {
    throw new ValidationError({ inn: ['Incorrect INN'] });
  }
}

// ─────────────────────────────────────────────
// List (SupplierListAPIView + _supplier_queryset)
// ─────────────────────────────────────────────

// Ruxsat etilgan saralashlar (Django SupplierListAPIView bilan bir xil)
const ALLOWED_ORDERINGS = new Set(['name', '-total_purchase_amount', '-total_debt', '-created_at']);

// Bir guruh supplier uchun jami xarid va qarz map'larini hisoblaydi
async function supplierAggregates(supplierIds: number[]) {
  const purchaseMap = new Map<number, number>();
  const debtMap = new Map<number, number>();
  if (!supplierIds.length) return { purchaseMap, debtMap };

  // total_purchase_amount: StockEntry.total_amount yig'indisi (supplier bo'yicha)
  const purchaseGroups = await prisma.stockEntry.groupBy({
    by: ['supplierId'],
    where: { supplierId: { in: supplierIds } },
    _sum: { totalAmount: true },
  });
  for (const g of purchaseGroups) {
    purchaseMap.set(g.supplierId, Number(g._sum.totalAmount ?? 0));
  }

  // total_debt: SUM(in) - SUM(pay)
  const txGroups = await prisma.supplierTransaction.groupBy({
    by: ['supplierId', 'type'],
    where: { supplierId: { in: supplierIds } },
    _sum: { amount: true },
  });
  for (const g of txGroups) {
    const amount = Number(g._sum.amount ?? 0);
    const prev = debtMap.get(g.supplierId) ?? 0;
    if (g.type === 'in') debtMap.set(g.supplierId, prev + amount);
    else if (g.type === 'pay') debtMap.set(g.supplierId, prev - amount);
  }
  return { purchaseMap, debtMap };
}

export function buildSupplierWhere(opts: {
  companyId: number;
  search?: string | null;
  isActive?: string | null;
}): Prisma.SupplierWhereInput {
  // companyId scope: faqat shu tenant ta'minotchilari.
  const where: Prisma.SupplierWhereInput = { companyId: opts.companyId };
  if (opts.search) {
    where.OR = [
      { name: { contains: opts.search, mode: 'insensitive' } },
      { phoneNumber: { contains: opts.search, mode: 'insensitive' } },
      { inn: { contains: opts.search, mode: 'insensitive' } },
    ];
  }
  if (opts.isActive !== undefined && opts.isActive !== null) {
    where.isActive = opts.isActive.toLowerCase() === 'true';
  }
  return where;
}

// Filtrga mos BARCHA ta'minotchilarni annotatsiyalari bilan qaytaradi
// (has_debt / aggregate saralash / eksport uchun — pagination JS'da qilinadi).
export async function listSuppliersAnnotated(opts: {
  companyId: number;
  search?: string | null;
  isActive?: string | null;
  hasDebt?: boolean;
  ordering?: string | null;
}) {
  const where = buildSupplierWhere(opts);
  const suppliers = await prisma.supplier.findMany({ where, orderBy: { name: 'asc' } });
  const { purchaseMap, debtMap } = await supplierAggregates(suppliers.map((s) => s.id));

  let annotated = suppliers.map((s) => ({
    supplier: s,
    totalPurchase: purchaseMap.get(s.id) ?? 0,
    totalDebt: debtMap.get(s.id) ?? 0,
  }));

  if (opts.hasDebt) {
    annotated = annotated.filter((row) => row.totalDebt > 0);
  }

  const ordering = opts.ordering && ALLOWED_ORDERINGS.has(opts.ordering) ? opts.ordering : 'name';
  if (ordering === '-total_purchase_amount') {
    annotated.sort((a, b) => b.totalPurchase - a.totalPurchase);
  } else if (ordering === '-total_debt') {
    annotated.sort((a, b) => b.totalDebt - a.totalDebt);
  } else if (ordering === '-created_at') {
    annotated.sort((a, b) => b.supplier.createdAt.getTime() - a.supplier.createdAt.getTime());
  }
  // 'name' — findMany allaqachon nomi bo'yicha saralagan

  return annotated;
}

export async function listSuppliers(opts: {
  companyId: number;
  search?: string | null;
  isActive?: string | null;
  hasDebt?: boolean;
  ordering?: string | null;
  page: PageParams;
}) {
  const needsAnnotatedPath =
    opts.hasDebt || (opts.ordering && opts.ordering !== 'name' && ALLOWED_ORDERINGS.has(opts.ordering));

  if (needsAnnotatedPath) {
    // Aggregate bo'yicha saralash/filtr — barcha mos yozuvlar ustida, sahifalash JS'da
    const annotated = await listSuppliersAnnotated(opts);
    const pageRows = annotated.slice(opts.page.skip, opts.page.skip + opts.page.take);
    const results = pageRows.map((row) =>
      serializeSupplierListRow(row.supplier, row.totalPurchase.toFixed(2), row.totalDebt.toFixed(2)),
    );
    return { results, count: annotated.length };
  }

  const where = buildSupplierWhere(opts);
  const [count, suppliers] = await prisma.$transaction([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: opts.page.skip,
      take: opts.page.take,
    }),
  ]);

  const { purchaseMap, debtMap } = await supplierAggregates(suppliers.map((s) => s.id));

  const results = suppliers.map((s) => {
    const totalPurchase = (purchaseMap.get(s.id) ?? 0).toFixed(2);
    const totalDebt = (debtMap.get(s.id) ?? 0).toFixed(2);
    return serializeSupplierListRow(s, totalPurchase, totalDebt);
  });

  return { results, count };
}

// ─────────────────────────────────────────────
// Detail (get / 404)
// ─────────────────────────────────────────────
export async function getSupplierOr404(companyId: number, pk: number): Promise<Supplier> {
  // Cross-tenant himoya: boshqa company supplier'iga kirish 404 qaytaradi.
  const supplier = await prisma.supplier.findFirst({ where: { id: pk, companyId } });
  if (!supplier) throw new NotFound();
  return supplier;
}

// ─────────────────────────────────────────────
// SupplierService.create_supplier
// ─────────────────────────────────────────────
export async function createSupplier(opts: {
  companyId: number;
  requestUserIsSuperuser: boolean;
  data: SupplierCreateInput;
}): Promise<Supplier> {
  // Avtorizatsiya route'da `company.suppliers.manage` ruxsati orqali (RBAC) tekshiriladi.
  // SupplierCreateSerializer.validate(): phone tekshiruvi
  checkValidPhone(opts.data.phone_number);

  // validate_inn (inn berilgan bo'lsa) — tenant doirasida
  if (opts.data.inn !== undefined && opts.data.inn !== null) {
    await validateInn(opts.companyId, opts.data.inn);
  }

  return prisma.supplier.create({
    data: {
      companyId: opts.companyId,
      name: opts.data.name_uz,
      nameUzCyrl: opts.data.name_uz_cyrl,
      description: opts.data.description_uz,
      descriptionUzCyrl: opts.data.description_uz_cyrl,
      address: opts.data.address_uz,
      addressUzCyrl: opts.data.address_uz_cyrl,
      phoneNumber: opts.data.phone_number,
      inn: opts.data.inn ?? null,
    },
  });
}

// ─────────────────────────────────────────────
// SupplierService.update_supplier
// ─────────────────────────────────────────────
export async function updateSupplier(opts: {
  requestUserIsSuperuser: boolean;
  instance: Supplier;
  data: SupplierUpdateInput;
}): Promise<Supplier> {
  // Avtorizatsiya route'da RBAC ruxsati orqali. partial update — faqat yuborilgan maydonlar.
  // validate_inn faqat inn yuborilganda ishlaydi (instance allaqachon tenant-scope qilingan).
  if (opts.data.inn !== undefined && opts.data.inn !== null) {
    await validateInn(opts.instance.companyId, opts.data.inn, opts.instance.id);
  }
  if (opts.data.phone_number !== undefined) {
    checkValidPhone(opts.data.phone_number);
  }

  return prisma.supplier.update({
    where: { id: opts.instance.id },
    data: mapTranslatedFields(opts.data),
  });
}

// ─────────────────────────────────────────────
// SupplierService.delete_supplier
// ─────────────────────────────────────────────
export async function deleteSupplier(opts: {
  requestUserIsSuperuser: boolean;
  instance: Supplier;
}): Promise<void> {
  // Avtorizatsiya route'da RBAC ruxsati orqali.
  await prisma.supplier.delete({ where: { id: opts.instance.id } });
}

// ─────────────────────────────────────────────
// SupplierPaymentService.make_payment
// ─────────────────────────────────────────────

// SupplierPaymentListSerializer (+ bank_card_name)
export function serializeSupplierTransaction(
  t: SupplierTransaction & { bankCard?: { name: string } | null },
) {
  return {
    id: t.id,
    supplier: t.supplierId,
    entry: t.entryId,
    amount: Number(t.amount).toFixed(2),
    type: t.type,
    payment_method: t.paymentMethod ?? '',
    bank_card: t.bankCardId ?? null,
    bank_card_name: t.bankCard?.name ?? null,
    note: t.note,
    created_at: t.createdAt,
  };
}

export async function listEntryTransactions(companyId: number, entryId: number) {
  // get_object_or_404(StockEntry, pk=entry_id) — tenant doirasida (cross-tenant 404).
  const entry = await prisma.stockEntry.findFirst({
    where: { id: entryId, companyId },
    select: { id: true },
  });
  if (!entry) throw new NotFound();

  const transactions = await prisma.supplierTransaction.findMany({
    where: { entryId, companyId },
    include: { bankCard: { select: { name: true } } },
  });
  return transactions.map(serializeSupplierTransaction);
}

// Django SupplierPaymentService.make_payments ekvivalenti:
// bitta so'rovda bir nechta usul bilan qarz to'lash (split) — har usul alohida
// SupplierTransaction (pay) qatori bo'lib yoziladi. Qoldiq qarz tekshiruvi
// entry qulfi ostida jami summa bo'yicha bajariladi.
export async function makePayments(opts: {
  companyId: number;
  supplierId: number;
  entryId: number;
  payments: Array<{ type: 'cash' | 'card'; amount: string; bank_card?: number | null }>;
  note?: string;
  userFullName: string | null;
}): Promise<SupplierTransaction[]> {
  const rows = opts.payments.filter((p) => Number(p.amount) > 0);
  if (rows.length === 0) {
    throw new ValidationError({ payments: ["To'lov qatorlari bo'sh"] });
  }
  const total = rows.reduce((sum, p) => sum + Number(p.amount), 0);

  const supplier = await prisma.supplier.findFirst({
    where: { id: opts.supplierId, companyId: opts.companyId, isActive: true },
    select: { id: true },
  });
  if (!supplier) {
    throw new ValidationError({ supplier: ['Invalid pk - object does not exist.'] });
  }

  const entry = await prisma.stockEntry.findFirst({
    where: { id: opts.entryId, companyId: opts.companyId },
    select: { id: true, supplierId: true },
  });
  if (!entry) {
    throw new ValidationError({ entry: ['Invalid pk - object does not exist.'] });
  }

  if (entry.supplierId !== opts.supplierId) {
    throw new ValidationError({ detail: 'Entry supplierga tegishli emas' });
  }

  // Karta qatorlari — faol va kirim uchun ruxsat etilgan (scope purchase/both)
  // PaymentMethod bo'lishi shart
  const cardIds = [
    ...new Set(
      rows.filter((p) => p.type === 'card' && p.bank_card).map((p) => p.bank_card as number),
    ),
  ];
  if (cardIds.length > 0) {
    const found = await prisma.paymentMethod.findMany({
      where: { id: { in: cardIds }, isActive: true, scope: { in: ['purchase', 'both'] } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((c) => c.id));
    for (const id of cardIds) {
      if (!foundIds.has(id)) {
        throw new ValidationError({ bank_card: ["Karta to'lovi uchun to'lov turini (kartani) tanlang"] });
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    // 🔴 LOCK ENTRY — bir vaqtda ikkita to'lov qoldiqdan oshib ketmasligi uchun
    // (tekshiruv va yozish bitta tranzaksiyada, Django select_for_update kabi)
    await tx.$queryRaw(
      Prisma.sql`SELECT id FROM stock_entry WHERE id = ${opts.entryId} FOR UPDATE`,
    );

    // Qoldiq qarz: kirim (in) - to'langan (pay)
    const sums = await tx.supplierTransaction.groupBy({
      by: ['type'],
      where: { entryId: opts.entryId },
      _sum: { amount: true },
    });
    let totalIn = 0;
    let totalPaid = 0;
    for (const g of sums) {
      const amount = Number(g._sum.amount ?? 0);
      if (g.type === 'in') totalIn = amount;
      else if (g.type === 'pay') totalPaid = amount;
    }
    const remaining = totalIn - totalPaid;
    if (remaining <= 0) {
      throw new ValidationError({ amount: ["Bu xarid bo'yicha qarz yo'q"] });
    }
    if (total > remaining + 0.005) {
      throw new ValidationError({
        amount: [`To'lov qoldiq qarzdan oshib ketdi. Qoldiq qarz: ${remaining.toFixed(2)}`],
      });
    }

    const bankCardNames = new Map<number, string>();
    if (cardIds.length > 0) {
      const cards = await tx.paymentMethod.findMany({
        where: { id: { in: cardIds } },
        select: { id: true, name: true },
      });
      for (const c of cards) bankCardNames.set(c.id, c.name);
    }

    const transactions: SupplierTransaction[] = [];
    for (const p of rows) {
      const bankCardId = p.type === 'card' ? (p.bank_card ?? null) : null;
      // To'lov usuli izoh uchun: "naqd" yoki karta nomi (Uzcard/Humo/...)
      const methodLabel = bankCardId ? (bankCardNames.get(bankCardId) ?? 'karta') : 'naqd';
      transactions.push(
        await tx.supplierTransaction.create({
          data: {
            companyId: opts.companyId,
            supplierId: opts.supplierId,
            entryId: opts.entryId,
            amount: Number(p.amount).toFixed(2),
            type: 'pay',
            paymentMethod: p.type,
            bankCardId,
            note:
              opts.note ||
              `Taminotchiga to'lov (${methodLabel}). Mas'ul: ${opts.userFullName ?? ''}`,
          },
        }),
      );
    }
    return transactions;
  });
}

// Eski (bitta usulli) interfeys — ichkarida split servisga o'tkazadi
export async function makePayment(opts: {
  companyId: number;
  supplierId: number;
  entryId: number;
  amount: string;
  note?: string;
  paymentType?: 'cash' | 'card';
  bankCardId?: number | null;
  userFullName: string | null;
}): Promise<SupplierTransaction> {
  const paymentType = opts.paymentType ?? 'cash';
  if (paymentType === 'card' && !opts.bankCardId) {
    throw new ValidationError({ bank_card: ["Karta to'lovi uchun to'lov turini (kartani) tanlang"] });
  }
  const transactions = await makePayments({
    companyId: opts.companyId,
    supplierId: opts.supplierId,
    entryId: opts.entryId,
    payments: [
      { type: paymentType, amount: opts.amount, bank_card: paymentType === 'card' ? opts.bankCardId : null },
    ],
    note: opts.note,
    userFullName: opts.userFullName,
  });
  return transactions[0];
}

// ─────────────────────────────────────────────
// SupplierStatsAPIView — detail sahifa dashboardi uchun jamlanma
// ─────────────────────────────────────────────
export async function getSupplierStats(companyId: number, supplierId: number) {
  const supplier = await getSupplierOr404(companyId, supplierId);

  // Eslatma: SupplierTransaction "in" yozuvi faqat QARZ qismini saqlaydi
  // (kirim paytida darhol to'langani paid_amount'da). Shuning uchun:
  //   kirim holati:  qarz = total_in(txn) - total_paid(txn),
  //   to'langan pul = paid_amount + total_paid(txn)
  const entries = await prisma.stockEntry.findMany({
    where: { supplierId: supplier.id, companyId },
    select: { id: true, paidAmount: true, totalAmount: true, createdAt: true },
  });

  const txGroups = entries.length
    ? await prisma.supplierTransaction.groupBy({
        by: ['entryId', 'type'],
        where: { supplierId: supplier.id, companyId },
        _sum: { amount: true },
      })
    : [];
  const totalInByEntry = new Map<number, number>();
  const totalPaidByEntry = new Map<number, number>();
  for (const g of txGroups) {
    if (g.entryId == null) continue;
    const amount = Number(g._sum.amount ?? 0);
    if (g.type === 'in') totalInByEntry.set(g.entryId, amount);
    else if (g.type === 'pay') totalPaidByEntry.set(g.entryId, amount);
  }

  let paidCount = 0;
  let partialCount = 0;
  let unpaidCount = 0;
  let purchaseSum = 0;
  let paidAtEntrySum = 0;
  let firstEntryAt: Date | null = null;
  let lastEntryAt: Date | null = null;

  for (const entry of entries) {
    const txnIn = totalInByEntry.get(entry.id) ?? 0;
    const txnPaid = totalPaidByEntry.get(entry.id) ?? 0;
    const paidAtEntry = Number(entry.paidAmount ?? 0);
    purchaseSum += Number(entry.totalAmount ?? 0);
    paidAtEntrySum += paidAtEntry;

    const entryDebt = txnIn - txnPaid;
    if (entryDebt <= 0) paidCount += 1;
    else if (paidAtEntry + txnPaid <= 0) unpaidCount += 1;
    else partialCount += 1;

    if (!firstEntryAt || entry.createdAt < firstEntryAt) firstEntryAt = entry.createdAt;
    if (!lastEntryAt || entry.createdAt > lastEntryAt) lastEntryAt = entry.createdAt;
  }

  // Umumiy in/pay yig'indilari (entry'siz tranzaksiyalar ham kiradi)
  const totals = await prisma.supplierTransaction.groupBy({
    by: ['type'],
    where: { supplierId: supplier.id, companyId },
    _sum: { amount: true },
  });
  let txnInTotal = 0;
  let txnPaidTotal = 0;
  for (const g of totals) {
    if (g.type === 'in') txnInTotal = Number(g._sum.amount ?? 0);
    else if (g.type === 'pay') txnPaidTotal = Number(g._sum.amount ?? 0);
  }

  // Jami to'langan = kirim paytidagi to'lovlar + keyingi qarz to'lovlari
  const totalPaid = paidAtEntrySum + txnPaidTotal;
  const debt = txnInTotal - txnPaidTotal;

  const itemsAgg = await prisma.stockEntryItem.aggregate({
    where: { entry: { supplierId: supplier.id, companyId } },
    _sum: { quantity: true },
  });
  const itemsTotal = itemsAgg._sum.quantity ?? 0;

  // Kirimlar chastotasi: birinchi kirimdan hozirgacha oyiga o'rtacha nechta kirim
  let ordersPerMonth = 0;
  if (entries.length && firstEntryAt) {
    const days = (Date.now() - firstEntryAt.getTime()) / 86_400_000;
    const months = Math.max(days / 30.44, 1);
    ordersPerMonth = Math.round((entries.length / months) * 10) / 10;
  }

  return {
    supplier_id: supplier.id,
    created_at: supplier.createdAt,
    entries_count: entries.length,
    paid_entries_count: paidCount,
    partial_entries_count: partialCount,
    unpaid_entries_count: unpaidCount,
    total_purchase_amount: purchaseSum.toFixed(2),
    total_paid_amount: totalPaid.toFixed(2),
    total_debt: (debt > 0 ? debt : 0).toFixed(2),
    // Balans: qarzdan ortiqcha to'langan summa (avans)
    balance: (debt < 0 ? -debt : 0).toFixed(2),
    items_total_quantity: itemsTotal,
    orders_per_month: ordersPerMonth,
    first_entry_at: firstEntryAt,
    last_entry_at: lastEntryAt,
  };
}

// ─────────────────────────────────────────────
// SupplierPaymentsBySupplierAPIView — ta'minotchining barcha to'lovlari
// ─────────────────────────────────────────────
export async function listSupplierPayments(opts: {
  companyId: number;
  supplierId: number;
  page: PageParams;
}) {
  await getSupplierOr404(opts.companyId, opts.supplierId);

  const where: Prisma.SupplierTransactionWhereInput = {
    companyId: opts.companyId,
    supplierId: opts.supplierId,
    type: 'pay',
  };

  const [count, transactions] = await prisma.$transaction([
    prisma.supplierTransaction.count({ where }),
    prisma.supplierTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: opts.page.skip,
      take: opts.page.take,
      include: { bankCard: { select: { name: true } } },
    }),
  ]);

  return { results: transactions.map(serializeSupplierTransaction), count };
}

// ─────────────────────────────────────────────
// SupplierProductsAPIView — ta'minotchidan kelgan tovarlar (jamlangan)
// ─────────────────────────────────────────────
export async function listSupplierProducts(opts: {
  companyId: number;
  supplierId: number;
  search?: string | null;
  page: PageParams;
}) {
  await getSupplierOr404(opts.companyId, opts.supplierId);

  // Ta'minotchi kirimlaridagi barcha itemlar — product bo'yicha JS'da jamlanadi
  // (Prisma groupBy distinct-count'ni qo'llamaydi; hajm kichik — muammo emas).
  const itemWhere: Prisma.StockEntryItemWhereInput = {
    entry: { supplierId: opts.supplierId, companyId: opts.companyId },
  };
  if (opts.search) {
    itemWhere.product = {
      OR: [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { sku: { contains: opts.search, mode: 'insensitive' } },
        { barcode: { contains: opts.search, mode: 'insensitive' } },
      ],
    };
  }

  const items = await prisma.stockEntryItem.findMany({
    where: itemWhere,
    select: {
      id: true,
      productId: true,
      entryId: true,
      quantity: true,
      purchasePrice: true,
      sellingPrice: true,
      entry: { select: { createdAt: true } },
    },
  });

  interface ProductAgg {
    productId: number;
    totalQuantity: number;
    entryIds: Set<number>;
    lastEntryAt: Date | null;
    lastItemId: number;
    lastPurchasePrice: string;
    lastSellingPrice: string;
  }
  const byProduct = new Map<number, ProductAgg>();
  for (const item of items) {
    const createdAt = item.entry?.createdAt ?? null;
    let agg = byProduct.get(item.productId);
    if (!agg) {
      agg = {
        productId: item.productId,
        totalQuantity: 0,
        entryIds: new Set(),
        lastEntryAt: null,
        lastItemId: -1,
        lastPurchasePrice: '0',
        lastSellingPrice: '0',
      };
      byProduct.set(item.productId, agg);
    }
    agg.totalQuantity += item.quantity;
    agg.entryIds.add(item.entryId);
    // Oxirgi kirimdagi narxlar: eng yangi entry.createdAt, teng bo'lsa kattaroq item id
    const isNewer =
      !agg.lastEntryAt ||
      (createdAt !== null &&
        (createdAt > agg.lastEntryAt ||
          (createdAt.getTime() === agg.lastEntryAt.getTime() && item.id > agg.lastItemId)));
    if (isNewer && createdAt !== null) {
      agg.lastEntryAt = createdAt;
      agg.lastItemId = item.id;
      agg.lastPurchasePrice = Number(item.purchasePrice).toFixed(2);
      agg.lastSellingPrice = Number(item.sellingPrice).toFixed(2);
    }
  }

  const sorted = Array.from(byProduct.values()).sort((a, b) => {
    const at = a.lastEntryAt?.getTime() ?? 0;
    const bt = b.lastEntryAt?.getTime() ?? 0;
    return bt - at;
  });

  const count = sorted.length;
  const pageRows = sorted.slice(opts.page.skip, opts.page.skip + opts.page.take);

  // Faqat sahifadagi productlar uchun nom/sku/kategoriya/rasm
  const products = pageRows.length
    ? await prisma.product.findMany({
        where: { id: { in: pageRows.map((r) => r.productId) } },
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          category: { select: { name: true } },
          images: { select: { image: true }, orderBy: { id: 'asc' }, take: 1 },
        },
      })
    : [];
  const productMap = new Map(products.map((p) => [p.id, p]));

  const results = pageRows.map((row) => {
    const product = productMap.get(row.productId);
    return {
      product: row.productId,
      product_name: product?.name ?? null,
      sku: product?.sku ?? null,
      barcode: product?.barcode ?? null,
      category_name: product?.category?.name ?? null,
      total_quantity: row.totalQuantity,
      entries_count: row.entryIds.size,
      last_entry_at: row.lastEntryAt,
      last_purchase_price: row.lastPurchasePrice,
      last_selling_price: row.lastSellingPrice,
      image: mediaUrl(product?.images[0]?.image ?? null),
    };
  });

  return { results, count };
}
