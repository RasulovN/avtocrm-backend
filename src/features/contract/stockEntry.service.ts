import type { Prisma, StockEntry } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { ValidationError } from '../../common/errors.js';
import { mediaUrl } from '../../common/media.js';
import type { PageParams } from '../../common/pagination.js';
import type { StockEntryCreateInput } from './contract.schemas.js';
import { handleStockEntry } from '../inventory/inventory.hooks.js';

// ─────────────────────────────────────────────
// StockEntry.calculate_payment_fields()
//   cash_amount + card_amount asosida paid_amount, payment_type, debt_amount.
//   Django'da StockEntry.save() ichida ishlaydi — bu yerda create'dan oldin hisoblanadi.
// ─────────────────────────────────────────────
export interface PaymentFields {
  paidAmount: number;
  paymentType: 'cash' | 'card' | 'mixed';
  debtAmount: number;
}

export function calculatePaymentFields(
  totalAmount: number,
  cashAmount: number,
  cardAmount: number,
): PaymentFields {
  const paidAmount = cashAmount + cardAmount;

  let paymentType: 'cash' | 'card' | 'mixed';
  if (cardAmount > 0 && cashAmount <= 0) {
    paymentType = 'card';
  } else if (cashAmount > 0 && cardAmount <= 0) {
    paymentType = 'cash';
  } else if (cashAmount > 0 && cardAmount > 0) {
    paymentType = 'mixed';
  } else {
    // ikkalasi ham 0 — to'liq qarzga, default cash
    paymentType = 'cash';
  }

  const debtAmount = totalAmount - paidAmount;
  return { paidAmount, paymentType, debtAmount };
}

// ─────────────────────────────────────────────
// StockEntryService.create_entry
// ─────────────────────────────────────────────

// StockEntryCreateSerializer relation validatsiyasi (barchasi tenant doirasida):
//   supplier active; store active (ombor ham, savdo do'koni ham — Django'dagi kabi
//   istalgan faol do'konga kirim qilish mumkin); products active.
// Purchase session receive/confirm bosqichlarida ham xuddi shu tekshiruv ishlaydi.
export async function validateEntryRelations(
  companyId: number,
  data: Pick<StockEntryCreateInput, 'supplier' | 'store' | 'items'>,
): Promise<void> {
  const supplier = await prisma.supplier.findFirst({
    where: { id: data.supplier, companyId, isActive: true },
    select: { id: true },
  });
  if (!supplier) {
    throw new ValidationError({ supplier: ['Invalid pk - object does not exist.'] });
  }

  const store = await prisma.store.findFirst({
    where: { id: data.store, companyId, isActive: true },
    select: { id: true },
  });
  if (!store) {
    throw new ValidationError({ store: ['Invalid pk - object does not exist.'] });
  }

  const productIds = data.items.map((i) => i.product);
  const activeProducts = await prisma.product.findMany({
    where: { id: { in: productIds }, companyId, status: 'a' },
    select: { id: true },
  });
  const activeProductIds = new Set(activeProducts.map((p) => p.id));
  for (const item of data.items) {
    if (!activeProductIds.has(item.product)) {
      throw new ValidationError({ items: [{ product: ['Invalid pk - object does not exist.'] }] });
    }
  }
}

// Ichki: normalizatsiya qilingan split to'lov qatori
interface NormalizedPaymentRow {
  type: 'cash' | 'card';
  amount: number;
  bankCardId: number | null;
}

// Django StockEntryService._normalize_payments ekvivalenti:
// payments[] berilsa flat cash/card/bank_card E'TIBORGA OLINMAYDI (undan qayta
// hisoblanadi); bo'lmasa flat maydonlardan sintez qilinadi (eski klientlar, Excel).
function normalizePayments(data: StockEntryCreateInput): NormalizedPaymentRow[] {
  const explicit = (data.payments ?? []).filter((p) => Number(p.amount) > 0);
  if (explicit.length > 0) {
    return explicit.map((p) => ({
      type: p.type,
      amount: Number(p.amount),
      bankCardId: p.type === 'card' ? (p.bank_card ?? null) : null,
    }));
  }
  const rows: NormalizedPaymentRow[] = [];
  if (Number(data.cash_amount) > 0) {
    rows.push({ type: 'cash', amount: Number(data.cash_amount), bankCardId: null });
  }
  if (Number(data.card_amount) > 0) {
    rows.push({ type: 'card', amount: Number(data.card_amount), bankCardId: data.bank_card ?? null });
  }
  return rows;
}

export async function createEntry(opts: {
  companyId: number;
  data: StockEntryCreateInput;
  userId: number;
}): Promise<StockEntry> {
  const { data, companyId } = opts;

  await validateEntryRelations(companyId, data);

  const productIds = data.items.map((i) => i.product);

  const totalEntryAmount = data.items.reduce(
    (acc, item) => acc + Number(item.purchase_price) * item.quantity,
    0,
  );

  // Split to'lovlar — cash/card yig'indilari shulardan hisoblanadi
  const paymentRows = normalizePayments(data);
  const cashAmount = paymentRows
    .filter((p) => p.type === 'cash')
    .reduce((s, p) => s + p.amount, 0);
  const cardAmount = paymentRows
    .filter((p) => p.type === 'card')
    .reduce((s, p) => s + p.amount, 0);

  // Karta qatorlarida ishlatilgan PaymentMethod'lar faol va kirim uchun
  // ruxsat etilgan (scope purchase/both) bo'lishi shart. Legacy bank_card ham
  // (berilgan bo'lsa) xuddi shu tekshiruvdan o'tadi.
  const cardIds = new Set<number>();
  for (const row of paymentRows) {
    if (row.type === 'card' && row.bankCardId) cardIds.add(row.bankCardId);
  }
  if (data.bank_card) cardIds.add(data.bank_card);
  if (cardIds.size > 0) {
    const found = await prisma.paymentMethod.findMany({
      where: { id: { in: [...cardIds] }, isActive: true, scope: { in: ['purchase', 'both'] } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((c) => c.id));
    for (const id of cardIds) {
      if (!foundIds.has(id)) {
        throw new ValidationError({ bank_card: ['Invalid pk - object does not exist.'] });
      }
    }
  }

  // Legacy bitta-karta maydoni: aynan bitta karta qatori bo'lsa — o'sha karta
  const cardRows = paymentRows.filter((p) => p.type === 'card');
  const bankCardId =
    cardRows.length === 1 ? (cardRows[0].bankCardId ?? null) : null;

  // calculate_payment_fields — create'dan oldin
  const payment = calculatePaymentFields(totalEntryAmount, cashAmount, cardAmount);

  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.stockEntry.create({
      data: {
        companyId,
        supplierId: data.supplier,
        storeId: data.store,
        totalAmount: totalEntryAmount.toFixed(2),
        cashAmount: cashAmount.toFixed(2),
        cardAmount: cardAmount.toFixed(2),
        paidAmount: payment.paidAmount.toFixed(2),
        debtAmount: payment.debtAmount.toFixed(2),
        paymentType: payment.paymentType,
        bankCardId,
        note: data.note ?? '',
        createdById: opts.userId,
      },
    });

    // Split to'lov qatorlari (StockEntryPayment) — sales.Payment bilan bir xil shakl
    if (paymentRows.length > 0) {
      await tx.stockEntryPayment.createMany({
        data: paymentRows.map((p) => ({
          entryId: created.id,
          amount: p.amount.toFixed(2),
          type: p.type,
          bankCardId: p.type === 'card' ? p.bankCardId : null,
        })),
      });
    }

    // Mavjud batchlar — store + product bo'yicha (tenant doirasida)
    const existingBatches = await tx.productBatch.findMany({
      where: { storeId: data.store, productId: { in: productIds }, companyId },
    });
    const existingByProduct = new Map<number, (typeof existingBatches)[number]>();
    for (const b of existingBatches) existingByProduct.set(b.productId, b);

    const itemRows: Prisma.StockEntryItemCreateManyInput[] = [];

    for (const item of data.items) {
      const qty = item.quantity;
      const pPrice = Number(item.purchase_price).toFixed(2);
      const sPrice = Number(item.selling_price).toFixed(2);
      const wPrice = Number(item.wholesale_price).toFixed(2);

      itemRows.push({
        entryId: created.id,
        productId: item.product,
        quantity: qty,
        purchasePrice: pPrice,
        sellingPrice: sPrice,
        wholesalePrice: wPrice,
      });

      const existing = existingByProduct.get(item.product);
      if (existing) {
        // batch.quantity = F("quantity") + qty; narxlar yangilanadi
        await tx.productBatch.update({
          where: { id: existing.id },
          data: {
            quantity: { increment: qty },
            purchasePrice: pPrice,
            sellingPrice: sPrice,
            wholesalePrice: wPrice,
          },
        });
      } else {
        await tx.productBatch.create({
          data: {
            companyId,
            productId: item.product,
            storeId: data.store,
            quantity: qty,
            purchasePrice: pPrice,
            sellingPrice: sPrice,
            wholesalePrice: wPrice,
          },
        });
      }
    }

    await tx.stockEntryItem.createMany({ data: itemRows });

    // Qarzdorlik tranzaksiyasi — debt_amount > 0 bo'lsa
    if (payment.debtAmount > 0) {
      await tx.supplierTransaction.create({
        data: {
          companyId,
          supplierId: data.supplier,
          entryId: created.id,
          amount: payment.debtAmount.toFixed(2),
          type: 'in',
          note: `Entry #${created.id} orqali qarzga mahsulot olindi`,
        },
      });
    }

    // handle_stock_entry — active session bo'lsa InventoryMovement yoziladi
    await handleStockEntry({
      storeId: data.store,
      entryId: created.id,
      lines: data.items.map((i) => ({ productId: i.product, quantity: i.quantity })),
    }, tx);

    return created;
  });

  return entry;
}

// ─────────────────────────────────────────────
// StockEntryListAPIView — list + filterlar + serializatsiya
// ─────────────────────────────────────────────

function serializeStockEntryItem(item: {
  id: number;
  productId: number;
  quantity: number;
  purchasePrice: Prisma.Decimal;
  sellingPrice: Prisma.Decimal;
  product: { name: string | null; sku: string | null; barcode: string | null; shtrixCode: string | null } | null;
}) {
  return {
    id: item.id,
    product: item.productId,
    product_name: item.product?.name ?? null,
    quantity: item.quantity,
    purchase_price: Number(item.purchasePrice).toFixed(2),
    selling_price: Number(item.sellingPrice).toFixed(2),
    sku: item.product?.sku ?? null,
    barcode: item.product?.barcode ?? null,
    shtrix_code: mediaUrl(item.product?.shtrixCode ?? null),
  };
}

export type StockEntryPaymentStatus = 'unpaid' | 'partial' | 'paid';

// Kirim to'lov holati (Django StockEntryFilter.filter_payment_status bilan bir xil):
// "in" tranzaksiyasi faqat qarz qismini saqlaydi — kirim paytida to'langani paidAmount'da.
function entryPaymentStatus(
  totalIn: number,
  totalPaid: number,
  paidAmount: number,
): StockEntryPaymentStatus {
  if (totalPaid >= totalIn) return 'paid';
  if (totalPaid <= 0 && paidAmount <= 0) return 'unpaid';
  return 'partial';
}

// entry to'plami uchun total_in/total_paid map'lari
async function entryTxSums(entryIds: number[]) {
  const totalIn = new Map<number, number>();
  const totalPaid = new Map<number, number>();
  if (!entryIds.length) return { totalIn, totalPaid };
  const txGroups = await prisma.supplierTransaction.groupBy({
    by: ['entryId', 'type'],
    where: { entryId: { in: entryIds } },
    _sum: { amount: true },
  });
  for (const g of txGroups) {
    if (g.entryId == null) continue;
    const amount = Number(g._sum.amount ?? 0);
    if (g.type === 'in') totalIn.set(g.entryId, amount);
    else if (g.type === 'pay') totalPaid.set(g.entryId, amount);
  }
  return { totalIn, totalPaid };
}

export function buildStockEntryWhere(opts: {
  companyId: number;
  search?: string | null;
  supplier?: number | null;
  store?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Prisma.StockEntryWhereInput {
  // companyId scope: faqat shu tenant kirimlari.
  const where: Prisma.StockEntryWhereInput = { companyId: opts.companyId };

  if (opts.supplier) where.supplierId = opts.supplier;
  if (opts.store) where.storeId = opts.store;
  if (opts.search) {
    where.supplier = { name: { contains: opts.search, mode: 'insensitive' } };
  }
  if (opts.dateFrom || opts.dateTo) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (opts.dateFrom) createdAt.gte = new Date(`${opts.dateFrom}T00:00:00.000Z`);
    if (opts.dateTo) createdAt.lte = new Date(`${opts.dateTo}T23:59:59.999Z`);
    where.createdAt = createdAt;
  }
  return where;
}

export async function listStockEntries(opts: {
  companyId: number;
  search?: string | null;
  supplier?: number | null;
  store?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  ordering?: string | null;
  paymentStatus?: StockEntryPaymentStatus | null;
  page: PageParams;
}) {
  const where = buildStockEntryWhere(opts);

  // ordering: created_at | total_amount (+/-). Default: -created_at
  let orderBy: Prisma.StockEntryOrderByWithRelationInput = { createdAt: 'desc' };
  if (opts.ordering) {
    const desc = opts.ordering.startsWith('-');
    const field = desc ? opts.ordering.slice(1) : opts.ordering;
    const dir: Prisma.SortOrder = desc ? 'desc' : 'asc';
    if (field === 'created_at') orderBy = { createdAt: dir };
    else if (field === 'total_amount') orderBy = { totalAmount: dir };
  }

  const include = {
    supplier: { select: { name: true } },
    store: { select: { name: true } },
    createdBy: { select: { fullName: true } },
    items: {
      include: {
        product: { select: { name: true, sku: true, barcode: true, shtrixCode: true } },
      },
    },
  } satisfies Prisma.StockEntryInclude;

  let count: number;
  let entries: Prisma.StockEntryGetPayload<{ include: typeof include }>[];
  let totalIn: Map<number, number>;
  let totalPaid: Map<number, number>;

  if (opts.paymentStatus) {
    // Holat tranzaksiya yig'indilaridan hisoblanadi — filtr sahifalashdan OLDIN
    // butun to'plam ustida qo'llanadi (Django'da SQL annotatsiya bilan bir xil natija).
    const slim = await prisma.stockEntry.findMany({
      where,
      orderBy,
      select: { id: true, paidAmount: true },
    });
    const sums = await entryTxSums(slim.map((e) => e.id));
    const matchedIds = slim
      .filter((e) => {
        const status = entryPaymentStatus(
          sums.totalIn.get(e.id) ?? 0,
          sums.totalPaid.get(e.id) ?? 0,
          Number(e.paidAmount ?? 0),
        );
        return status === opts.paymentStatus;
      })
      .map((e) => e.id);

    count = matchedIds.length;
    const pageIds = matchedIds.slice(opts.page.skip, opts.page.skip + opts.page.take);
    const rows = pageIds.length
      ? await prisma.stockEntry.findMany({ where: { id: { in: pageIds } }, include })
      : [];
    // findMany id-in tartibni saqlamaydi — sahifa tartibini qayta tiklaymiz
    const rowMap = new Map(rows.map((r) => [r.id, r]));
    entries = pageIds.map((id) => rowMap.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
    totalIn = sums.totalIn;
    totalPaid = sums.totalPaid;
  } else {
    const [c, rows] = await prisma.$transaction([
      prisma.stockEntry.count({ where }),
      prisma.stockEntry.findMany({
        where,
        orderBy,
        skip: opts.page.skip,
        take: opts.page.take,
        include,
      }),
    ]);
    count = c;
    entries = rows;
    const sums = await entryTxSums(entries.map((e) => e.id));
    totalIn = sums.totalIn;
    totalPaid = sums.totalPaid;
  }

  const results = entries.map((e) => {
    const tIn = totalIn.get(e.id) ?? 0;
    const tPaid = totalPaid.get(e.id) ?? 0;
    const debt = tIn - tPaid;
    return {
      id: e.id,
      supplier: e.supplierId,
      supplier_name: e.supplier?.name ?? '',
      store: e.storeId,
      store_name: e.store?.name ?? '',
      total_amount: Number(e.totalAmount).toFixed(2),
      paid_amount: Number(e.paidAmount).toFixed(2),
      total_in: tIn.toFixed(2),
      total_paid: tPaid.toFixed(2),
      debt: debt > 0 ? debt : 0,
      created_by: e.createdById,
      full_name: e.createdBy?.fullName ?? "Shaxsiy ma'lumotlar kiritilmagan!",
      note: e.note ?? '',
      items: e.items.map(serializeStockEntryItem),
      created_at: e.createdAt,
    };
  });

  return { results, count };
}

// create response (StockEntryCreateAPIView.post javobi)
export function serializeCreateResponse(entry: StockEntry, itemsCount: number) {
  return {
    status: 'success',
    id: entry.id,
    items_count: itemsCount,
    payment_type: entry.paymentType,
    paid_amount: Number(entry.paidAmount).toFixed(2),
    debt_amount: Number(entry.debtAmount).toFixed(2),
  };
}
