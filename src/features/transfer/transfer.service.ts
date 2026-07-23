import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { ValidationError, Forbidden, NotFound } from '../../common/errors.js';
import { handleTransferApproved, handleTransferIn } from '../inventory/inventory.hooks.js';
import { notifyTransferCreated, notifyTransferRejected } from './notification.service.js';
import type { TransferCreateInput } from './transfer.schemas.js';

// Django: apps/transfer/services/transfer_service.py
//
// StockTransfer.Status: p=Pending, a=Approved, r=Rejected.
// Hamma biznes-operatsiya prisma.$transaction ICHIDA — atomic.

type Tx = Prisma.TransactionClient;

const STATUS = {
  PENDING: 'p',
  APPROVED: 'a',
  REJECTED: 'r',
} as const;

interface AuthUser {
  id: number;
  isSuperuser: boolean;
}

// ─────────────────────────────────────────────
// Permission helpers (Django: _validate_permissions / _validate_transfer_action)
// `store_links` = StoreUser (is_active=True) bog'lanishlari.
// ─────────────────────────────────────────────

// create uchun: faqat o'ziga biriktirilgan from_store dan transfer qilish mumkin.
async function validatePermissions(db: Tx, user: AuthUser, fromStoreId: number): Promise<void> {
  if (user.isSuperuser) return;

  const link = await db.storeUser.findFirst({
    where: { userId: user.id, storeId: fromStoreId, isActive: true },
    select: { id: true },
  });
  if (!link) {
    throw new Forbidden({ detail: "Siz faqat o'zingizga biriktirilgan storedan transfer qila olasiz" });
  }
}

// approve/reject uchun: faqat to_store ga biriktirilgan foydalanuvchi boshqaradi.
async function validateTransferAction(db: Tx, user: AuthUser, toStoreId: number): Promise<void> {
  if (user.isSuperuser) return;

  const link = await db.storeUser.findFirst({
    where: { userId: user.id, storeId: toStoreId, isActive: true },
    select: { id: true },
  });
  if (!link) {
    throw new Forbidden({ detail: 'Siz ushbu transferni boshqara olmaysiz' });
  }
}

// ─────────────────────────────────────────────
// CREATE  (Django: TransferService.create_transfer)
//   from_store -> to_store, items, status pending. Har item uchun from_store
//   ProductBatch dan stock yetarliligini tekshiradi, narxlar batchdan olinadi.
// ─────────────────────────────────────────────
export async function createTransfer(opts: {
  companyId: number;
  data: TransferCreateInput;
  user: AuthUser;
}): Promise<{ id: number; status: string }> {
  const { companyId, data, user } = opts;

  // Serializer relation validatsiyasi: storelar active, productlar active (tenant scope).
  const [fromStore, toStore] = await Promise.all([
    prisma.store.findFirst({ where: { id: data.from_store, companyId, isActive: true }, select: { id: true } }),
    prisma.store.findFirst({ where: { id: data.to_store, companyId, isActive: true }, select: { id: true } }),
  ]);
  if (!fromStore) {
    throw new ValidationError({ from_store: ['Invalid pk - object does not exist.'] });
  }
  if (!toStore) {
    throw new ValidationError({ to_store: ['Invalid pk - object does not exist.'] });
  }

  const productIds = data.items.map((i) => i.product);
  const activeProducts = await prisma.product.findMany({
    where: { id: { in: productIds }, companyId, status: 'a' },
    select: { id: true, name: true },
  });
  const productById = new Map(activeProducts.map((p) => [p.id, p]));
  for (const item of data.items) {
    if (!productById.has(item.product)) {
      throw new ValidationError({ items: [{ product: ['Invalid pk - object does not exist.'] }] });
    }
  }

  const transfer = await prisma.$transaction(async (tx) => {
    await validatePermissions(tx, user, data.from_store);

    const created = await tx.stockTransfer.create({
      data: {
        companyId,
        fromStoreId: data.from_store,
        toStoreId: data.to_store,
        status: STATUS.PENDING,
        createdById: user.id,
      },
    });

    for (const item of data.items) {
      // Django: ProductBatch.objects.select_for_update().get(store=from_store, product=...)
      // .get() topilmasa DoesNotExist (500) bo'lardi; bu yerda aniqroq xato qaytaramiz.
      const batch = await tx.productBatch.findFirst({
        where: { companyId, storeId: data.from_store, productId: item.product },
      });
      if (!batch) {
        const name = productById.get(item.product)?.name ?? item.product;
        throw new ValidationError({ detail: `${name} uchun yetarli stock yo'q` });
      }
      if (batch.quantity < item.quantity) {
        const name = productById.get(item.product)?.name ?? item.product;
        throw new ValidationError({ detail: `${name} uchun yetarli stock yo'q` });
      }

      await tx.stockTransferItem.create({
        data: {
          stockTransferId: created.id,
          productId: item.product,
          quantity: item.quantity,
          purchasePrice: batch.purchasePrice,
          sellingPrice: batch.sellingPrice,
        },
      });
    }

    // 🔥 EVENT: notify_transfer_created (to_store userlari uchun DB Notification).
    const withStores = await tx.stockTransfer.findUniqueOrThrow({
      where: { id: created.id },
      include: { fromStore: { select: { name: true } }, toStore: { select: { name: true } } },
    });
    await notifyTransferCreated(tx, withStores);

    return created;
  });

  return { id: transfer.id, status: transfer.status };
}

// ─────────────────────────────────────────────
// APPROVE  (Django: TransferService.approve_transfer)
//   from_store ProductBatch kamayadi, to_store ProductBatch oshadi (yoki yaratiladi),
//   status -> approved, approved_by/approved_at. Inventory hook (OUT + IN).
// ─────────────────────────────────────────────
export async function approveTransfer(opts: {
  companyId: number;
  transferId: number;
  user: AuthUser;
}): Promise<{ status: 'approved' }> {
  const { companyId, transferId, user } = opts;

  await prisma.$transaction(async (tx) => {
    // Django: select_for_update().get(id=...) — topilmasa DoesNotExist. Tenant scope.
    const transfer = await tx.stockTransfer.findFirst({
      where: { id: transferId, companyId },
      include: { items: true },
    });
    if (!transfer) throw new NotFound();

    await validateTransferAction(tx, user, transfer.toStoreId);

    if (transfer.status !== STATUS.PENDING) {
      throw new ValidationError({ detail: 'Transfer yakunlangan' });
    }

    const lines: { productId: number; quantity: number }[] = [];

    for (const item of transfer.items) {
      // manba batch (Django: select_for_update().get)
      const sourceBatch = await tx.productBatch.findFirst({
        where: { companyId, storeId: transfer.fromStoreId, productId: item.productId },
      });
      if (!sourceBatch) {
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true } });
        throw new ValidationError({ detail: `${product?.name ?? item.productId} yetishmayapti` });
      }
      if (sourceBatch.quantity < item.quantity) {
        const product = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true } });
        throw new ValidationError({ detail: `${product?.name ?? item.productId} yetishmayapti` });
      }

      await tx.productBatch.update({
        where: { id: sourceBatch.id },
        data: { quantity: { decrement: item.quantity } },
      });

      // maqsad batch — get_or_create
      const targetBatch = await tx.productBatch.findFirst({
        where: { companyId, storeId: transfer.toStoreId, productId: item.productId },
      });
      if (targetBatch) {
        await tx.productBatch.update({
          where: { id: targetBatch.id },
          data: { quantity: { increment: item.quantity } },
        });
      } else {
        await tx.productBatch.create({
          data: {
            companyId,
            storeId: transfer.toStoreId,
            productId: item.productId,
            quantity: item.quantity,
            purchasePrice: item.purchasePrice,
            sellingPrice: item.sellingPrice,
          },
        });
      }

      lines.push({ productId: item.productId, quantity: item.quantity });
    }

    await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: STATUS.APPROVED,
        approvedById: user.id,
        approvedAt: new Date(),
      },
    });

    // Inventory hooklar: OUT (manba) + IN (qabul qiluvchi).
    await handleTransferApproved(
      { fromStoreId: transfer.fromStoreId, transferId: transfer.id, lines },
      tx,
    );
    await handleTransferIn(
      { toStoreId: transfer.toStoreId, transferId: transfer.id, lines },
      tx,
    );

    // Django manbada approve uchun Notification YO'Q (notify_transfer_approved mavjud emas).
    // Notification.Type.TRANSFER_APPROVED ("ta") aniqlangan, lekin chaqirilmaydi — SODIQ.
  });

  return { status: 'approved' };
}

// ─────────────────────────────────────────────
// REJECT  (Django: TransferService.reject_transfer)
//   status -> rejected, approved_by/approved_at. notify_transfer_rejected.
// ─────────────────────────────────────────────
export async function rejectTransfer(opts: {
  companyId: number;
  transferId: number;
  user: AuthUser;
}): Promise<{ status: 'rejected' }> {
  const { companyId, transferId, user } = opts;

  await prisma.$transaction(async (tx) => {
    const transfer = await tx.stockTransfer.findFirst({
      where: { id: transferId, companyId },
      include: { fromStore: { select: { name: true } }, toStore: { select: { name: true } } },
    });
    if (!transfer) throw new NotFound();

    await validateTransferAction(tx, user, transfer.toStoreId);

    if (transfer.status !== STATUS.PENDING) {
      throw new ValidationError({ detail: 'Transfer allaqachon yakunlangan' });
    }

    await tx.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: STATUS.REJECTED,
        approvedById: user.id,
        approvedAt: new Date(),
      },
    });

    // 🔥 EVENT: notify_transfer_rejected (from_store userlari + initiator).
    await notifyTransferRejected(tx, transfer);
  });

  return { status: 'rejected' };
}

// ─────────────────────────────────────────────
// LIST  (Django: TransferListAPIView -> TransferListSerializer)
//   Filtrlar: search (do'kon/mahsulot nomi), status (p/a/r), date_from/date_to.
//   Server-side pagination (page/limit) — eksport ham shu where'ni ishlatadi.
// ─────────────────────────────────────────────

export interface TransferListFilters {
  search?: string | null;
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export function buildTransferWhere(
  companyId: number,
  filters: TransferListFilters,
): Prisma.StockTransferWhereInput {
  const where: Prisma.StockTransferWhereInput = { companyId };
  if (filters.status) where.status = filters.status;
  if (filters.search) {
    const q = filters.search;
    where.OR = [
      { fromStore: { name: { contains: q, mode: 'insensitive' } } },
      { toStore: { name: { contains: q, mode: 'insensitive' } } },
      { items: { some: { product: { name: { contains: q, mode: 'insensitive' } } } } },
    ];
  }
  if (filters.dateFrom || filters.dateTo) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.dateFrom) createdAt.gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
    if (filters.dateTo) createdAt.lte = new Date(`${filters.dateTo}T23:59:59.999Z`);
    where.createdAt = createdAt;
  }
  return where;
}

function serializeTransferItem(item: {
  id: number;
  productId: number;
  quantity: number;
  purchasePrice: Prisma.Decimal;
  sellingPrice: Prisma.Decimal;
  product: { name: string; sku: string | null } | null;
}) {
  return {
    id: item.id,
    product: item.productId,
    product_name: item.product?.name ?? '',
    sku: item.product?.sku ?? null,
    quantity: item.quantity,
    purchase_price: Number(item.purchasePrice).toFixed(2),
    selling_price: Number(item.sellingPrice).toFixed(2),
  };
}

export async function listTransfers(opts: {
  companyId: number;
  filters: TransferListFilters;
  skip: number;
  take: number;
}) {
  const where = buildTransferWhere(opts.companyId, opts.filters);

  const [count, transfers] = await prisma.$transaction([
    prisma.stockTransfer.count({ where }),
    prisma.stockTransfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: opts.skip,
      take: opts.take,
      include: {
        fromStore: { select: { name: true } },
        toStore: { select: { name: true } },
        approvedBy: { select: { fullName: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    }),
  ]);

  const results = transfers.map((t) => ({
    id: t.id,
    from_store: t.fromStoreId,
    from_store_name: t.fromStore?.name ?? '',
    to_store: t.toStoreId,
    to_store_name: t.toStore?.name ?? '',
    status: t.status,
    created_at: t.createdAt,
    created_by: t.createdById,
    approved_by: t.approvedById,
    approved_by_name: t.approvedBy?.fullName ?? '',
    approved_at: t.approvedAt,
    items: t.items.map(serializeTransferItem),
  }));

  return { results, count };
}

// ─────────────────────────────────────────────
// NOTIFICATIONS LIST  (Django: NotificationListAPIView)
//   request.user bo'yicha filtrlangan, -created_at, [:50].
// ─────────────────────────────────────────────
export async function listNotifications(companyId: number, userId: number) {
  const notifications = await prisma.notification.findMany({
    where: { companyId, userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return notifications.map((n) => ({
    id: n.id,
    user: n.userId,
    type: n.type,
    title: n.title,
    message: n.message,
    is_read: n.isRead,
    transfer: n.transferId,
  }));
}
