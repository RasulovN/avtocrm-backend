import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { trackUsage, flushUsage } from '../common/usageTracker.js';

// ──────────────────────────────────────────────────────────────
// Foydalanish kuzatuvi: kompaniya (mijoz) foydalanuvchilarining har bir
// muvaffaqiyatli so'rovini kunlik rollup'ga yozadi. O'qish so'rovlari ham
// hisoblanadi — audit_log'dan farqli, bu "tizim qanchalik ishlatilayapti"
// savoliga to'liq javob beradi (faqat dashboardni ko'radigan rahbar ham faol).
// Login hodisasi auth route'da alohida track qilinadi (u yerda token yo'q).
// ──────────────────────────────────────────────────────────────

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FLUSH_INTERVAL_MS = 15_000;

export const usagePlugin = fp(async (app: FastifyInstance) => {
  const timer = setInterval(() => {
    void flushUsage();
  }, FLUSH_INTERVAL_MS);
  timer.unref();

  app.addHook('onResponse', async (req, reply) => {
    try {
      if (reply.statusCode >= 400) return;
      const user = req.authUser;
      const companyId = req.companyId ?? user?.companyId ?? null;
      // Faqat kompaniya foydalanuvchilari — super adminlar mijoz emas.
      if (!user || !companyId) return;
      trackUsage(companyId, user.id, {
        requests: 1,
        actions: WRITE_METHODS.has(req.method) ? 1 : 0,
      });
    } catch {
      /* kuzatuv hech qachon throw qilmaydi */
    }
  });

  app.addHook('onClose', async () => {
    clearInterval(timer);
    await flushUsage();
  });
});
