import type { Lead } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound } from '../../common/errors.js';
import { sendMail } from '../../common/email.js';
import { pushNotifications } from '../notifications/notification.service.js';
import type { LeadCreateInput, LeadUpdateInput } from './leads.schemas.js';

export function serializeLead(l: Lead) {
  return {
    id: l.id,
    name: l.name,
    phone: l.phone,
    email: l.email,
    company: l.company,
    stores_range: l.storesRange,
    message: l.message,
    source: l.source,
    status: l.status,
    locale: l.locale,
    note: l.note,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
  };
}

// Super adminlarni yangi zayavka haqida xabardor qiladi (DB + socket).
async function notifySuperAdmins(lead: Lead): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { isSuperuser: true, isActive: true },
    select: { id: true },
  });
  if (!admins.length) return;
  await pushNotifications({
    userIds: admins.map((a) => a.id),
    type: 'lead',
    title: 'Yangi demo zayavka',
    message: `${lead.name}${lead.company ? ` · ${lead.company}` : ''} · ${lead.phone}`,
    link: '/admin/leads',
  });
}

// Status o'zgarganda mijozga yuboriladigan lokalizatsiyalangan email matni.
function statusEmail(lead: Lead, status: string): { subject: string; text: string } | null {
  const loc = (lead.locale || 'uz').toLowerCase()
  const lang = loc.startsWith('ru') ? 'ru' : loc.startsWith('en') ? 'en' : 'uz'
  const T = {
    approved: {
      uz: {
        subject: 'Murojaatingiz tasdiqlandi — Zumex',
        text: `Hurmatli ${lead.name}!\n\nSizning Zumex demo so'rovingiz tasdiqlandi. Tez orada mutaxassisimiz siz bilan bog'lanadi.\n\nQiziqishingiz uchun rahmat!\nZumex jamoasi`,
      },
      ru: {
        subject: 'Ваша заявка одобрена — Zumex',
        text: `Уважаемый(ая) ${lead.name}!\n\nВаша заявка на демо Zumex одобрена. Наш специалист свяжется с вами в ближайшее время.\n\nСпасибо за интерес!\nКоманда Zumex`,
      },
      en: {
        subject: 'Your request was approved — Zumex',
        text: `Dear ${lead.name},\n\nYour Zumex demo request has been approved. Our specialist will contact you shortly.\n\nThank you for your interest!\nThe Zumex team`,
      },
    },
    rejected: {
      uz: {
        subject: "Murojaatingiz bo'yicha javob — Zumex",
        text: `Hurmatli ${lead.name}!\n\nAfsuski, sizning demo so'rovingiz hozircha rad etildi. Savollaringiz bo'lsa, biz bilan bog'lanishingiz mumkin.\n\nQiziqishingiz uchun rahmat!\nZumex jamoasi`,
      },
      ru: {
        subject: 'Ответ по вашей заявке — Zumex',
        text: `Уважаемый(ая) ${lead.name}!\n\nК сожалению, ваша заявка на демо отклонена. Если у вас есть вопросы, свяжитесь с нами.\n\nСпасибо за интерес!\nКоманда Zumex`,
      },
      en: {
        subject: 'Response to your request — Zumex',
        text: `Dear ${lead.name},\n\nUnfortunately, your demo request has been rejected. If you have any questions, feel free to contact us.\n\nThank you for your interest!\nThe Zumex team`,
      },
    },
  } as const
  const group = (T as Record<string, Record<string, { subject: string; text: string }>>)[status]
  return group ? group[lang] : null
}

export async function createLead(data: LeadCreateInput): Promise<Lead> {
  const lead = await prisma.lead.create({
    data: {
      name: data.name.trim(),
      phone: data.phone.trim(),
      email: data.email.trim(),
      company: data.company?.trim() || null,
      storesRange: data.stores_range?.trim() || null,
      message: data.message?.trim() || null,
      locale: data.locale || null,
      source: 'landing',
    },
  });
  // Bildirishnoma yuborilmasa ham zayavka saqlanib qoladi.
  try {
    await notifySuperAdmins(lead);
  } catch {
    /* notify xato bo'lsa ham zayavka muhim */
  }
  return lead;
}

export async function listLeads(opts: {
  skip: number;
  take: number;
  status?: string;
  search?: string;
}): Promise<{ items: Lead[]; total: number; newCount: number }> {
  const where: Record<string, unknown> = {};
  if (opts.status && opts.status !== 'all') where.status = opts.status;
  if (opts.search) {
    where.OR = [
      { name: { contains: opts.search, mode: 'insensitive' } },
      { phone: { contains: opts.search, mode: 'insensitive' } },
      { company: { contains: opts.search, mode: 'insensitive' } },
    ];
  }
  const [items, total, newCount] = await Promise.all([
    prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, skip: opts.skip, take: opts.take }),
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { status: 'new' } }),
  ]);
  return { items, total, newCount };
}

export async function getLead(id: number): Promise<Lead> {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw new NotFound({ detail: 'Zayavka topilmadi.' });
  return lead;
}

export async function updateLead(id: number, data: LeadUpdateInput): Promise<Lead> {
  const prev = await getLead(id);
  const lead = await prisma.lead.update({
    where: { id },
    data: {
      status: data.status,
      note: data.note === undefined ? undefined : data.note ?? null,
    },
  });
  // Status "approved"/"rejected" ga o'zgarsa — mijoz emailiga xabar yuboramiz.
  const changed = data.status && data.status !== prev.status;
  if (changed && (data.status === 'approved' || data.status === 'rejected') && lead.email) {
    const mail = statusEmail(lead, data.status);
    if (mail) {
      try {
        await sendMail({ to: lead.email, subject: mail.subject, text: mail.text });
      } catch {
        /* email yuborilmasa ham status yangilanishi muhim */
      }
    }
  }
  return lead;
}

export async function deleteLead(id: number): Promise<void> {
  await getLead(id);
  await prisma.lead.delete({ where: { id } });
}
