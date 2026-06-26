import type { FastifyInstance } from 'fastify';
import { runNotificationLifecycle } from './notificationLifecycle.js';

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

let running = false;
let timer: NodeJS.Timeout | null = null;

async function tick(app: FastifyInstance): Promise<void> {
  if (running) return; // bir vaqtda faqat bitta ishga tushish
  running = true;
  try {
    const res = await runNotificationLifecycle();
    if (res.archivedLong || res.archivedDefault || res.deleted) {
      app.log.info(
        { notificationLifecycle: res },
        `Notification lifecycle: arxivlandi=${res.archivedLong + res.archivedDefault}, o'chirildi=${res.deleted}`,
      );
    }
  } catch (err) {
    app.log.error({ err }, 'Notification lifecycle job xatosi');
  } finally {
    running = false;
  }
}

// Rejalashtirilgan vazifalarni ishga tushiradi (server start'da).
export function startScheduler(app: FastifyInstance): void {
  // Startdan 30 soniya keyin birinchi ishga tushish (DB tayyor bo'lishi uchun).
  setTimeout(() => void tick(app), 30_000);
  // Keyin har 12 soatda.
  timer = setInterval(() => void tick(app), TWELVE_HOURS);
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
