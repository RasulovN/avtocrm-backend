import type { Prisma, PrismaClient } from '@prisma/client';

// prisma yoki $transaction klienti — har ikkalasi ham qabul qilinadi.
type Db = PrismaClient | Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────
// Obunani faollashtirishda start/end oynasini hisoblaymiz.
// Muddat = plan.durationDays * periodMonths kun.
//
// MUDDATNI UZAYTIRISH (oldindan to'lov):
// Agar shu kompaniya + AYNAN SHU tarif bo'yicha hali tugamagan (endAt kelajakda)
// boshqa faol obuna bo'lsa — yangi muddat o'sha tugash sanasidan boshlab qo'shiladi
// (vaqt yo'qolmaydi). Aks holda — bugundan boshlanadi.
// ─────────────────────────────────────────────
export async function computeActivationWindow(
  db: Db,
  sub: {
    id: number;
    companyId: number;
    planId: number;
    periodMonths: number;
    plan: { durationDays: number };
  },
  now: Date = new Date(),
): Promise<{ startAt: Date; endAt: Date }> {
  const months = sub.periodMonths && sub.periodMonths > 0 ? sub.periodMonths : 1;
  const totalDays = sub.plan.durationDays * months;

  const ongoing = await db.subscription.findFirst({
    where: {
      companyId: sub.companyId,
      planId: sub.planId,
      status: 'active',
      id: { not: sub.id },
      endAt: { gt: now },
    },
    orderBy: { endAt: 'desc' },
    select: { endAt: true },
  });

  const base =
    ongoing?.endAt && ongoing.endAt.getTime() > now.getTime() ? ongoing.endAt : now;

  return {
    startAt: base,
    endAt: new Date(base.getTime() + totalDays * DAY_MS),
  };
}
