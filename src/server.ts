import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { initRealtime } from './realtime/io.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';
import { syncPermissions, regrantSystemRoles } from './features/rbac/rbac.service.js';
import { seedDefaultPaymentMethods } from './features/payment-methods/paymentMethods.service.js';
import { initTelegramAlerts } from './common/telegramAlert.js';

async function main() {
  const app = await buildApp();

  // Telegram server-alert (5xx, crash, restart xabarlari)
  initTelegramAlerts();

  // socket.io — jonli bildirishnomalar (Fastify'ning HTTP serveriga ulanadi)
  initRealtime(app.server);

  // RBAC: ruxsatlar katalogini DB ga sinxronlash + tizim rollarini (har kompaniya
  // Owner, platforma Super Admin) to'liq huquqlar bilan qayta to'ldirish.
  // Shu sabab kompaniya egasi doimo barcha CRUD (rol/xodim qo'shish ham) qila oladi,
  // va eskirgan ruxsat kodlari (masalan `.manage`) tozalanadi.
  try {
    await syncPermissions();
    await regrantSystemRoles();
  } catch (err) {
    app.log.error(err, 'RBAC sync xatosi');
  }

  // To'lov turlari katalogi bo'sh bo'lsa default (Uzcard, Humo, Payme...) yaratiladi.
  try {
    await seedDefaultPaymentMethods();
  } catch (err) {
    app.log.error(err, "To'lov turlari seed xatosi");
  }

  const shutdown = async () => {
    stopScheduler();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    // Rejalashtirilgan vazifalar (bildirishnoma hayot sikli)
    startScheduler(app);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
