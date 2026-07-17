import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound, ValidationError } from '../../common/errors.js';
import type { PageParams } from '../../common/pagination.js';
import { handleSaleItem } from '../inventory/inventory.hooks.js';
import { evaluateLowStock } from '../inventory/lowStock.service.js';
import type { SaleCreateInput } from './sales.schemas.js';

// ─────────────────────────────────────────────
// Django: apps/sales/services/sales_services.py (SaleService.create_sale)
//   + apps/sales/views/sale_view.py (list / detail / debt subqueries)
//   + apps/sales/serializers/sale_serializer.py (response shape).
//
// API snake_case, Decimal -> string("0.00"). Prisma camelCase.
// ─────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

const DISCOUNT_PERCENTAGE = 'p';
const DISCOUNT_FIXED = 'f';

const STATUS_PAID = 'paid';
const STATUS_PARTIAL = 'partial';
const STATUS_DEBT = 'debt';
const STATUS_RETURNED = 'r';

function decimalToString(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

// ════════════════════════════════════════════
//  CREATE SALE
// ════════════════════════════════════════════

export interface CreateSaleResult {
  sale_id: number;
  total: string;
  paid: string;
  status: string;
}

// Django SaleService.create_sale(@transaction.atomic).
//
// Biznes mantiq AYNAN ko'chirildi:
//   1. STORE: superuser -> data.store majburiy (get_object_or_404). Aks holda
//      foydalanuvchining faol StoreUser linkidan store olinadi
//      ("Siz hech qaysi do'konga biriktirilmagansiz" — link bo'lmasa).
//   2. CUSTOMER: data.customer berilsa get_object_or_404(Customer).
//   3. Har item uchun: eng eski (created_at) quantity>0 ProductBatch'ni FOR UPDATE
//      qulflab topish ("Mahsulot mavjud emas" / "Mahsulot yetarli emas"),
//      purchase_price'ni saqlab, batch.quantity -= quantity (FIFO).
//      total_price = price * quantity; SaleItem create; handleSaleItem hook.
//   4. DISCOUNT: p -> subtotal*value/100 (value>100 xato); f -> value.
//      discount > subtotal -> xato.  final = subtotal - discount.
//   5. PAYMENTS: har payment uchun Payment create; paid_amount yig'iladi.
//   6. STATUS: paid>=final -> paid; paid==0 -> debt; else -> partial.
//   7. DEBT: customer va paid<final -> increaseDebt(type 'i', due_date).
//   8. LowStock baholash.
export async function createSale(params: {
  companyId: number;
  user: User;
  data: SaleCreateInput;
  selectedStoreId?: number; // X-Store-ID orqali tanlangan do'kon (req.store)
}): Promise<CreateSaleResult> {
  const { companyId, user, data, selectedStoreId } = params;

  const itemsData = data.items;
  const paymentsData = data.payments;
  const discountType = data.discount_type ?? null;
  const discountValue = new Prisma.Decimal(data.discount_value ?? '0');

  return prisma.$transaction(async (tx) => {
    // 🔴 STORE LOGIC
    //  1) data.store — POS'da shu sotuv uchun ANIQ tanlangan do'kon (eng ustun;
    //     aks holda X-Store-ID konteksti boshqa do'konni ko'rsatsa, zaxira bor
    //     do'kon o'rniga bo'sh do'kondan sotishga urinib "Mahsulot mavjud emas"
    //     xatosi chiqadi).
    //  2) X-Store-ID orqali tanlangan do'kon (ambient kontekst).
    //  3) foydalanuvchining aktiv StoreUser linki.
    // Hammasi tenant (companyId) doirasida tekshiriladi.
    let storeId: number;
    const chosen = data.store ?? selectedStoreId ?? null;
    if (chosen != null) {
      const store = await tx.store.findFirst({ where: { id: chosen, companyId } });
      if (!store) throw new NotFound();
      storeId = store.id;
    } else {
      const storeLink = await tx.storeUser.findFirst({
        where: { userId: user.id, isActive: true, store: { companyId } },
        include: { store: true },
      });
      if (!storeLink) {
        throw new ValidationError("Siz hech qaysi do'konga biriktirilmagansiz");
      }
      storeId = storeLink.storeId;
    }

    // 🔴 CUSTOMER
    let customerId: number | null = null;
    if (data.customer) {
      // Tenant scope: customer ushbu company'ga tegishli bo'lishi shart.
      const customer = await tx.customer.findFirst({ where: { id: data.customer, companyId } });
      if (!customer) throw new NotFound();
      customerId = customer.id;
    }

    // Sotuvni yaratish (statuslar keyin yangilanadi)
    const sale = await tx.sale.create({
      data: {
        companyId,
        storeId,
        customerId,
        sellerId: user.id,
        discountType,
        discountValue,
        status: STATUS_DEBT, // vaqtinchalik; pastda aniqlanadi
      },
    });

    let subtotal = new Prisma.Decimal(0);

    for (const item of itemsData) {
      const productId = item.product;
      const quantityToSell = item.quantity;
      const price = new Prisma.Decimal(item.price);

      // FIFO: eng eski quantity>0 batch'ni qulflab olamiz (select_for_update).
      // Tenant scope: faqat shu company'ning batchlari (company_id) FIFO bo'yicha qulflanadi.
      const lockedRows = await tx.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT id FROM product_batch
                   WHERE company_id = ${companyId} AND store_id = ${storeId} AND product_id = ${productId} AND quantity > 0
                   ORDER BY created_at ASC
                   LIMIT 1 FOR UPDATE`,
      );

      if (lockedRows.length === 0) {
        throw new ValidationError('Mahsulot mavjud emas');
      }

      const batch = await tx.productBatch.findFirst({ where: { id: lockedRows[0]!.id, companyId } });
      if (!batch) {
        throw new ValidationError('Mahsulot mavjud emas');
      }

      if (batch.quantity < quantityToSell) {
        throw new ValidationError('Mahsulot yetarli emas');
      }

      // 🔥 CRITICAL: sotuv vaqtidagi tannarx (purchase_price) saqlanadi.
      const purchasePrice = batch.purchasePrice;

      // Stockni kamaytirish (F('quantity') - qty ekvivalenti, qulflangan satr).
      await tx.productBatch.update({
        where: { id: batch.id },
        data: { quantity: { decrement: quantityToSell } },
      });

      const totalPrice = price.times(quantityToSell);
      subtotal = subtotal.plus(totalPrice);

      await tx.saleItem.create({
        data: {
          saleId: sale.id,
          productId,
          quantity: quantityToSell,
          unitPrice: price,
          purchasePrice,
          totalPrice,
        },
      });

      // Inventory hook (faol session bo'lsa SALE movement yozadi).
      await handleSaleItem(
        { storeId, productId, quantity: quantityToSell, saleId: sale.id },
        tx,
      );
    }

    // 🔴 CALCULATE DISCOUNT
    let calculatedDiscount = new Prisma.Decimal(0);
    if (discountType === DISCOUNT_PERCENTAGE) {
      if (discountValue.greaterThan(100)) {
        throw new ValidationError("Chegirma foizi 100 dan oshishi mumkin emas.");
      }
      calculatedDiscount = subtotal.times(discountValue).dividedBy(100);
    } else if (discountType === DISCOUNT_FIXED) {
      calculatedDiscount = discountValue;
    }

    if (calculatedDiscount.greaterThan(subtotal)) {
      throw new ValidationError({
        discount_error: 'Chegirma miqdori umumiy summadan oshib ketdi!',
        subtotal: decimalToString(subtotal),
        attempted_discount: decimalToString(calculatedDiscount),
      });
    }

    const finalTotalAmount = subtotal.minus(calculatedDiscount);

    // 🔴 PAYMENTS
    // Karta kanali (method) berilgan bo'lsa — faol PaymentMethod ekanini tekshiramiz.
    const methodIds = [...new Set(paymentsData.map((p) => p.method).filter((m): m is number => m != null))];
    const validMethods = methodIds.length
      ? await tx.paymentMethod.findMany({ where: { id: { in: methodIds }, isActive: true }, select: { id: true } })
      : [];
    const validMethodIds = new Set(validMethods.map((m) => m.id));
    for (const id of methodIds) {
      if (!validMethodIds.has(id)) {
        throw new ValidationError("Tanlangan to'lov turi mavjud emas yoki nofaol");
      }
    }

    let paidAmount = new Prisma.Decimal(0);
    for (const p of paymentsData) {
      const amount = new Prisma.Decimal(p.amount);
      await tx.payment.create({
        data: {
          companyId,
          saleId: sale.id,
          customerId,
          amount,
          type: p.type,
          methodId: p.type === 'card' ? (p.method ?? null) : null,
        },
      });
      paidAmount = paidAmount.plus(amount);
    }

    // 🔴 ORTIQCHA TO'LOV GUARD: to'langan summa yakuniy summadan oshmasligi kerak.
    // Frontend ham bloklaydi — bu server tomonidagi yakuniy himoya.
    if (paidAmount.greaterThan(finalTotalAmount)) {
      throw new ValidationError({
        payment_error: "To'langan summa umumiy summadan oshib ketdi!",
        total: decimalToString(finalTotalAmount),
        paid: decimalToString(paidAmount),
      });
    }

    // 🔴 QARZ GUARD: to'liq to'lanmagan sotuvda mijoz majburiy — aks holda qarz
    // hech kimga biriktirilmay yo'qolib, kassada kamomad chiqaradi.
    if (paidAmount.lessThan(finalTotalAmount) && !customerId) {
      throw new ValidationError({
        customer_error: 'Qarzli sotuv uchun mijoz tanlanishi shart',
        total: decimalToString(finalTotalAmount),
        paid: decimalToString(paidAmount),
        debt: decimalToString(finalTotalAmount.minus(paidAmount)),
      });
    }

    // 🔴 STATUS
    let status: string;
    if (paidAmount.greaterThanOrEqualTo(finalTotalAmount)) {
      status = STATUS_PAID;
    } else if (paidAmount.equals(0)) {
      status = STATUS_DEBT;
    } else {
      status = STATUS_PARTIAL;
    }

    const updatedSale = await tx.sale.update({
      where: { id: sale.id },
      data: {
        totalAmount: finalTotalAmount,
        discountAmount: calculatedDiscount,
        paidAmount,
        status,
      },
    });

    // 🔴 DEBT: customer va to'liq to'lanmagan bo'lsa qarz yozamiz (type 'i').
    // Django DebtService.increase_debt mantig'i transaction atomicity'sini saqlash
    // uchun shu tx ichida inline yoziladi (amount > 0 — bu yerda kafolatlangan).
    if (customerId && paidAmount.lessThan(finalTotalAmount)) {
      await tx.customerDebt.create({
        data: {
          companyId,
          customerId,
          saleId: sale.id,
          amount: finalTotalAmount.minus(paidAmount),
          type: 'i',
          dueDate: data.debt_due_date ? new Date(data.debt_due_date) : null,
        },
      });
    }

    // 🔻 LOW STOCK: sotuv stockni kamaytirdi -> baholash (transaction ichida).
    await evaluateLowStock({
      store: storeId,
      productIds: itemsData.map((i) => i.product),
      db: tx,
    });

    return {
      sale_id: updatedSale.id,
      total: decimalToString(updatedSale.totalAmount),
      paid: decimalToString(updatedSale.paidAmount),
      status: updatedSale.status,
    };
  });
}

// ════════════════════════════════════════════
//  SERIALIZATION (SaleListSerializer)
// ════════════════════════════════════════════

type SaleWithRelations = Prisma.SaleGetPayload<{
  include: {
    store: true;
    customer: true;
    seller: true;
    items: { include: { product: true } };
    payments: { include: { method: true } };
  };
}>;

const saleInclude = {
  store: true,
  customer: true,
  seller: true,
  items: { include: { product: true }, orderBy: { id: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' }, include: { method: true } },
} satisfies Prisma.SaleInclude;

// Django _debt_increase_subquery / _debt_decrease_subquery ekvivalenti:
//   har Sale uchun type='i' va type='d' yig'indilari (kartezian yo'q).
async function debtTotalsFor(saleIds: number[]): Promise<
  Map<number, { increase: Prisma.Decimal; decrease: Prisma.Decimal }>
> {
  const result = new Map<number, { increase: Prisma.Decimal; decrease: Prisma.Decimal }>();
  if (saleIds.length === 0) return result;

  const grouped = await prisma.customerDebt.groupBy({
    by: ['saleId', 'type'],
    where: { saleId: { in: saleIds } },
    _sum: { amount: true },
  });

  for (const id of saleIds) {
    result.set(id, { increase: new Prisma.Decimal(0), decrease: new Prisma.Decimal(0) });
  }
  for (const g of grouped) {
    if (g.saleId === null) continue;
    const entry = result.get(g.saleId);
    if (!entry) continue;
    const sum = g._sum.amount ?? new Prisma.Decimal(0);
    if (g.type === 'i') entry.increase = entry.increase.plus(sum);
    else if (g.type === 'd') entry.decrease = entry.decrease.plus(sum);
  }
  return result;
}

function serializeSaleItem(item: SaleWithRelations['items'][number]) {
  return {
    id: item.id,
    product: item.productId,
    product_name: item.product ? item.product.name : null,
    sku: item.product ? item.product.sku : null,
    quantity: item.quantity,
    unit_price: decimalToString(item.unitPrice),
    total_price: decimalToString(item.totalPrice),
    returned_quantity: item.returnedQuantity,
  };
}

function serializePayment(p: SaleWithRelations['payments'][number]) {
  return {
    id: p.id,
    amount: decimalToString(p.amount),
    type: p.type,
    method: p.methodId,
    method_name: p.method ? p.method.name : null,
    method_code: p.method ? p.method.code : null,
    is_refund: p.isRefund,
    created_at: p.createdAt,
  };
}

// Django SaleListSerializer. debt = increase - decrease, <=0 bo'lsa null.
function serializeSale(
  sale: SaleWithRelations,
  totals: { increase: Prisma.Decimal; decrease: Prisma.Decimal },
) {
  const debt = totals.increase.minus(totals.decrease);
  return {
    id: sale.id,
    store: sale.storeId,
    store_name: sale.store ? sale.store.name : null,
    seller: sale.sellerId,
    seller_name: sale.seller ? sale.seller.fullName : null,
    customer: sale.customerId,
    customer_name: sale.customer ? sale.customer.fullName : null,
    payments: sale.payments.map(serializePayment),
    status: sale.status,
    total_amount: decimalToString(sale.totalAmount),
    paid_amount: decimalToString(sale.paidAmount),
    debt: debt.greaterThan(0) ? decimalToString(debt) : null,
    total_increase: decimalToString(totals.increase),
    total_decrease: decimalToString(totals.decrease),
    discount_type: sale.discountType,
    discount_value: decimalToString(sale.discountValue),
    discount_amount: decimalToString(sale.discountAmount),
    items: sale.items.map(serializeSaleItem),
    created_at: sale.createdAt,
  };
}

// ════════════════════════════════════════════
//  LIST SALES (SaleListAPIView)
// ════════════════════════════════════════════

export interface SaleListFilters {
  status?: string;
  store?: number;
  customer?: number;
  seller?: number;
  date_from?: string; // YYYY-MM-DD (created_at__date >=)
  date_to?: string; // YYYY-MM-DD (created_at__date <=)
  search?: string; // customer.full_name icontains
  ordering?: string; // created_at / total_amount (+/-)
}

// Django SaleFilter + SearchFilter("customer__full_name") + OrderingFilter
// (created_at, total_amount; default -created_at). Permission: superuser hammasi,
// aks holda seller=user.
export async function listSales(params: {
  companyId: number;
  user: User;
  filters: SaleListFilters;
  page: PageParams;
}): Promise<{ results: ReturnType<typeof serializeSale>[]; count: number }> {
  const { companyId, user, filters, page } = params;

  // 🏢 TENANT SCOPE
  const where: Prisma.SaleWhereInput = { companyId };

  // 🔐 PERMISSION
  if (!user.isSuperuser) {
    where.sellerId = user.id;
  }

  if (filters.status) where.status = filters.status;
  if (filters.store !== undefined) where.storeId = filters.store;
  if (filters.customer !== undefined) where.customerId = filters.customer;
  if (filters.seller !== undefined) where.sellerId = filters.seller;

  // created_at__date range (gte/lte). date_to -> kunning oxirigacha qamrash uchun
  // ertangi kun boshigacha (< date_to + 1) lt ishlatamiz.
  if (filters.date_from || filters.date_to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.date_from) createdAt.gte = new Date(`${filters.date_from}T00:00:00.000Z`);
    if (filters.date_to) {
      const dt = new Date(`${filters.date_to}T00:00:00.000Z`);
      dt.setUTCDate(dt.getUTCDate() + 1);
      createdAt.lt = dt;
    }
    where.createdAt = createdAt;
  }

  if (filters.search) {
    where.customer = { fullName: { contains: filters.search, mode: 'insensitive' } };
  }

  // ORDERING: created_at | total_amount (default -created_at)
  let orderBy: Prisma.SaleOrderByWithRelationInput = { createdAt: 'desc' };
  if (filters.ordering) {
    const desc = filters.ordering.startsWith('-');
    const field = desc ? filters.ordering.slice(1) : filters.ordering;
    const dir: Prisma.SortOrder = desc ? 'desc' : 'asc';
    if (field === 'created_at') orderBy = { createdAt: dir };
    else if (field === 'total_amount') orderBy = { totalAmount: dir };
  }

  const [count, sales] = await Promise.all([
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where,
      include: saleInclude,
      orderBy,
      skip: page.skip,
      take: page.take,
    }),
  ]);

  const totals = await debtTotalsFor(sales.map((s) => s.id));

  const results = sales.map((s) =>
    serializeSale(s, totals.get(s.id) ?? { increase: new Prisma.Decimal(0), decrease: new Prisma.Decimal(0) }),
  );

  return { results, count };
}

// ════════════════════════════════════════════
//  SALE DETAIL (SaleDetailAPIView)
// ════════════════════════════════════════════

// Django SaleDetailAPIView.get -> get_object_or_404 (permission filtri yo'q —
// faqat 404). Sodiq port: pk topilmasa 404.
export async function getSale(companyId: number, pk: number) {
  const sale = await prisma.sale.findFirst({
    where: { id: pk, companyId },
    include: saleInclude,
  });
  if (!sale) throw new NotFound();

  const totals = await debtTotalsFor([sale.id]);
  return serializeSale(
    sale,
    totals.get(sale.id) ?? { increase: new Prisma.Decimal(0), decrease: new Prisma.Decimal(0) },
  );
}
