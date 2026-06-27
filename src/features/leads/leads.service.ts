import type { Lead } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound } from '../../common/errors.js';
import { sendMail } from '../../common/email.js';
import { env } from '../../config/env.js';
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

// Status o'zgarganda mijozga yuboriladigan lokalizatsiyalangan, dizaynli email.
type MailLang = 'uz' | 'ru' | 'en'
interface MailContent {
  subject: string
  badge: string
  heading: string
  greet: string
  body: string
  cta?: string // bo'lsa — register tugmasi
}

function registerUrl(): string {
  const base = (env.FRONTEND_URL || 'https://zumex.uz').replace(/\/+$/, '')
  return `${base}/register?from=lead`
}

// Brendlangan, inline-stilli (email-mos) HTML qobiq.
function emailHtml(c: MailContent, accent: string): string {
  const cta = c.cta
    ? `<tr><td style="padding:6px 28px 4px"><a href="${registerUrl()}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:600;font-size:15px">${c.cta} &nbsp;&rarr;</a></td></tr>`
    : ''
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9">
  <div style="background:#f1f5f9;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e7ebf1">
      <tr><td style="background:linear-gradient(135deg,#1d4ed8,#0ea5e9);padding:22px 28px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="background:rgba(255,255,255,.18);border-radius:9px;width:34px;height:34px;text-align:center;vertical-align:middle;color:#fff;font-weight:800;font-size:18px">Z</td>
          <td style="padding-left:10px;color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-.5px">Zumex</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:26px 28px 4px">
        <span style="display:inline-block;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${accent}">${c.badge}</span>
        <h1 style="font-size:22px;color:#0f172a;margin:8px 0 0;line-height:1.25">${c.heading}</h1>
        <p style="font-size:15px;color:#334155;line-height:1.6;margin:16px 0 0">${c.greet}</p>
        <p style="font-size:15px;color:#334155;line-height:1.6;margin:10px 0 18px">${c.body}</p>
      </td></tr>
      ${cta}
      <tr><td style="padding:22px 28px 4px"><p style="font-size:13px;color:#94a3b8;margin:0">Zumex jamoasi</p></td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #eef2f7;color:#94a3b8;font-size:12px">© 2026 Zumex · Retail ERP + CRM</td></tr>
    </table>
  </div></body></html>`
}

function statusEmail(lead: Lead, status: string): { subject: string; text: string; html: string } | null {
  const loc = (lead.locale || 'uz').toLowerCase()
  const lang: MailLang = loc.startsWith('ru') ? 'ru' : loc.startsWith('en') ? 'en' : 'uz'
  const name = lead.name

  // status -> til -> kontent. approved/contacted = ijobiy (register tugmasi bilan).
  const C: Record<string, Record<MailLang, MailContent>> = {
    approved: {
      uz: { subject: 'Murojaatingiz tasdiqlandi — Zumex', badge: 'Tasdiqlandi', heading: 'Murojaatingiz tasdiqlandi 🎉', greet: `Hurmatli ${name}!`, body: "Sizning Zumex demo so'rovingiz tasdiqlandi. Hoziroq ro'yxatdan o'tib, tizimni bepul sinab ko'rishingiz mumkin.", cta: "Ro'yxatdan o'tish" },
      ru: { subject: 'Ваша заявка одобрена — Zumex', badge: 'Одобрено', heading: 'Ваша заявка одобрена 🎉', greet: `Уважаемый(ая) ${name}!`, body: 'Ваша заявка на демо Zumex одобрена. Зарегистрируйтесь прямо сейчас и попробуйте систему бесплатно.', cta: 'Зарегистрироваться' },
      en: { subject: 'Your request was approved — Zumex', badge: 'Approved', heading: 'Your request was approved 🎉', greet: `Dear ${name},`, body: 'Your Zumex demo request has been approved. Register now and try the system for free.', cta: 'Get started' },
    },
    contacted: {
      uz: { subject: "Murojaatingiz ko'rib chiqildi — Zumex", badge: "Bog'lanish", heading: "Murojaatingiz ko'rib chiqildi", greet: `Hurmatli ${name}!`, body: "Mutaxassisimiz tez orada siz bilan bog'lanadi. Istasangiz, hoziroq ro'yxatdan o'tib boshlashingiz mumkin.", cta: "Ro'yxatdan o'tish" },
      ru: { subject: 'Ваша заявка рассмотрена — Zumex', badge: 'Контакт', heading: 'Ваша заявка рассмотрена', greet: `Уважаемый(ая) ${name}!`, body: 'Наш специалист скоро свяжется с вами. При желании вы можете начать прямо сейчас — зарегистрируйтесь.', cta: 'Зарегистрироваться' },
      en: { subject: 'Your request was reviewed — Zumex', badge: 'Contact', heading: 'Your request was reviewed', greet: `Dear ${name},`, body: 'Our specialist will contact you shortly. If you wish, you can get started right now.', cta: 'Get started' },
    },
    rejected: {
      uz: { subject: "Murojaatingiz bo'yicha javob — Zumex", badge: 'Javob', heading: "Murojaatingiz bo'yicha javob", greet: `Hurmatli ${name}!`, body: "Afsuski, demo so'rovingiz hozircha tasdiqlanmadi. Savollaringiz bo'lsa, biz bilan bog'lanishingiz mumkin. Qiziqishingiz uchun rahmat!" },
      ru: { subject: 'Ответ по вашей заявке — Zumex', badge: 'Ответ', heading: 'Ответ по вашей заявке', greet: `Уважаемый(ая) ${name}!`, body: 'К сожалению, ваша заявка пока не одобрена. Если у вас есть вопросы, свяжитесь с нами. Спасибо за интерес!' },
      en: { subject: 'Response to your request — Zumex', badge: 'Response', heading: 'Response to your request', greet: `Dear ${name},`, body: 'Unfortunately, your request has not been approved at this time. If you have any questions, feel free to contact us. Thank you for your interest!' },
    },
  }

  const group = C[status]
  if (!group) return null
  const c = group[lang]
  const accent = status === 'rejected' ? '#e11d48' : status === 'contacted' ? '#0ea5e9' : '#059669'
  const text = `${c.greet}\n\n${c.body}${c.cta ? `\n\n${c.cta}: ${registerUrl()}` : ''}\n\nZumex jamoasi`
  return { subject: c.subject, text, html: emailHtml(c, accent) }
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
  // Status o'zgarsa — mijoz emailiga dizaynli xabar (approved/contacted = register tugmasi bilan).
  const changed = data.status && data.status !== prev.status;
  const emailStatuses = ['approved', 'contacted', 'rejected'];
  if (changed && data.status && emailStatuses.includes(data.status) && lead.email) {
    const mail = statusEmail(lead, data.status);
    if (mail) {
      try {
        await sendMail({ to: lead.email, subject: mail.subject, text: mail.text, html: mail.html });
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
