import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';

// ──────────────────────────────────────────────────────────────
// Audit log yozish — fire-and-forget. Audit hech qachon asosiy
// so'rov oqimini buzmasligi kerak (xato bo'lsa jim yutiladi).
// ──────────────────────────────────────────────────────────────

export interface AuditInput {
  userId?: number | null;
  companyId?: number | null;
  action: string; // login | logout | create | update | delete
  entity?: string | null;
  entityId?: number | null;
  summary?: string | null;
  meta?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export function recordAudit(input: AuditInput): void {
  prisma.auditLog
    .create({
      data: {
        userId: input.userId ?? null,
        companyId: input.companyId ?? null,
        action: input.action,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        summary: input.summary ?? null,
        meta: input.meta,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
    .catch(() => {
      /* audit yozilmasa ham asosiy oqim davom etadi */
    });
}
