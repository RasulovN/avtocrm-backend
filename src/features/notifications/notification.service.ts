import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { emitToUsers } from '../../realtime/io.js';
import type { PageParams } from '../../common/pagination.js';

// ──────────────────────────────────────────────────────────────
// Bildirishnomalar — yaratish + jonli (socket.io) yetkazish, ro'yxat,
// o'qilgan deb belgilash, super admin broadcast.
// ──────────────────────────────────────────────────────────────

export const REALTIME_EVENT = 'notification:new';

export interface PushInput {
  userIds: number[];
  companyId?: number | null;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  transferId?: number | null;
  announcementId?: number | null;
}

// DB ga yozadi va har bir foydalanuvchiga socket.io orqali yuboradi.
export async function pushNotifications(input: PushInput): Promise<number> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return 0;

  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      companyId: input.companyId ?? null,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
      transferId: input.transferId ?? null,
      announcementId: input.announcementId ?? null,
    })),
  });

  emitToUsers(userIds, REALTIME_EVENT, {
    type: input.type,
    title: input.title,
    message: input.message,
    link: input.link ?? null,
    created_at: new Date().toISOString(),
  });

  return userIds.length;
}

function serialize(n: {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  transferId: number | null;
  announcementId: number | null;
  createdAt: Date;
}) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    link: n.link,
    is_read: n.isRead,
    transfer: n.transferId,
    announcement: n.announcementId,
    created_at: n.createdAt,
  };
}

export async function listForUser(
  userId: number,
  opts: { page: PageParams; unreadOnly?: boolean; archived?: boolean },
) {
  // Standart — faqat ACTIVE bildirishnomalar. archived=true bo'lsa arxivdagilar.
  const where: Prisma.NotificationWhereInput = {
    userId,
    status: opts.archived ? 'archived' : 'active',
  };
  if (opts.unreadOnly) where.isRead = false;

  const [count, rows] = await prisma.$transaction([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: opts.page.skip,
      take: opts.page.take,
    }),
  ]);
  return { results: rows.map(serialize), count };
}

export function unreadCount(userId: number): Promise<number> {
  // Faqat faol (active) o'qilmaganlar.
  return prisma.notification.count({ where: { userId, isRead: false, status: 'active' } });
}

export async function markRead(userId: number, id: number): Promise<void> {
  await prisma.notification.updateMany({
    where: { id, userId },
    data: { isRead: true },
  });
}

export async function markAllRead(userId: number): Promise<number> {
  const res = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
  return res.count;
}

// Bitta bildirishnomani o'chirish (faqat o'z yozuvi).
export async function deleteNotification(userId: number, id: number): Promise<void> {
  await prisma.notification.deleteMany({ where: { id, userId } });
}

// Foydalanuvchining bildirishnomalarini tozalash. readOnly=true bo'lsa faqat o'qilganlar.
export async function clearNotifications(
  userId: number,
  opts?: { readOnly?: boolean },
): Promise<number> {
  const where: Prisma.NotificationWhereInput = { userId };
  if (opts?.readOnly) where.isRead = true;
  const res = await prisma.notification.deleteMany({ where });
  return res.count;
}

// ──────────────────────────────────────────────────────────────
// Super admin broadcast (Announcement)
// ──────────────────────────────────────────────────────────────

export type Audience = 'all' | 'mobile' | 'company_users' | 'company_admins' | 'company';

const AUDIENCES: Audience[] = ['all', 'mobile', 'company_users', 'company_admins', 'company'];

export function isValidAudience(a: string): a is Audience {
  return (AUDIENCES as string[]).includes(a);
}

async function resolveAudienceUserIds(
  audience: Audience,
  companyId?: number | null,
): Promise<number[]> {
  // super adminlarning o'zini chiqarib tashlaymiz (broadcast oddiy userlar uchun)
  const base: Prisma.UserWhereInput = { isActive: true, isSuperuser: false };

  if (audience === 'company_admins') {
    // Kompaniya adminlari = kompaniya egasi (owner)
    const companies = await prisma.company.findMany({
      where: companyId ? { id: companyId } : {},
      select: { ownerId: true },
    });
    return companies.map((c) => c.ownerId);
  }

  let where: Prisma.UserWhereInput = base;
  if (audience === 'mobile') {
    where = { ...base, platform: 'mobile' };
  } else if (audience === 'company_users') {
    where = { ...base, companyId: companyId ?? { not: null } };
  } else if (audience === 'company') {
    where = { ...base, companyId: companyId ?? undefined };
  }
  // audience === 'all' -> base

  const users = await prisma.user.findMany({ where, select: { id: true } });
  return users.map((u) => u.id);
}

export async function createBroadcast(input: {
  createdById: number;
  title: string;
  message: string;
  link?: string | null;
  audience: Audience;
  companyId?: number | null;
}) {
  const userIds = await resolveAudienceUserIds(input.audience, input.companyId);

  const announcement = await prisma.announcement.create({
    data: {
      createdById: input.createdById,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
      audience: input.audience,
      companyId: input.audience === 'company' ? input.companyId ?? null : null,
      recipientCount: userIds.length,
    },
  });

  await pushNotifications({
    userIds,
    companyId: null, // platform broadcast — kompaniyaga bog'lanmagan
    type: 'announcement',
    title: input.title,
    message: input.message,
    link: input.link ?? null,
    announcementId: announcement.id,
  });

  return { id: announcement.id, recipient_count: userIds.length };
}

// Super admin: yuborilgan broadcast'ni o'z ko'rinishidan o'chiradi.
// MUHIM: qabul qiluvchilarning bildirishnomalari DB'da QOLADI (announcementId -> null,
// schema'da onDelete: SetNull). Faqat Announcement yozuvi o'chadi.
export async function deleteBroadcast(id: number): Promise<void> {
  await prisma.announcement.delete({ where: { id } });
}

export async function listBroadcasts(page: PageParams) {
  const [count, rows] = await prisma.$transaction([
    prisma.announcement.count(),
    prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
      skip: page.skip,
      take: page.take,
      include: {
        createdBy: { select: { id: true, fullName: true } },
        company: { select: { id: true, name: true } },
      },
    }),
  ]);
  const results = rows.map((a) => ({
    id: a.id,
    title: a.title,
    message: a.message,
    link: a.link,
    audience: a.audience,
    company: a.company ? { id: a.company.id, name: a.company.name } : null,
    recipient_count: a.recipientCount,
    created_by: a.createdBy ? a.createdBy.fullName : null,
    created_at: a.createdAt,
  }));
  return { results, count };
}
