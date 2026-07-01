/**
 * Payme test buyurtmasini TOZALASH va QAYTA yaratish (standalone).
 *
 * Nima qiladi:
 *   1) Barcha PaymeTransaction'larni o'chiradi.
 *   2) Barcha Subscription (buyurtma) larni o'chiradi.
 *   3) subscription id sequence'ini 1 ga tiklaydi.
 *   4) Bitta yangi `pending` (state 0), tranzaksiyasiz buyurtma yaratadi → id = 1.
 *   5) Payme'ga yuboriladigan JSON ma'lumotni console'ga chiqaradi.
 *
 * DIQQAT: bu HAMMA obunani o'chiradi — Payme sandbox tekshiruvi uchun mo'ljallangan.
 *
 * Ishga tushirish:
 *   Dev:   npm run payme:reset
 *   Prod:  node dist/scripts/payme-reset-order.js
 *   Summani berish (so'mda): npm run payme:reset -- 99000
 *
 * MUHIM: `env.ts` import QILINMAYDI (production'da SECRET_KEY validatsiyasidan
 * qochish uchun) — o'z PrismaClient'imizni yaratamiz, DATABASE_URL .env'dan olinadi.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ACCOUNT_FIELD = process.env.PAYME_ACCOUNT_FIELD ?? 'subscription_id';

async function main(): Promise<void> {
  const company = await prisma.company.findFirst({ orderBy: { id: 'asc' } });
  const plan = await prisma.plan.findFirst({ where: { price: { gt: 0 } }, orderBy: { price: 'asc' } });
  if (!company || !plan) {
    console.error('❌ Kompaniya yoki pullik tarif topilmadi. Avval kamida bittasini yarating.');
    process.exitCode = 1;
    return;
  }

  // Summa: argument (so'mda) yoki tarif narxi.
  const argAmount = process.argv[2];
  const amountSom = argAmount ? Number(argAmount) : Number(plan.price);
  if (!Number.isFinite(amountSom) || amountSom <= 0) {
    console.error('❌ Summa noto\'g\'ri.');
    process.exitCode = 1;
    return;
  }

  // 1-2) Tozalash.
  const delTx = await prisma.paymeTransaction.deleteMany({});
  const delSub = await prisma.subscription.deleteMany({});
  console.log(`Tozalandi: ${delTx.count} tranzaksiya, ${delSub.count} buyurtma`);

  // 3) Sequence'ni 1 ga tiklash (keyingi id = 1).
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('subscription', 'id'), 1, false)`,
  );

  // 4) Yangi buyurtma (state 0 — pending, tranzaksiyasiz).
  const sub = await prisma.subscription.create({
    data: {
      companyId: company.id,
      planId: plan.id,
      status: 'pending',
      amount: amountSom,
      periodMonths: 1,
    },
  });

  const amountTiyin = Math.round(Number(sub.amount) * 100);

  console.log('\n✅ Yangi buyurtma yaratildi (state 0):');
  console.log(JSON.stringify({
    order_id: sub.id,
    account_field: ACCOUNT_FIELD,
    status: sub.status,
    amount_som: Number(sub.amount),
    amount_tiyin: amountTiyin,
    transactions: 0,
  }, null, 2));

  console.log('\n── Payme test uchun account JSON ──');
  console.log(JSON.stringify({ [ACCOUNT_FIELD]: String(sub.id) }, null, 2));

  console.log('\n── CheckPerformTransaction so\'rovi ──');
  console.log(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'CheckPerformTransaction',
    params: { amount: amountTiyin, account: { [ACCOUNT_FIELD]: String(sub.id) } },
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('❌ Xato:', err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exitCode = 1;
});
