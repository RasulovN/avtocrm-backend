import type { Prisma, User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { buildSaleItemStoreWhere } from './storeScope.js';

// ─────────────────────────────────────────────
//  Top products — Django apps/reports/services/top_product_service.py
//  TopProductsAPIView uchun. StoreFilterService permission-checked scope.
//  Natija: [{ product_id, name, total_sold }] — sotilgan miqdor bo'yicha.
// ─────────────────────────────────────────────

export async function getTopProducts(params: {
  companyId: number;
  user: User;
  dateFrom: Date;
  dateTo: Date;
  limit: number;
  storeId: string | undefined;
}) {
  const { companyId, user, dateFrom, dateTo, limit, storeId } = params;

  const storeWhere = await buildSaleItemStoreWhere(user, companyId, storeId);

  const where: Prisma.SaleItemWhereInput = {
    sale: {
      createdAt: { gte: dateFrom, lte: dateTo },
      ...((storeWhere as { sale?: Record<string, unknown> }).sale ?? {}),
    },
  };

  const grouped = await prisma.saleItem.groupBy({
    by: ['productId'],
    where,
    _sum: { quantity: true },
    // order_by("-total_sold", "product_id")
    orderBy: [
      { _sum: { quantity: 'desc' } },
      { productId: 'asc' },
    ],
    take: limit,
  });

  const productIds = grouped.map((g) => g.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(products.map((p) => [p.id, p.name]));

  return grouped.map((g) => ({
    product_id: g.productId,
    name: nameMap.get(g.productId) ?? null,
    total_sold: g._sum.quantity ?? 0,
  }));
}
