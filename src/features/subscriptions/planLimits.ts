import { prisma } from '../../db/prisma.js';
import { BadRequest } from '../../common/errors.js';

// ─────────────────────────────────────────────
// Tarif (plan) limitlari — do'kon va foydalanuvchi soni.
// Har bir kompaniyaning FAOL obunasidagi tarifdan olinadi. `null` = cheksiz.
// Do'kon/foydalanuvchi yaratish oqimlari shu yerdagi assert* funksiyalari orqali
// limitni majburiy tekshiradi (backend — yagona ishonchli manba). Frontend faqat
// UX uchun (tugmani bloklash) shu ma'lumotdan foydalanadi.
// ─────────────────────────────────────────────

export interface PlanLimits {
  maxStores: number | null; // null = cheksiz
  maxUsers: number | null; // null = cheksiz
  planId: number | null;
  planName: string | null;
}

export interface LimitUsage {
  plan_name: string | null;
  stores: { used: number; max: number | null };
  users: { used: number; max: number | null };
}

// Kompaniyaning FAOL obunasidagi tarif limitlarini qaytaradi.
// Faol obuna: status='active' va endAt yo'q yoki kelajakda.
export async function getPlanLimits(companyId: number): Promise<PlanLimits> {
  const sub = await prisma.subscription.findFirst({
    where: {
      companyId,
      status: 'active',
      OR: [{ endAt: null }, { endAt: { gt: new Date() } }],
    },
    orderBy: { endAt: 'desc' },
    include: { plan: { select: { id: true, name: true, maxStores: true, maxUsers: true } } },
  });
  if (!sub?.plan) {
    // Faol obuna yo'q — do'kon/foydalanuvchi qo'shib bo'lmaydi (obuna gating baribir
    // bloklaydi, lekin bu yerda ham 0 limit bilan xavfsiz tomonga qaramiz).
    return { maxStores: 0, maxUsers: 0, planId: null, planName: null };
  }
  return {
    maxStores: sub.plan.maxStores,
    maxUsers: sub.plan.maxUsers,
    planId: sub.plan.id,
    planName: sub.plan.name,
  };
}

// Joriy foydalanish (do'kon/foydalanuvchi soni) — limitlar bilan birga.
export async function getLimitsAndUsage(companyId: number): Promise<LimitUsage> {
  const [limits, storeCount, userCount] = await Promise.all([
    getPlanLimits(companyId),
    prisma.store.count({ where: { companyId } }),
    prisma.user.count({ where: { companyId } }),
  ]);
  return {
    plan_name: limits.planName,
    stores: { used: storeCount, max: limits.maxStores },
    users: { used: userCount, max: limits.maxUsers },
  };
}

// Yangi do'kon qo'shishdan oldin limitni tekshiradi. Limit to'lgan bo'lsa 400.
export async function assertCanAddStore(companyId: number): Promise<void> {
  const limits = await getPlanLimits(companyId);
  if (limits.maxStores === null) return; // cheksiz
  const count = await prisma.store.count({ where: { companyId } });
  if (count >= limits.maxStores) {
    throw new BadRequest({
      detail: `Tarifingiz${limits.planName ? ` (${limits.planName})` : ''} bo'yicha ${limits.maxStores} ta do'kon ruxsat etilgan. Limit to'ldi — ko'proq do'kon uchun tarifni yangilang.`,
      code: 'store_limit_reached',
      limit: limits.maxStores,
      used: count,
    });
  }
}

// Yangi foydalanuvchi qo'shishdan oldin limitni tekshiradi. Limit to'lgan bo'lsa 400.
export async function assertCanAddUser(companyId: number): Promise<void> {
  const limits = await getPlanLimits(companyId);
  if (limits.maxUsers === null) return; // cheksiz
  const count = await prisma.user.count({ where: { companyId } });
  if (count >= limits.maxUsers) {
    throw new BadRequest({
      detail: `Tarifingiz${limits.planName ? ` (${limits.planName})` : ''} bo'yicha ${limits.maxUsers} ta foydalanuvchi ruxsat etilgan. Limit to'ldi — ko'proq xodim uchun tarifni yangilang.`,
      code: 'user_limit_reached',
      limit: limits.maxUsers,
      used: count,
    });
  }
}
