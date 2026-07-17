import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { Forbidden, NotFound, ValidationError } from '../../common/errors.js';
import type { PageParams } from '../../common/pagination.js';
import { evaluateLowStock } from '../inventory/lowStock.service.js';
import type { WriteOffCreateInput, WriteOffReason, WriteOffUpdateInput } from './writeoff.schemas.js';

// Django apps/writeoff/services/write_off_service.py ekvivalenti.
// Asosiy qoida: hisobdan chiqarilgan mahsulot QOLDIQDAN KAMAYADI (ProductBatch.quantity),
// xuddi sotuv/transfer kabi. Barcha o'zgarishlar bitta tranzaksiya ichida.

type Db = Prisma.TransactionClient | typeof prisma;

interface AuthUser {
  id: number;
  isSuperuser: boolean;
}

// get_reason_display ekvivalenti
export const REASON_LABELS: Record<WriteOffReason, string> = {
  damaged: 'Buzilgan / yaroqsiz',
  expired: "Muddati o'tgan",
  lost: "Yo'qolgan / o'g'irlangan",
  inventory: 'Inventarizatsiya kamomadi',
  catalog: 'Katalogdan chiqarish',
  other: 'Boshqa',
};

function reasonDisplay(reason: string): string {
  return REASON_LABELS[reason as WriteOffReason] ?? reason;
}

function dec(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

// Superuser hamma do'konga; store linklari bo'lmagan foydalanuvchi (owner/admin)
// kompaniyaning istalgan do'koniga; linklari bo'lsa — faqat biriktirilgan do'koniga.
async function assertStoreAccess(db: Db, user: AuthUser, storeId: number): Promise<void> {
  if (user.isSuperuser) return;
  const links = await db.storeUser.findMany({
    where: { userId: user.id, isActive: true },
    select: { storeId: true },
  });
  if (links.length === 0) return;
  if (!links.some((l) => l.storeId === storeId)) {
    throw new Forbidden({ detail: "Siz ushbu do'kon uchun spisaniye qila olmaysiz." });
  }
}

// ─────────────────────────────────────────────
// Serializatsiya (WriteOffListSerializer / WriteOffDetailSerializer)
// ─────────────────────────────────────────────

type WriteOffWithRelations = Prisma.WriteOffGetPayload<{
  include: {
    store: { select: { name: true } };
    createdBy: { select: { fullName: true } };
    items: {
      include: { product: { select: { name: true; sku: true; barcode: true } } };
    };
  };
}>;

function serializeDetail(w: WriteOffWithRelations) {
  return {
    id: w.id,
    store: w.storeId,
    store_name: w.store.name,
    reason: w.reason,
    reason_display: reasonDisplay(w.reason),
    comment: w.comment,
    total_amount: dec(w.totalAmount),
    created_by: w.createdById,
    created_by_name: w.createdBy?.fullName ?? null,
    inventory_session: w.inventorySessionId,
    created_at: w.createdAt,
    items: w.items.map((i) => ({
      id: i.id,
      product: i.productId,
      product_name: i.product.name,
      product_sku: i.product.sku,
      product_barcode: i.product.barcode,
      quantity: i.quantity,
      purchase_price: dec(i.purchasePrice),
      selling_price: dec(i.sellingPrice),
    })),
  };
}

// ─────────────────────────────────────────────
// LIST — store/reason filtr, pagination
// ─────────────────────────────────────────────
export async function listWriteOffs(opts: {
  companyId: number;
  store?: number | null;
  reason?: string | null;
  page: PageParams;
}) {
  const where: Prisma.WriteOffWhereInput = { companyId: opts.companyId };
  if (opts.store != null) where.storeId = opts.store;
  if (opts.reason) where.reason = opts.reason;

  const [count, rows] = await prisma.$transaction([
    prisma.writeOff.count({ where }),
    prisma.writeOff.findMany({
      where,
      skip: opts.page.skip,
      take: opts.page.take,
      orderBy: { createdAt: 'desc' },
      include: {
        store: { select: { name: true } },
        createdBy: { select: { fullName: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  const results = rows.map((w) => ({
    id: w.id,
    store: w.storeId,
    store_name: w.store.name,
    reason: w.reason,
    reason_display: reasonDisplay(w.reason),
    comment: w.comment,
    total_amount: dec(w.totalAmount),
    items_count: w._count.items,
    created_by: w.createdById,
    created_by_name: w.createdBy?.fullName ?? null,
    inventory_session: w.inventorySessionId,
    created_at: w.createdAt,
  }));

  return { results, count };
}

// ─────────────────────────────────────────────
// DETAIL
// ─────────────────────────────────────────────
export async function getWriteOffDetail(pk: number, companyId: number) {
  const w = await prisma.writeOff.findFirst({
    where: { id: pk, companyId },
    include: {
      store: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      items: { include: { product: { select: { name: true, sku: true, barcode: true } } } },
    },
  });
  if (!w) throw new NotFound();
  return serializeDetail(w);
}

// ─────────────────────────────────────────────
// CREATE — stock kamayadi (WriteOffService.create_write_off)
// ─────────────────────────────────────────────
export async function createWriteOff(companyId: number, user: AuthUser, data: WriteOffCreateInput) {
  const store = await prisma.store.findFirst({
    where: { id: data.store, companyId },
    select: { id: true },
  });
  if (!store) throw new ValidationError({ store: ["Do'kon topilmadi."] });

  await assertStoreAccess(prisma, user, data.store);

  // Bitta mahsulot ikki marta kelsa — miqdorlarni yig'amiz
  const merged = new Map<number, number>();
  for (const it of data.items) {
    merged.set(it.product, (merged.get(it.product) ?? 0) + it.quantity);
  }
  const productIds = Array.from(merged.keys());

  const created = await prisma.$transaction(async (tx) => {
    const batches = await tx.productBatch.findMany({
      where: { companyId, storeId: data.store, productId: { in: productIds } },
      select: {
        id: true,
        productId: true,
        quantity: true,
        purchasePrice: true,
        sellingPrice: true,
        product: { select: { name: true } },
      },
    });
    const batchMap = new Map(batches.map((b) => [b.productId, b]));

    let totalAmount = new Prisma.Decimal(0);
    const itemRows: Omit<Prisma.WriteOffItemCreateManyInput, 'writeOffId'>[] = [];

    for (const [productId, qty] of merged) {
      const batch = batchMap.get(productId);
      if (!batch) {
        const p = await tx.product.findFirst({ where: { id: productId, companyId }, select: { name: true } });
        throw new ValidationError(`${p?.name ?? `#${productId}`}: bu do'konda mahsulot qoldig'i yo'q.`);
      }

      // Guard bilan kamaytirish — parallel so'rovlarda minusga tushib ketmasligi uchun
      const updated = await tx.productBatch.updateMany({
        where: { id: batch.id, quantity: { gte: qty } },
        data: { quantity: { decrement: qty } },
      });
      if (updated.count === 0) {
        throw new ValidationError(
          `${batch.product.name}: qoldiq yetarli emas (mavjud: ${batch.quantity}, kerak: ${qty}).`,
        );
      }

      totalAmount = totalAmount.add(batch.purchasePrice.mul(qty));
      itemRows.push({
        productId,
        quantity: qty,
        purchasePrice: batch.purchasePrice,
        sellingPrice: batch.sellingPrice,
      });
    }

    const writeOff = await tx.writeOff.create({
      data: {
        companyId,
        storeId: data.store,
        reason: data.reason,
        comment: data.comment ?? '',
        totalAmount,
        createdById: user.id,
      },
    });

    await tx.writeOffItem.createMany({
      data: itemRows.map((r) => ({ ...r, writeOffId: writeOff.id })),
    });

    // Low-stock baholash (sotuv kabi — qoldiq kamaydi)
    await evaluateLowStock({ store: data.store, productIds, db: tx });

    return writeOff;
  });

  return getWriteOffDetail(created.id, companyId);
}

// ─────────────────────────────────────────────
// INVENTARIZATSIYA KAMOMADI (record-only — stockka TEGMAYDI)
// Qoldiq inventory finalize ichida allaqachon to'g'rilangan; bu yerda faqat
// "nima uchun qoldiq kamaydi" degan tarix/audit yoziladi.
// ─────────────────────────────────────────────
export async function recordInventoryShortage(opts: {
  db: Prisma.TransactionClient;
  companyId: number;
  sessionId: number;
  storeId: number;
  userId?: number | null;
  shortages: Array<{
    productId: number;
    quantity: number;
    purchasePrice: Prisma.Decimal;
    sellingPrice: Prisma.Decimal;
  }>;
}) {
  const shortages = opts.shortages.filter((s) => s.quantity > 0);
  if (shortages.length === 0) return null;

  let totalAmount = new Prisma.Decimal(0);
  for (const s of shortages) {
    totalAmount = totalAmount.add(s.purchasePrice.mul(s.quantity));
  }

  const writeOff = await opts.db.writeOff.create({
    data: {
      companyId: opts.companyId,
      storeId: opts.storeId,
      reason: 'inventory',
      comment: `Inventarizatsiya #${opts.sessionId} kamomadi (avtomatik)`,
      totalAmount,
      createdById: opts.userId ?? null,
      inventorySessionId: opts.sessionId,
    },
  });

  await opts.db.writeOffItem.createMany({
    data: shortages.map((s) => ({
      writeOffId: writeOff.id,
      productId: s.productId,
      quantity: s.quantity,
      purchasePrice: s.purchasePrice,
      sellingPrice: s.sellingPrice,
    })),
  });

  return writeOff;
}

// ─────────────────────────────────────────────
// UPDATE — faqat metama'lumot (sabab/izoh), stockka tegmaydi
// ─────────────────────────────────────────────
export async function updateWriteOff(pk: number, companyId: number, data: WriteOffUpdateInput) {
  const existing = await prisma.writeOff.findFirst({ where: { id: pk, companyId }, select: { id: true } });
  if (!existing) throw new NotFound();

  const updateData: Prisma.WriteOffUpdateInput = {};
  if (data.reason !== undefined) updateData.reason = data.reason;
  if (data.comment !== undefined) updateData.comment = data.comment;
  if (Object.keys(updateData).length > 0) {
    await prisma.writeOff.update({ where: { id: pk }, data: updateData });
  }
  return getWriteOffDetail(pk, companyId);
}

// ─────────────────────────────────────────────
// DELETE — stock QAYTARILADI (xato yozuvni bekor qilish uchun)
// ─────────────────────────────────────────────
export async function deleteWriteOff(pk: number, companyId: number, user: AuthUser) {
  const writeOff = await prisma.writeOff.findFirst({
    where: { id: pk, companyId },
    include: { items: true },
  });
  if (!writeOff) throw new NotFound();

  await assertStoreAccess(prisma, user, writeOff.storeId);

  const productIds = writeOff.items.map((i) => i.productId);

  await prisma.$transaction(async (tx) => {
    for (const item of writeOff.items) {
      const batch = await tx.productBatch.findFirst({
        where: { companyId, storeId: writeOff.storeId, productId: item.productId },
        select: { id: true },
      });
      if (batch) {
        await tx.productBatch.update({
          where: { id: batch.id },
          data: { quantity: { increment: item.quantity } },
        });
      } else {
        // Batch o'chib ketgan bo'lsa — qayta yaratamiz
        await tx.productBatch.create({
          data: {
            companyId,
            storeId: writeOff.storeId,
            productId: item.productId,
            quantity: item.quantity,
            purchasePrice: item.purchasePrice,
            sellingPrice: item.sellingPrice,
          },
        });
      }
    }

    await tx.writeOff.delete({ where: { id: pk } });
    await evaluateLowStock({ store: writeOff.storeId, productIds, db: tx });
  });
}
