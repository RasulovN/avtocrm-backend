import { prisma } from '../db/prisma.js';

// ──────────────────────────────────────────────────────────────
// Mahsulot arxivi hayot sikli (avtomatik):
//   O'chirilgan (arxivlangan) mahsulot 30 kun arxivda saqlanadi,
//   muddati o'tgach BUTUNLAY o'chiriladi.
//   Kirim/sotuvda ishlatilgan mahsulotlar (onDelete: Restrict) o'chirilmaydi —
//   ular arxivda qolaveradi (hisobot tarixini buzmaslik uchun).
// Rejalashtirilgan vazifa (scheduler) chaqiradi.
// ──────────────────────────────────────────────────────────────

const RETENTION_DAYS = 30; // arxivda saqlanish muddati

export interface ProductArchiveLifecycleResult {
  deleted: number;
  skipped: number; // Restrict-bog'liqlik tufayli o'chirilmaganlar
}

export async function runProductArchiveLifecycle(
  now: Date = new Date(),
): Promise<ProductArchiveLifecycleResult> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.product.findMany({
    where: { archivedAt: { not: null, lte: cutoff } },
    select: { id: true },
  });
  if (candidates.length === 0) return { deleted: 0, skipped: 0 };

  const ids = candidates.map((c) => c.id);

  // Restrict-bog'liqliklar (StockEntryItem, SaleItem, WriteOffItem) bor mahsulotlarni ajratamiz
  const [entryRefs, saleRefs, writeOffRefs] = await prisma.$transaction([
    prisma.stockEntryItem.findMany({
      where: { productId: { in: ids } },
      select: { productId: true },
      distinct: ['productId'],
    }),
    prisma.saleItem.findMany({
      where: { productId: { in: ids } },
      select: { productId: true },
      distinct: ['productId'],
    }),
    prisma.writeOffItem.findMany({
      where: { productId: { in: ids } },
      select: { productId: true },
      distinct: ['productId'],
    }),
  ]);
  const referenced = new Set<number>([
    ...entryRefs.map((r) => r.productId),
    ...saleRefs.map((r) => r.productId),
    ...writeOffRefs.map((r) => r.productId),
  ]);

  const deletableIds = ids.filter((id) => !referenced.has(id));
  let deleted = 0;
  if (deletableIds.length > 0) {
    // Rasm/batch yozuvlari cascade bilan o'chadi; fayllar diskda qoladi (best-effort)
    const res = await prisma.product.deleteMany({ where: { id: { in: deletableIds } } });
    deleted = res.count;
  }

  return { deleted, skipped: ids.length - deletableIds.length };
}
