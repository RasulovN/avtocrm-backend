import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound, ValidationError } from '../../common/errors.js';
import { handleSaleReturn } from '../inventory/inventory.hooks.js';
import { evaluateLowStock } from '../inventory/lowStock.service.js';
import type { RefundPaymentInput, SaleReturnCreateInput } from './sales.schemas.js';

// ─────────────────────────────────────────────
// Django: apps/sales/services/sale_return_service.py (SaleReturnService.create_return)
//   + apps/sales/views/sale_return_view.py (list).
// API snake_case, Decimal -> string("0.00").
// ─────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

const STATUS_RETURNED = 'r';

function decimalToString(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

// Django DebtService.get_sale_debt: SUM(i) - SUM(d).
async function getSaleDebt(tx: Tx, saleId: number): Promise<Prisma.Decimal> {
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

// ════════════════════════════════════════════
//  REFUND PAYMENTS (Django SalePaymentService.record_payments + validate_payment_method)
// ════════════════════════════════════════════

// Qaytarim to'lovlari: jami summa pul bilan qaytarilishi kerak bo'lgan summaga
// AYNAN teng bo'lishi shart; karta → method (PaymentMethod) majburiy va faol
// bo'lishi kerak, naqd → method yuborilmasligi kerak.
async function recordRefundPayments(
  tx: Tx,
  opts: {
    companyId: number;
    saleId: number;
    customerId: number | null;
    payments: RefundPaymentInput[];
    expectedTotal: Prisma.Decimal;
  },
): Promise<void> {
  const refundTotal = opts.payments.reduce(
    (sum, p) => sum.plus(new Prisma.Decimal(p.amount)),
    new Prisma.Decimal(0),
  );
  if (!refundTotal.equals(opts.expectedTotal)) {
    throw new ValidationError({
      payments: [
        `Qaytariladigan to'lovlar jami ${refundTotal.toFixed(2)} — ` +
          `pul bilan qaytarilishi kerak bo'lgan summa ${opts.expectedTotal.toFixed(2)} ga teng bo'lishi shart`,
      ],
    });
  }

  for (const p of opts.payments) {
    if (p.type === 'card') {
      if (!p.method) {
        throw new ValidationError({ method: ["Karta to'lovi uchun to'lov turi (method) majburiy"] });
      }
      const method = await tx.paymentMethod.findFirst({
        where: { id: p.method, isActive: true },
        select: { id: true },
      });
      if (!method) {
        throw new ValidationError({ method: ['Invalid pk - object does not exist.'] });
      }
    } else if (p.method) {
      throw new ValidationError({ method: ["Naqd to'lovda method yuborilmasligi kerak"] });
    }
  }

  await tx.payment.createMany({
    data: opts.payments.map((p) => ({
      companyId: opts.companyId,
      saleId: opts.saleId,
      customerId: opts.customerId,
      amount: p.amount,
      type: p.type,
      methodId: p.type === 'card' ? p.method ?? null : null,
      isRefund: true,
    })),
  });
}

// ════════════════════════════════════════════
//  CREATE RETURN
// ════════════════════════════════════════════

export interface CreateReturnResult {
  return_id: number;
  refund: string;
}

// Django SaleReturnService.create_return(@transaction.atomic).
//
// Biznes mantiq AYNAN ko'chirildi:
//   - Sale'ni FOR UPDATE qulflab, items bilan olamiz (topilmasa 404).
//   - store/customer = sale.store/sale.customer. SaleReturn create (seller=user).
//   - Har return item uchun:
//       * sale_item topilmasa -> "SaleItem topilmadi".
//       * quantity <= 0 -> "Quantity > 0 bo'lishi kerak".
//       * quantity > (sale_item.quantity - returned_quantity) -> "Miqdor oshib ketdi".
//       * Stock qaytarish: ProductBatch.quantity += qty (store+product bo'yicha).
//       * sale_item.returned_quantity += qty.
//       * handleSaleReturn hook (faol session bo'lsa RETURN movement).
//       * refund = unit_price * qty; total_refund += refund; SaleReturnItem create.
//   - total_refund'ni return'ga yozamiz.
//   - ACCOUNTING (customer bo'lsa):
//       current_debt = get_sale_debt(sale).
//       debt>0: reduce = min(debt, refund); reduce>0 -> decreaseDebt (type 'd');
//               qoldiq (refund-reduce) > 0 -> cash Payment.
//       debt<=0: refund'ni cash Payment sifatida yozamiz.
//   - SALE STATUS: jami quantity == jami returned -> status 'r'.
//   - LowStock baholash (qoldiq oshdi).
export async function createReturn(params: {
  companyId: number;
  user: User;
  data: SaleReturnCreateInput;
}): Promise<CreateReturnResult> {
  const { companyId, user, data } = params;

  return prisma.$transaction(async (tx) => {
    // Sale'ni qulflaymiz (Django: select_for_update().get(id=...) -> topilmasa DoesNotExist=404).
    // Tenant scope: faqat shu company'ning sotuvi.
    const lockedRows = await tx.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`SELECT id FROM sales_sale WHERE id = ${data.sale} AND company_id = ${companyId} FOR UPDATE`,
    );
    if (lockedRows.length === 0) {
      throw new NotFound();
    }

    const sale = await tx.sale.findFirst({
      where: { id: data.sale, companyId },
      include: { items: true },
    });
    if (!sale) throw new NotFound();

    const storeId = sale.storeId;
    const customerId = sale.customerId;

    const returnObj = await tx.saleReturn.create({
      data: {
        companyId,
        saleId: sale.id,
        storeId,
        customerId,
        sellerId: user.id,
        comment: data.comment ?? null,
      },
    });

    let totalRefund = new Prisma.Decimal(0);

    const saleItemsMap = new Map(sale.items.map((it) => [it.id, it]));

    for (const item of data.items) {
      const saleItem = saleItemsMap.get(item.sale_item);
      if (!saleItem) {
        throw new ValidationError('SaleItem topilmadi');
      }

      const quantity = item.quantity;
      if (quantity <= 0) {
        throw new ValidationError("Quantity > 0 bo'lishi kerak");
      }

      const available = saleItem.quantity - saleItem.returnedQuantity;
      if (quantity > available) {
        throw new ValidationError('Miqdor oshib ketdi');
      }

      // 🔹 1. STOCK UPDATE: store+product bo'yicha barcha batchlarga qty qaytariladi.
      //    (Django: ProductBatch.objects.filter(store, product).update(quantity=F+qty))
      await tx.productBatch.updateMany({
        where: { companyId, storeId, productId: saleItem.productId },
        data: { quantity: { increment: quantity } },
      });

      // 🔹 2. SALE ITEM UPDATE: returned_quantity += qty.
      await tx.saleItem.update({
        where: { id: saleItem.id },
        data: { returnedQuantity: { increment: quantity } },
      });

      // 🔹 3. INVENTORY MOVEMENT (faol session bo'lsa hook yozadi; aks holda no-op).
      await handleSaleReturn(
        { storeId, productId: saleItem.productId, quantity, returnId: returnObj.id },
        tx,
      );

      // 🔹 4. RETURN ITEM.
      const refundAmount = saleItem.unitPrice.times(quantity);
      totalRefund = totalRefund.plus(refundAmount);

      await tx.saleReturnItem.create({
        data: {
          saleReturnId: returnObj.id,
          saleItemId: saleItem.id,
          productId: saleItem.productId,
          quantity,
          unitPrice: saleItem.unitPrice,
          totalPrice: refundAmount,
        },
      });
    }

    await tx.saleReturn.update({
      where: { id: returnObj.id },
      data: { totalRefund },
    });

    // 💰 ACCOUNTING
    // Avval qaytarim sotuv qarzini kamaytiradi, qolgan qismi mijozga PUL bilan
    // qaytariladi. Pul qismi sotuvdagi kabi erkin taqsimlanadi (payments[]):
    // naqd / karta / aralash. payments yuborilmasa — eski xatti-harakat: hammasi naqd.
    let moneyRefund = totalRefund;

    if (customerId) {
      const currentDebt = await getSaleDebt(tx, sale.id);

      if (currentDebt.greaterThan(0)) {
        const reduceAmount = Prisma.Decimal.min(currentDebt, totalRefund);

        if (reduceAmount.greaterThan(0)) {
          // Django DebtService.decrease_debt — type 'd' (atomicity uchun inline).
          await tx.customerDebt.create({
            data: { companyId, customerId, saleId: sale.id, amount: reduceAmount, type: 'd' },
          });
        }

        moneyRefund = totalRefund.minus(reduceAmount);
      }
    }

    const refundPayments = data.payments;

    if (refundPayments && refundPayments.length > 0) {
      await recordRefundPayments(tx, {
        companyId,
        saleId: sale.id,
        customerId,
        payments: refundPayments,
        expectedTotal: moneyRefund,
      });
    } else if (customerId && moneyRefund.greaterThan(0)) {
      // Eski (backward-compatible) xatti-harakat: pul qismi to'liq naqd qaytariladi
      await tx.payment.create({
        data: {
          companyId,
          customerId,
          saleId: sale.id,
          amount: moneyRefund,
          type: 'cash',
          isRefund: true,
        },
      });
    }

    // 📊 SALE STATUS: jami sotilgan == jami qaytarilgan -> 'r' (returned).
    const aggregated = await tx.saleItem.aggregate({
      where: { saleId: sale.id },
      _sum: { quantity: true, returnedQuantity: true },
    });
    const totalQty = aggregated._sum.quantity ?? 0;
    const returnedQty = aggregated._sum.returnedQuantity ?? 0;
    if (totalQty === returnedQty) {
      await tx.sale.update({ where: { id: sale.id }, data: { status: STATUS_RETURNED } });
    }

    // 🔺 LOW STOCK: qaytarish qoldiqni oshirdi -> OPEN yozuvlar yopilishi mumkin.
    const returnedProductIds = data.items
      .map((it) => saleItemsMap.get(it.sale_item)?.productId)
      .filter((id): id is number => id !== undefined);
    await evaluateLowStock({ store: storeId, productIds: returnedProductIds, db: tx });

    return {
      return_id: returnObj.id,
      refund: decimalToString(totalRefund),
    };
  });
}

// ════════════════════════════════════════════
//  LIST RETURNS (SaleReturnListAPIView)
// ════════════════════════════════════════════

type SaleReturnWithRelations = Prisma.SaleReturnGetPayload<{
  include: {
    store: true;
    seller: true;
    customer: true;
    sale: true;
    items: { include: { product: true } };
  };
}>;

const returnInclude = {
  store: true,
  seller: true,
  customer: true,
  sale: true,
  items: { include: { product: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.SaleReturnInclude;

// Django SaleReturnListSerializer.
function serializeReturn(ret: SaleReturnWithRelations) {
  return {
    id: ret.id,
    sale: ret.saleId,
    store: ret.storeId,
    store_name: ret.store ? ret.store.name : '',
    customer: ret.customerId,
    seller: ret.sellerId,
    seller_name: ret.seller ? ret.seller.fullName : '',
    total_refund: decimalToString(ret.totalRefund),
    comment: ret.comment,
    items: ret.items.map((it) => ({
      id: it.id,
      sale_item: it.saleItemId,
      product: it.productId,
      product_name: it.product ? it.product.name : '',
      quantity: it.quantity,
    })),
  };
}

// Django SaleReturnListAPIView: order -created_at. Permission: superuser hammasi,
// aks holda store user_links orqali (foydalanuvchi faol a'zo bo'lgan do'konlar).
// Django'da pagination yo'q (faithful port) — barcha yozuvlar qaytariladi.
export async function listReturns(companyId: number, user: User) {
  const where: Prisma.SaleReturnWhereInput = { companyId };
  if (!user.isSuperuser) {
    where.store = { userLinks: { some: { userId: user.id, isActive: true } } };
  }

  const returns = await prisma.saleReturn.findMany({
    where,
    include: returnInclude,
    orderBy: { createdAt: 'desc' },
  });

  return returns.map(serializeReturn);
}
