import type { Prisma, Subscription } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { BadRequest, NotFound } from '../../common/errors.js';
import type { PageParams } from '../../common/pagination.js';
import { buildCheckoutLink } from '../payments/payme.service.js';
import { sendMail } from '../../common/email.js';
import { noticeEmailHtml } from '../../common/emailTemplates.js';
import { env } from '../../config/env.js';
import { pushNotifications } from '../notifications/notification.service.js';

// ─────────────────────────────────────────────
// Obuna holati o'zgarganda kompaniyaga bildirishnoma (tizim) + email.
// activated=true: "faollashtirildi" (register tugmasi bilan), false: "faollashtirilmadi".
// ─────────────────────────────────────────────
function fmtDate(d: Date | null): string {
  if (!d) return '';
  try { return new Intl.DateTimeFormat('uz-UZ', { dateStyle: 'long' }).format(d); } catch { return ''; }
}

export async function notifySubscriptionEvent(subscriptionId: number, activated: boolean): Promise<void> {
  const sub = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { plan: true, company: { select: { id: true, name: true, email: true, owner: { select: { email: true } } } } },
  });
  if (!sub || !sub.company) return;
  const planName = sub.plan?.name ?? 'Obuna';
  const companyName = sub.company.name;
  const until = activated && sub.endAt ? fmtDate(sub.endAt) : '';

  // 1) Tizim bildirishnomasi — kompaniyaning barcha foydalanuvchilariga.
  try {
    const users = await prisma.user.findMany({
      where: { companyId: sub.company.id, isActive: true },
      select: { id: true },
    });
    if (users.length) {
      await pushNotifications({
        userIds: users.map((u) => u.id),
        companyId: sub.company.id,
        type: 'subscription',
        title: activated ? 'Obuna faollashtirildi' : 'Obuna faollashtirilmadi',
        message: activated
          ? `${planName} tarifi faollashtirildi${until ? ` · ${until} gacha` : ''}.`
          : `${planName} obunasi faollashtirilmadi yoki bekor qilindi.`,
        link: '/subscription',
      });
    }
  } catch { /* bildirishnoma xato bo'lsa ham davom etamiz */ }

  // 2) Email — kompaniya yoki egasi manziliga, chiroyli dizaynda.
  const to = sub.company.email || sub.company.owner?.email;
  if (!to) return;
  const appUrl = (env.FRONTEND_URL || 'https://zumex.uz').replace(/\/+$/, '');
  try {
    if (activated) {
      await sendMail({
        to,
        subject: 'Obunangiz faollashtirildi — Zumex',
        html: noticeEmailHtml({
          title: 'Obuna faollashtirildi',
          heading: 'Obunangiz faollashtirildi 🎉',
          intro: `Hurmatli ${companyName}! "${planName}" tarifi muvaffaqiyatli faollashtirildi.${until ? ` Obuna ${until} gacha amal qiladi.` : ''} Endi Zumex tizimining barcha imkoniyatlaridan foydalanishingiz mumkin.`,
          buttonText: 'Tizimga kirish',
          buttonUrl: `${appUrl}/login`,
          footnote: 'Savollaringiz bo\'lsa biz bilan bog\'laning. Zumex bilan biznesingizni o\'stiring!',
        }),
        text: `Hurmatli ${companyName}! "${planName}" tarifi faollashtirildi${until ? ` (${until} gacha)` : ''}.\nTizimga kirish: ${appUrl}/login\n\nZumex jamoasi`,
      });
    } else {
      await sendMail({
        to,
        subject: 'Obuna holati — Zumex',
        html: noticeEmailHtml({
          title: 'Obuna holati',
          heading: 'Obuna faollashtirilmadi',
          intro: `Hurmatli ${companyName}! "${planName}" obunangiz faollashtirilmadi yoki bekor qilindi. Bu vaqtinchalik bo'lishi mumkin — to'lovni qayta amalga oshirish yoki boshqa tarifni tanlash mumkin.`,
          buttonText: 'Tariflarni ko\'rish',
          buttonUrl: `${appUrl}/login`,
          footnote: 'Savollaringiz bo\'lsa biz bilan bog\'laning — yordam beramiz.',
        }),
        text: `Hurmatli ${companyName}! "${planName}" obunangiz faollashtirilmadi yoki bekor qilindi.\n\nZumex jamoasi`,
      });
    }
  } catch { /* email xato bo'lsa ham obuna holati muhim */ }
}

function decimalToString(value: Prisma.Decimal): string {
  return value.toString();
}

// Obuna uchun plan ma'lumotini ham qaytaramiz.
type SubscriptionWithRelations = Subscription & {
  plan: { id: number; name: string; durationDays: number; price: Prisma.Decimal } | null;
  company?: { id: number; name: string } | null;
};

// Subscription -> snake_case javob.
// Eslatma: tekis maydonlar (company_name, plan_name, ...) eski klientlar uchun
// saqlanadi; nested `company` / `plan` obyektlari yangi UI (super admin) uchun.
export function serializeSubscription(s: SubscriptionWithRelations) {
  return {
    id: s.id,
    company_id: s.companyId,
    company_name: s.company?.name ?? null,
    plan_id: s.planId,
    plan_name: s.plan?.name ?? null,
    plan_duration_days: s.plan?.durationDays ?? null,
    status: s.status,
    amount: decimalToString(s.amount),
    start_at: s.startAt,
    end_at: s.endAt,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    // Nested obyektlar — frontend `s.company?.name` / `s.plan?.name` o'qiydi.
    company: s.company ? { id: s.company.id, name: s.company.name } : null,
    plan: s.plan
      ? { id: s.plan.id, name: s.plan.name, duration_days: s.plan.durationDays }
      : null,
  };
}

function daysLeft(endAt: Date | null): number | null {
  if (!endAt) return null;
  const ms = endAt.getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// Faol obuna: status='active' va (endAt yo'q yoki kelajakda).
function isActiveSub(s: { status: string; endAt: Date | null }): boolean {
  return s.status === 'active' && (!s.endAt || s.endAt.getTime() > Date.now());
}

// ─────────────────────────────────────────────
// POST / — kompaniya obuna yaratadi + Payme checkout havolasi.
// ─────────────────────────────────────────────
export async function createSubscription(companyId: number, planId: number) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) {
    throw new BadRequest({ detail: 'Tanlangan tarif topilmadi yoki faol emas.' });
  }

  const subscription = await prisma.subscription.create({
    data: {
      companyId,
      planId: plan.id,
      status: 'pending',
      amount: plan.price,
      startAt: null,
      endAt: null,
    },
    include: { plan: true },
  });

  // BEPUL tarif (narx 0): Payme'ga o'tmaydi — pending qoladi, super admin tasdiqlaydi.
  const isFree = plan.price.lessThanOrEqualTo(0);
  if (isFree) {
    return {
      subscription: serializeSubscription(subscription),
      free: true,
      checkout_url: null,
      // Super adminga tasdiqlash uchun so'rov yuborilganini bildiradi.
      message: 'Bepul tarif so\'rovi yuborildi. Administrator tasdiqlashini kuting.',
    };
  }

  // PULLIK tarif: Payme checkout havolasi.
  const checkout = buildCheckoutLink(subscription);

  return {
    subscription: serializeSubscription(subscription),
    free: false,
    checkout_url: checkout.checkout_url,
    payme: {
      merchant_id_set: true,
      amount_tiyin: checkout.amount_tiyin,
      account_field: 'subscription_id',
      account_value: subscription.id,
    },
  };
}

// ─────────────────────────────────────────────
// GET /me/ — kompaniya obunalari (joriy faol + tarix).
// ─────────────────────────────────────────────
export async function listMySubscriptions(companyId: number) {
  const subscriptions = await prisma.subscription.findMany({
    where: { companyId },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });

  const active = subscriptions.find(isActiveSub) ?? null;

  return {
    active: active ? serializeSubscription(active) : null,
    history: subscriptions.map(serializeSubscription),
  };
}

// ─────────────────────────────────────────────
// GET /me/active/ — faol obuna yoki null + qolgan kunlar.
// ─────────────────────────────────────────────
export async function getMyActiveSubscription(companyId: number) {
  const subscriptions = await prisma.subscription.findMany({
    where: { companyId, status: 'active' },
    include: { plan: true },
    orderBy: { endAt: 'desc' },
  });

  const active = subscriptions.find(isActiveSub) ?? null;
  if (!active) {
    return { active: null, days_left: null };
  }

  return {
    active: serializeSubscription(active),
    days_left: daysLeft(active.endAt),
  };
}

// ─────────────────────────────────────────────
// GET / — super admin: barcha obunalar (filter + pagination).
// ─────────────────────────────────────────────
export async function listAllSubscriptions(
  filters: { status?: string; company_id?: number },
  page: PageParams,
) {
  const where: Prisma.SubscriptionWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.company_id) where.companyId = filters.company_id;

  const [rows, count] = await Promise.all([
    prisma.subscription.findMany({
      where,
      include: { plan: true, company: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      skip: page.skip,
      take: page.take,
    }),
    prisma.subscription.count({ where }),
  ]);

  return { results: rows.map(serializeSubscription), count };
}

// ─────────────────────────────────────────────
// PATCH /:id/ — super admin qo'lda status o'zgartiradi.
//   activate -> startAt=now, endAt=now+durationDays, company.status='active'
//   cancel   -> status='cancelled'
// ─────────────────────────────────────────────
export async function patchSubscription(
  id: number,
  action: 'activate' | 'cancel' | 'extend',
  days?: number,
) {
  const subscription = await prisma.subscription.findUnique({
    where: { id },
    include: { plan: true },
  });
  if (!subscription) throw new NotFound({ detail: 'Obuna topilmadi.' });

  if (action === 'activate') {
    const now = new Date();
    const endAt = new Date(now.getTime() + subscription.plan.durationDays * 24 * 60 * 60 * 1000);
    const updated = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.update({
        where: { id },
        data: { status: 'active', startAt: now, endAt },
        include: { plan: true, company: { select: { id: true, name: true } } },
      });
      await tx.company.update({
        where: { id: subscription.companyId },
        data: { status: 'active' },
      });
      return sub;
    });
    await notifySubscriptionEvent(id, true);
    return serializeSubscription(updated);
  }

  if (action === 'extend') {
    // Muddatni uzaytirish: berilgan kun yoki tarif muddati. Joriy endAt kelajakda
    // bo'lsa o'shanga qo'shamiz, aks holda bugundan boshlaymiz.
    const addDays = days && days > 0 ? days : subscription.plan.durationDays;
    const base = subscription.endAt && subscription.endAt.getTime() > Date.now()
      ? subscription.endAt
      : new Date();
    const startAt = subscription.startAt ?? new Date();
    const endAt = new Date(base.getTime() + addDays * 24 * 60 * 60 * 1000);
    const updated = await prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.update({
        where: { id },
        data: { status: 'active', startAt, endAt },
        include: { plan: true, company: { select: { id: true, name: true } } },
      });
      await tx.company.update({ where: { id: subscription.companyId }, data: { status: 'active' } });
      return sub;
    });
    await notifySubscriptionEvent(id, true);
    return serializeSubscription(updated);
  }

  // cancel
  const updated = await prisma.subscription.update({
    where: { id },
    data: { status: 'cancelled' },
    include: { plan: true, company: { select: { id: true, name: true } } },
  });
  await notifySubscriptionEvent(id, false);
  return serializeSubscription(updated);
}
