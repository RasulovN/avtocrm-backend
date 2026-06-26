import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { PageParams } from '../../common/pagination.js';

// Loglarni ko'rish doirasi (rol bo'yicha):
//   all     — super admin (barcha loglar)
//   company — kompaniya admini (o'z kompaniyasi loglari)
//   user    — oddiy foydalanuvchi (faqat o'z loglari)
export type AuditScope =
  | { type: 'all' }
  | { type: 'company'; companyId: number }
  | { type: 'user'; userId: number };

export interface AuditFilters {
  action?: string;
  entity?: string;
  userId?: number;
  companyId?: number; // faqat 'all' doirasida
  dateFrom?: string;
  dateTo?: string;
}

export async function listAuditLogs(scope: AuditScope, filters: AuditFilters, page: PageParams) {
  const where: Prisma.AuditLogWhereInput = {};

  if (scope.type === 'company') where.companyId = scope.companyId;
  if (scope.type === 'user') where.userId = scope.userId;

  if (filters.action) where.action = filters.action;
  if (filters.entity) where.entity = filters.entity;
  // user_id filtri: faqat company/all doirasida ruxsat
  if (filters.userId && scope.type !== 'user') where.userId = filters.userId;
  if (filters.companyId && scope.type === 'all') where.companyId = filters.companyId;

  if (filters.dateFrom || filters.dateTo) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.dateFrom) createdAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) createdAt.lte = new Date(filters.dateTo);
    where.createdAt = createdAt;
  }

  const [count, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: page.skip,
      take: page.take,
      include: {
        user: { select: { id: true, fullName: true, phoneNumber: true } },
        company: { select: { id: true, name: true } },
      },
    }),
  ]);

  const results = rows.map((r) => ({
    id: r.id,
    user_id: r.userId,
    user_name: r.user?.fullName ?? r.user?.phoneNumber ?? null,
    company_id: r.companyId,
    company_name: r.company?.name ?? null,
    action: r.action,
    entity: r.entity,
    entity_id: r.entityId,
    summary: r.summary,
    ip_address: r.ipAddress,
    user_agent: r.userAgent,
    created_at: r.createdAt,
  }));

  return { results, count };
}
