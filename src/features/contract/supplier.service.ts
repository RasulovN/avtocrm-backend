import type { Prisma, Supplier, SupplierTransaction } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound, ValidationError } from '../../common/errors.js';
import { checkValidPhone } from '../../common/validators.js';
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
export async function listSuppliers(opts: {
  companyId: number;
  search?: string | null;
  isActive?: string | null;
  page: PageParams;
}) {
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

  const [count, suppliers] = await prisma.$transaction([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: opts.page.skip,
      take: opts.page.take,
    }),
  ]);

  const supplierIds = suppliers.map((s) => s.id);

  // total_purchase_amount: StockEntry.total_amount yig'indisi (supplier bo'yicha)
  const purchaseGroups = supplierIds.length
    ? await prisma.stockEntry.groupBy({
        by: ['supplierId'],
        where: { supplierId: { in: supplierIds } },
        _sum: { totalAmount: true },
      })
    : [];
  const purchaseMap = new Map<number, string>();
  for (const g of purchaseGroups) {
    purchaseMap.set(g.supplierId, (g._sum.totalAmount ?? 0).toString());
  }

  // total_debt: SUM(in) - SUM(pay)
  const txGroups = supplierIds.length
    ? await prisma.supplierTransaction.groupBy({
        by: ['supplierId', 'type'],
        where: { supplierId: { in: supplierIds } },
        _sum: { amount: true },
      })
    : [];
  const debtIn = new Map<number, number>();
  const debtPaid = new Map<number, number>();
  for (const g of txGroups) {
    const amount = Number(g._sum.amount ?? 0);
    if (g.type === 'in') debtIn.set(g.supplierId, amount);
    else if (g.type === 'pay') debtPaid.set(g.supplierId, amount);
  }

  const results = suppliers.map((s) => {
    const totalPurchase = Number(purchaseMap.get(s.id) ?? 0).toFixed(2);
    const totalDebt = ((debtIn.get(s.id) ?? 0) - (debtPaid.get(s.id) ?? 0)).toFixed(2);
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

// SupplierPaymentListSerializer
export function serializeSupplierTransaction(t: SupplierTransaction) {
  return {
    id: t.id,
    supplier: t.supplierId,
    entry: t.entryId,
    amount: Number(t.amount).toFixed(2),
    type: t.type,
    note: t.note,
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
  });
  return transactions.map(serializeSupplierTransaction);
}

export async function makePayment(opts: {
  companyId: number;
  supplierId: number;
  entryId: number;
  amount: string;
  note?: string;
  userFullName: string | null;
}): Promise<SupplierTransaction> {
  // SupplierPaymentSerializer relation + validation:
  //   supplier active bo'lishi kerak; entry mavjud; entry.supplier == supplier;
  //   amount > 0. Barchasi tenant (companyId) doirasida.
  if (Number(opts.amount) <= 0) {
    throw new ValidationError({ amount: ["To'lov miqdori noldan katta bo'lishi kerak."] });
  }

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

  // make_payment — atomik
  return prisma.$transaction((tx) =>
    tx.supplierTransaction.create({
      data: {
        companyId: opts.companyId,
        supplierId: opts.supplierId,
        entryId: opts.entryId,
        amount: opts.amount,
        type: 'pay',
        note:
          opts.note ||
          `Taminotchiga to'lov amalga oshirildi. Mas'ul: ${opts.userFullName ?? ''}`,
      },
    }),
  );
}
