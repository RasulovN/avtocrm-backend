import { prisma } from '../db/prisma.js';

// ──────────────────────────────────────────────────────────────
// Bildirishnomalar hayot sikli (avtomatik):
//   1) ACTIVE  -> turiga qarab 15 yoki 30 kun (yaratilgandan).
//   2) ARCHIVED -> 30 kun arxivda turadi.
//   3) 30 kundan keyin arxivdagilar BUTUNLAY o'chiriladi.
// Kuniga bir necha marta ishlaydigan rejalashtirilgan vazifa chaqiradi.
// ──────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

// Faol holatda turish muddati (kun), bildirishnoma turiga qarab.
//   announcement (super admin broadcast) -> 30 kun
//   boshqa (operatsion: transfer tc/ta/tr, kam zaxira lp/lt) -> 15 kun
const LONG_LIVED_TYPES = new Set(['announcement']);
const ACTIVE_DAYS_LONG = 30;
const ACTIVE_DAYS_DEFAULT = 15;
const ARCHIVE_DAYS = 30; // arxivda turish muddati

export interface LifecycleResult {
  archivedLong: number;
  archivedDefault: number;
  deleted: number;
}

export async function runNotificationLifecycle(now: Date = new Date()): Promise<LifecycleResult> {
  const longCutoff = new Date(now.getTime() - ACTIVE_DAYS_LONG * DAY_MS);
  const defaultCutoff = new Date(now.getTime() - ACTIVE_DAYS_DEFAULT * DAY_MS);
  const archiveCutoff = new Date(now.getTime() - ARCHIVE_DAYS * DAY_MS);

  // 1) Uzoq yashaydigan turlar (announcement): 30 kundan keyin arxivga.
  const archivedLong = await prisma.notification.updateMany({
    where: { status: 'active', type: { in: [...LONG_LIVED_TYPES] }, createdAt: { lte: longCutoff } },
    data: { status: 'archived', archivedAt: now },
  });

  // 2) Qolgan (operatsion) turlar: 15 kundan keyin arxivga.
  const archivedDefault = await prisma.notification.updateMany({
    where: { status: 'active', type: { notIn: [...LONG_LIVED_TYPES] }, createdAt: { lte: defaultCutoff } },
    data: { status: 'archived', archivedAt: now },
  });

  // 3) Arxivda 30 kundan ortiq turganlarni BUTUNLAY o'chirish.
  const deleted = await prisma.notification.deleteMany({
    where: { status: 'archived', archivedAt: { lte: archiveCutoff } },
  });

  return {
    archivedLong: archivedLong.count,
    archivedDefault: archivedDefault.count,
    deleted: deleted.count,
  };
}
