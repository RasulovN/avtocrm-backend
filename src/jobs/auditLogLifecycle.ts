import { prisma } from '../db/prisma.js';

// ──────────────────────────────────────────────────────────────
// Foydalanuvchi loglari (AuditLog) hayot sikli (avtomatik):
//   1) FAOL     -> yaratilgandan 2 oy o'tgach ARXIVGA tushadi (archivedAt to'ldiriladi).
//      Arxivlangan loglar faqat SUPER ADMIN panelida ko'rinadi (kompaniya/foydalanuvchi
//      panelida ko'rinmaydi — buni listAuditLogs doiralab beradi).
//   2) ARXIVDA  -> arxivlangandan 3 oy o'tgach yozuv BUTUNLAY o'chiriladi.
// Rejalashtirilgan vazifa (scheduler) kuniga bir necha marta chaqiradi.
// ──────────────────────────────────────────────────────────────

const ARCHIVE_AFTER_MONTHS = 2; // yaratilgandan keyin arxivga tushish muddati
const DELETE_AFTER_ARCHIVE_MONTHS = 3; // arxivda turish muddati (keyin o'chiriladi)

// `date` dan `months` oy oldingi sanani qaytaradi (kalendar oyi bo'yicha).
function subtractMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() - months);
  return d;
}

export interface AuditLogLifecycleResult {
  archived: number;
  deleted: number;
}

export async function runAuditLogLifecycle(
  now: Date = new Date(),
): Promise<AuditLogLifecycleResult> {
  const archiveCutoff = subtractMonths(now, ARCHIVE_AFTER_MONTHS);
  const deleteCutoff = subtractMonths(now, DELETE_AFTER_ARCHIVE_MONTHS);

  // 1) 2 oydan eski faol loglarni arxivga o'tkazamiz.
  const archived = await prisma.auditLog.updateMany({
    where: { archivedAt: null, createdAt: { lte: archiveCutoff } },
    data: { archivedAt: now },
  });

  // 2) Arxivda 3 oydan ortiq turgan loglarni butunlay o'chiramiz.
  const deleted = await prisma.auditLog.deleteMany({
    where: { archivedAt: { not: null, lte: deleteCutoff } },
  });

  return { archived: archived.count, deleted: deleted.count };
}
