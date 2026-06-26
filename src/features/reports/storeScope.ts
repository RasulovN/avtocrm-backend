import type { User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { Forbidden } from '../../common/errors.js';

// ─────────────────────────────────────────────
//  Store scope yordamchilari (SaaS — companyId bilan tenant-scoped)
//  Django apps/reports/services/store_scope_service.py +
//  top_product_service.py:StoreFilterService mantig'i.
//  DIQQAT: bu modul kompaniya hisoboti. Shuning uchun store'lar HAR DOIM
//  req.companyId doirasida cheklanadi (superuser bo'lsa ham).
// ─────────────────────────────────────────────

// StoreScopeService.get_user_stores(user):
//   superuser -> shu company'dagi barcha store'lar
//   aks holda -> faol StoreUser link'lari (shu company doirasidagi store'lar)
export async function getUserStores(user: User, companyId: number): Promise<number[]> {
  if (user.isSuperuser) {
    // super admin bo'lsa ham — faqat joriy company store'lari
    const stores = await prisma.store.findMany({
      where: { companyId },
      select: { id: true },
    });
    return stores.map((s) => s.id);
  }
  const links = await prisma.storeUser.findMany({
    where: { userId: user.id, isActive: true, store: { companyId } },
    select: { storeId: true },
  });
  return links.map((l) => l.storeId);
}

// top_product_service.py: StoreFilterService.apply_store_filter
// SaleItem queryslari uchun `sale.storeId` + `sale.companyId` bo'yicha where quradi.
//   superuser:
//     store_id berilgan (va company'ga tegishli) -> { sale: { companyId, storeId } }
//     aks holda                                   -> { sale: { companyId } }
//   oddiy user:
//     base: { sale: { companyId, storeId: { in: userStoreIds } } }
//     store_id berilgan va unga access yo'q -> Forbidden
//     store_id berilgan -> { sale: { companyId, storeId } }
export async function buildSaleItemStoreWhere(
  user: User,
  companyId: number,
  storeId: string | undefined | null,
): Promise<{ sale: Record<string, unknown> }> {
  if (user.isSuperuser) {
    if (storeId) {
      const sid = Number(storeId);
      // super admin bo'lsa ham store joriy company'ga tegishli bo'lishi shart
      const store = await prisma.store.findFirst({
        where: { id: sid, companyId },
        select: { id: true },
      });
      if (!store) {
        throw new Forbidden({ detail: "Sizda bu storega access yo‘q" });
      }
      return { sale: { companyId, storeId: sid } };
    }
    return { sale: { companyId } };
  }

  const userStoreIds = await getUserStores(user, companyId);

  if (storeId) {
    const sid = Number(storeId);
    if (!userStoreIds.includes(sid)) {
      throw new Forbidden({ detail: "Sizda bu storega access yo‘q" });
    }
    return { sale: { companyId, storeId: sid } };
  }

  return { sale: { companyId, storeId: { in: userStoreIds } } };
}
