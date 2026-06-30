import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { BadRequest, NotFound } from '../../common/errors.js';
import type { PageParams } from '../../common/pagination.js';
import { emitToRoom, emitToSuperadmins } from '../../realtime/io.js';
import type { Attachment, SendMessageInput } from './support.schemas.js';

const MESSAGES_PAGE = 30;

// ──────────────────────────────────────────────────────────────
// Serializatsiya (snake_case)
// ──────────────────────────────────────────────────────────────
type MessageRow = {
  id: number;
  conversationId: number;
  senderId: number;
  senderRole: string;
  body: string | null;
  attachments: Prisma.JsonValue;
  isRead: boolean;
  createdAt: Date;
};

function serializeMessage(m: MessageRow) {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    sender_id: m.senderId,
    sender_role: m.senderRole, // 'user' | 'agent'
    body: m.body,
    attachments: (m.attachments as Attachment[] | null) ?? [],
    is_read: m.isRead,
    created_at: m.createdAt,
  };
}

type ConversationRow = {
  id: number;
  userId: number;
  companyId: number | null;
  status: string;
  lastMessageAt: Date | null;
  lastMessageText: string | null;
  userUnread: number;
  agentUnread: number;
  createdAt: Date;
  updatedAt: Date;
  user?: { id: number; fullName: string | null; email: string | null; phoneNumber: string | null } | null;
  company?: { id: number; name: string } | null;
};

function serializeConversation(c: ConversationRow) {
  return {
    id: c.id,
    user_id: c.userId,
    company_id: c.companyId,
    status: c.status,
    last_message_at: c.lastMessageAt,
    last_message_text: c.lastMessageText,
    user_unread: c.userUnread,
    agent_unread: c.agentUnread,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    user: c.user
      ? { id: c.user.id, full_name: c.user.fullName, email: c.user.email, phone_number: c.user.phoneNumber }
      : null,
    company: c.company ? { id: c.company.id, name: c.company.name } : null,
  };
}

// Xabar matnini ro'yxat uchun qisqa ko'rinishi (oxirgi xabar).
function previewText(input: SendMessageInput): string {
  if (input.body && input.body.trim()) return input.body.trim();
  const n = input.attachments?.length ?? 0;
  if (n > 0) return n === 1 ? '📎 Fayl' : `📎 ${n} ta fayl`;
  return '';
}

// ──────────────────────────────────────────────────────────────
// Suhbatni topish / yaratish (har user uchun bitta)
// ──────────────────────────────────────────────────────────────
async function getOrCreateConversation(userId: number, companyId: number | null) {
  const existing = await prisma.supportConversation.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.supportConversation.create({
    data: { userId, companyId: companyId ?? null },
  });
}

// Oxirgi N ta xabar (yoki `beforeId`'dan oldingilar) — o'sish tartibida + has_more.
async function loadMessages(conversationId: number, beforeId?: number, limit = MESSAGES_PAGE) {
  const where: Prisma.SupportMessageWhereInput = { conversationId };
  if (beforeId && beforeId > 0) where.id = { lt: beforeId };

  const rows = await prisma.supportMessage.findMany({
    where,
    orderBy: { id: 'desc' },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  page.reverse(); // o'sish tartibida (eski -> yangi)
  return { results: page.map(serializeMessage), has_more: hasMore };
}

function buildMessageData(
  conversationId: number,
  senderId: number,
  senderRole: 'user' | 'agent',
  input: SendMessageInput,
): Prisma.SupportMessageCreateManyInput {
  return {
    conversationId,
    senderId,
    senderRole,
    body: input.body?.trim() || null,
    attachments: (input.attachments ?? []) as unknown as Prisma.InputJsonValue,
    isRead: false,
  };
}

function assertHasContent(input: SendMessageInput) {
  const hasText = !!input.body && input.body.trim().length > 0;
  const hasFiles = !!input.attachments && input.attachments.length > 0;
  if (!hasText && !hasFiles) {
    throw new BadRequest({ detail: 'Bo\'sh xabar yuborib bo\'lmaydi.' });
  }
}

// ──────────────────────────────────────────────────────────────
// FOYDALANUVCHI tomoni
// ──────────────────────────────────────────────────────────────

// Suhbatni ochish: agent xabarlarini o'qilgan deb belgilaymiz.
export async function getMyConversation(userId: number, companyId: number | null) {
  const conv = await getOrCreateConversation(userId, companyId);

  // Agentdan kelgan o'qilmaganlarni o'qilgan qilamiz.
  if (conv.userUnread > 0) {
    await prisma.$transaction([
      prisma.supportMessage.updateMany({
        where: { conversationId: conv.id, senderRole: 'agent', isRead: false },
        data: { isRead: true },
      }),
      prisma.supportConversation.update({ where: { id: conv.id }, data: { userUnread: 0 } }),
    ]);
    conv.userUnread = 0;
  }

  const { results, has_more } = await loadMessages(conv.id);
  return { conversation: serializeConversation(conv), messages: results, has_more };
}

export async function listMyOlderMessages(userId: number, beforeId?: number) {
  const conv = await prisma.supportConversation.findUnique({ where: { userId } });
  if (!conv) return { results: [], has_more: false };
  return loadMessages(conv.id, beforeId);
}

export async function getMyUnread(userId: number): Promise<number> {
  const conv = await prisma.supportConversation.findUnique({
    where: { userId },
    select: { userUnread: true },
  });
  return conv?.userUnread ?? 0;
}

// Foydalanuvchi xabar yuboradi -> agentlarga (super admin) jonli yetkaziladi.
export async function sendMyMessage(userId: number, companyId: number | null, input: SendMessageInput) {
  assertHasContent(input);
  const conv = await getOrCreateConversation(userId, companyId);

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.supportMessage.create({
      data: buildMessageData(conv.id, userId, 'user', input),
    });
    await tx.supportConversation.update({
      where: { id: conv.id },
      data: {
        lastMessageAt: created.createdAt,
        lastMessageText: previewText(input),
        agentUnread: { increment: 1 },
        // Foydalanuvchi yozsa suhbat qayta ochiladi.
        status: 'open',
      },
    });
    return created;
  });

  const payload = { conversation_id: conv.id, message: serializeMessage(message) };
  // Super admin operatorlariga (chat ro'yxati + ochiq suhbat).
  emitToSuperadmins('support:message', payload);
  // Foydalanuvchining boshqa qurilma/tablari.
  emitToRoom(`user:${userId}`, 'support:message', payload);

  return serializeMessage(message);
}

// ──────────────────────────────────────────────────────────────
// AGENT (super admin) tomoni
// ──────────────────────────────────────────────────────────────

export async function listConversations(
  filters: { status?: string; q?: string },
  page: PageParams,
) {
  const where: Prisma.SupportConversationWhereInput = {};
  if (filters.status && filters.status !== 'all') where.status = filters.status;
  if (filters.q && filters.q.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { user: { fullName: { contains: q, mode: 'insensitive' } } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
      { user: { phoneNumber: { contains: q, mode: 'insensitive' } } },
      { company: { name: { contains: q, mode: 'insensitive' } } },
    ];
  }

  const include = {
    user: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
    company: { select: { id: true, name: true } },
  };

  const [rows, count] = await Promise.all([
    prisma.supportConversation.findMany({
      where,
      include,
      // Yangi xabar kelganlar tepada; xabarsizlar yaratilish bo'yicha.
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.supportConversation.count({ where }),
  ]);

  return { results: rows.map(serializeConversation), count };
}

async function getConversationOrThrow(id: number) {
  const conv = await prisma.supportConversation.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
      company: { select: { id: true, name: true } },
    },
  });
  if (!conv) throw new NotFound({ detail: 'Suhbat topilmadi.' });
  return conv;
}

// Agent suhbatni ochadi: foydalanuvchi xabarlarini o'qilgan deb belgilaymiz.
export async function getConversationForAgent(id: number) {
  const conv = await getConversationOrThrow(id);

  if (conv.agentUnread > 0) {
    await prisma.$transaction([
      prisma.supportMessage.updateMany({
        where: { conversationId: id, senderRole: 'user', isRead: false },
        data: { isRead: true },
      }),
      prisma.supportConversation.update({ where: { id }, data: { agentUnread: 0 } }),
    ]);
    conv.agentUnread = 0;
  }

  const { results, has_more } = await loadMessages(id);
  return { conversation: serializeConversation(conv), messages: results, has_more };
}

export async function listAgentOlderMessages(id: number, beforeId?: number) {
  return loadMessages(id, beforeId);
}

// Agent javob yozadi -> foydalanuvchiga jonli yetkaziladi.
export async function sendAgentMessage(agentUserId: number, conversationId: number, input: SendMessageInput) {
  assertHasContent(input);
  const conv = await getConversationOrThrow(conversationId);

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.supportMessage.create({
      data: buildMessageData(conversationId, agentUserId, 'agent', input),
    });
    await tx.supportConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: created.createdAt,
        lastMessageText: previewText(input),
        userUnread: { increment: 1 },
      },
    });
    return created;
  });

  const payload = { conversation_id: conversationId, message: serializeMessage(message) };
  // Suhbat egasiga (foydalanuvchi widgeti) + boshqa operatorlarga.
  emitToRoom(`user:${conv.userId}`, 'support:message', payload);
  emitToSuperadmins('support:message', payload);

  return serializeMessage(message);
}

export async function setConversationStatus(id: number, status: 'open' | 'closed') {
  await getConversationOrThrow(id);
  const updated = await prisma.supportConversation.update({
    where: { id },
    data: { status },
    include: {
      user: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
      company: { select: { id: true, name: true } },
    },
  });
  return serializeConversation(updated);
}

// Operatorlar uchun umumiy o'qilmaganlar (badge).
export async function getAgentTotalUnread(): Promise<{ count: number; conversations: number }> {
  const [agg, convs] = await Promise.all([
    prisma.supportConversation.aggregate({ _sum: { agentUnread: true } }),
    prisma.supportConversation.count({ where: { agentUnread: { gt: 0 } } }),
  ]);
  return { count: agg._sum.agentUnread ?? 0, conversations: convs };
}
