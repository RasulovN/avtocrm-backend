import type { Prisma, Subscription } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { BadRequest, NotFound } from '../../common/errors.js';
import type { PageParams } from '../../common/pagination.js';
import { buildCheckoutLink } from '../payments/payme.service.js';
import { sendMail } from '../../common/email.js';
import { noticeEmailHtml } from '../../common/emailTemplates.js';
import { env } from '../../config/env.js';
import { pushNotifications } from '../notifications/notification.service.js';
import { computeActivationWindow } from './subscription.window.js';
import { ALLOWED_MONTHS } from './subscriptions.schemas.js';
import { discountForMonths, discountedAmount } from '../plans/plans.pricing.js';

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

// Payme tranzaksiyasining yengil shakli (chek/to'lov tafsiloti uchun).
type TxLite = {
  paycomId: string;
  state: number;
  amount: Prisma.Decimal;
  createTime: bigint | null;
  performTime: bigint | null;
  cancelTime: bigint | null;
  fiscalUrl: string | null;
};

// Obuna uchun plan ma'lumotini ham qaytaramiz.
type SubscriptionWithRelations = Subscription & {
  plan: { id: number; name: string; durationDays: number; price: Prisma.Decimal } | null;
  company?: { id: number; name: string } | null;
  transactions?: TxLite[];
};

// Obunaga tegishli "asosiy" tranzaksiya (chek uchun): bajarilgani, aks holda oxirgisi.
function pickPrimaryTx(txs?: TxLite[]): TxLite | null {
  if (!txs || txs.length === 0) return null;
  return txs.find((t) => t.state === 2) ?? txs[0];
}

// To'lov cheki tafsiloti (frontend `payment` sifatida o'qiydi).
function serializePayment(txs?: TxLite[]) {
  const tx = pickPrimaryTx(txs);
  if (!tx) return null;
  return {
    payme_id: tx.paycomId, // Payme "To'lov ID"
    state: tx.state, // 1=yaratilgan, 2=to'langan, -1/-2=bekor
    amount_tiyin: tx.amount.toString(),
    create_time: tx.createTime != null ? Number(tx.createTime) : null,
    perform_time: tx.performTime != null ? Number(tx.performTime) : null,
    cancel_time: tx.cancelTime != null ? Number(tx.cancelTime) : null,
    fiscal_url: tx.fiscalUrl, // Soliq (OFD) fiskal chek havolasi (bo'lsa)
  };
}

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
    period_months: s.periodMonths,
    start_at: s.startAt,
    end_at: s.endAt,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    // Nested obyektlar — frontend `s.company?.name` / `s.plan?.name` o'qiydi.
    company: s.company ? { id: s.company.id, name: s.company.name } : null,
    plan: s.plan
      ? { id: s.plan.id, name: s.plan.name, duration_days: s.plan.durationDays }
      : null,
    // To'lov cheki tafsiloti (Payme tranzaksiyasi). Yuklangan bo'lsa qaytariladi.
    payment: serializePayment(s.transactions),
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
export async function createSubscription(companyId: number, planId: number, months = 1) {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) {
    throw new BadRequest({ detail: 'Tanlangan tarif topilmadi yoki faol emas.' });
  }

  const isFree = plan.price.lessThanOrEqualTo(0);

  // Oylar sonini normallashtiramiz: bepul tarif har doim 1 oy, pullik — 1/3/6/12.
  const periodMonths = isFree
    ? 1
    : (ALLOWED_MONTHS as readonly number[]).includes(months)
      ? months
      : 1;

  // ── BEPUL tarif: har bir kompaniya uchun FAQAT BIR MARTA ──
  // Bepul obuna `amount <= 0` bilan aniqlanadi (narx snapshot'i).
  if (isFree) {
    const existingFree = await prisma.subscription.findFirst({
      where: { companyId, amount: { lte: 0 } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existingFree) {
      // Allaqachon faollashtirilgan/tugagan/bekor qilingan bo'lsa — qayta bermaymiz.
      if (existingFree.status !== 'pending') {
        throw new BadRequest({
          detail: 'Bepul tarifdan faqat bir marta foydalanish mumkin. Iltimos, pullik tarifni tanlang.',
        });
      }
      // Hali tasdiqlanmagan so'rov bo'lsa — o'shani qaytaramiz (dublikat yaratmaymiz).
      return {
        subscription: serializeSubscription(existingFree),
        free: true,
        checkout_url: null,
        message: 'Bepul tarif so\'rovi allaqachon yuborilgan. Administrator tasdiqlashini kuting.',
      };
    }
  }

  // Jami summa = tarif narxi * oylar soni * (1 - uzoq muddat chegirmasi).
  // Chegirma faqat pullik tarifda va muddat > 1 oy bo'lganda qo'llanadi.
  const discountPercent = isFree ? 0 : discountForMonths(plan, periodMonths);
  const amount = isFree
    ? plan.price
    : discountedAmount(plan.price, periodMonths, discountPercent);

  // Mavjud to'lanmagan (pending) bir xil so'rovni qayta ishlatamiz — dublikatlar oldini olish.
  const existingPending = await prisma.subscription.findFirst({
    where: { companyId, planId: plan.id, status: 'pending', amount },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });

  const subscription =
    existingPending ??
    (await prisma.subscription.create({
      data: {
        companyId,
        planId: plan.id,
        status: 'pending',
        amount,
        periodMonths,
        startAt: null,
        endAt: null,
      },
      include: { plan: true },
    }));

  // BEPUL tarif (narx 0): Payme'ga o'tmaydi — pending qoladi, super admin tasdiqlaydi.
  if (isFree) {
    return {
      subscription: serializeSubscription(subscription),
      free: true,
      checkout_url: null,
      // Super adminga tasdiqlash uchun so'rov yuborilganini bildiradi.
      message: 'Bepul tarif so\'rovi yuborildi. Administrator tasdiqlashini kuting.',
    };
  }

  // PULLIK tarif: Payme checkout havolasi (summa allaqachon oylarga ko'paytirilgan).
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
// GET /me/history/ — kompaniyaning to'lovlar/obuna tarixi (pagination).
// ─────────────────────────────────────────────
export async function listMyPaymentHistory(companyId: number, page: PageParams) {
  const where: Prisma.SubscriptionWhereInput = { companyId };
  const [rows, count] = await Promise.all([
    prisma.subscription.findMany({
      where,
      include: {
        plan: true,
        transactions: {
          select: { paycomId: true, state: true, amount: true, createTime: true, performTime: true, cancelTime: true, fiscalUrl: true },
          orderBy: { createTime: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: page.skip,
      take: page.take,
    }),
    prisma.subscription.count({ where }),
  ]);
  return { results: rows.map(serializeSubscription), count };
}

// ─────────────────────────────────────────────
// POST /me/:id/cancel — kompaniya admini o'z KUTILAYOTGAN (pending) obunasini bekor qiladi.
// Faqat status='pending' bo'lganlar bekor qilinadi (to'langan obuna emas).
// ─────────────────────────────────────────────
export async function cancelMyPendingSubscription(companyId: number, id: number) {
  const subscription = await prisma.subscription.findFirst({
    where: { id, companyId },
    include: { plan: true },
  });
  if (!subscription) throw new NotFound({ detail: 'Obuna topilmadi.' });
  if (subscription.status !== 'pending') {
    throw new BadRequest({
      detail: 'Faqat kutilayotgan (pending) to\'lovlarni bekor qilish mumkin.',
    });
  }

  // Allaqachon bajarilgan (Performed) Payme tranzaksiyasi bo'lsa — bekor qilmaymiz.
  const performed = await prisma.paymeTransaction.findFirst({
    where: { subscriptionId: id, state: 2 },
    select: { id: true },
  });
  if (performed) {
    throw new BadRequest({
      detail: 'Bu obuna uchun to\'lov amalga oshirilgan — bekor qilib bo\'lmaydi.',
    });
  }

  const updated = await prisma.subscription.update({
    where: { id },
    data: { status: 'cancelled' },
    include: { plan: true, company: { select: { id: true, name: true } } },
  });
  // Bildirishnoma + email (faollashtirilmadi/bekor qilindi).
  try { await notifySubscriptionEvent(id, false); } catch { /* ignore */ }
  return serializeSubscription(updated);
}

// ─────────────────────────────────────────────
// GET / — super admin: barcha obunalar (filter + pagination).
// ─────────────────────────────────────────────
export async function listAllSubscriptions(
  filters: { status?: string; company_id?: number; paid?: boolean },
  page: PageParams,
) {
  const where: Prisma.SubscriptionWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.company_id) where.companyId = filters.company_id;
  // To'lovlar sahifasi: faqat haqiqiy Payme to'lovi (state=2) bo'lgan obunalar.
  if (filters.paid) where.transactions = { some: { state: 2 } };

  const [rows, count] = await Promise.all([
    prisma.subscription.findMany({
      where,
      include: {
        plan: true,
        company: { select: { id: true, name: true } },
        transactions: {
          select: { paycomId: true, state: true, amount: true, createTime: true, performTime: true, cancelTime: true, fiscalUrl: true },
          orderBy: { createTime: 'desc' },
        },
      },
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
    const updated = await prisma.$transaction(async (tx) => {
      // Oldindan to'lov/uzaytirish logikasi: agar shu tarif bo'yicha tugamagan
      // obuna bo'lsa muddat o'sha tugash sanasidan boshlab qo'shiladi.
      const { startAt, endAt } = await computeActivationWindow(tx, subscription);
      const sub = await tx.subscription.update({
        where: { id },
        data: { status: 'active', startAt, endAt },
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

// ─────────────────────────────────────────────
// PUT /:id/fiscal — super admin obunaga soliq (OFD) fiskal chek havolasini biriktiradi.
// Payme kabinetidagi to'lov cheki havolasini (https://ofd.soliq.uz/epi?...) qo'yadi.
// Mijoz keyin uni QR + havola sifatida ko'radi (qonuniy talab).
// ─────────────────────────────────────────────
const TX_SELECT = {
  paycomId: true, state: true, amount: true,
  createTime: true, performTime: true, cancelTime: true, fiscalUrl: true,
} as const;

export async function setSubscriptionFiscal(subscriptionId: number, fiscalUrl: string | null) {
  const sub = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) throw new NotFound({ detail: 'Obuna topilmadi.' });

  // Asosiy tranzaksiya: bajarilgani (state=2), aks holda oxirgisi.
  const tx = await prisma.paymeTransaction.findFirst({
    where: { subscriptionId },
    orderBy: [{ state: 'desc' }, { createTime: 'desc' }],
  });
  if (!tx) throw new BadRequest({ detail: "Bu obuna uchun Payme tranzaksiyasi topilmadi." });

  const url = fiscalUrl?.trim() || null;
  if (url && !/^https?:\/\//i.test(url)) {
    throw new BadRequest({ detail: "Fiskal havola http(s):// bilan boshlanishi kerak." });
  }

  await prisma.paymeTransaction.update({ where: { id: tx.id }, data: { fiscalUrl: url } });

  const updated = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      plan: true,
      company: { select: { id: true, name: true } },
      transactions: { select: TX_SELECT, orderBy: { createTime: 'desc' } },
    },
  });
  return serializeSubscription(updated!);
}
