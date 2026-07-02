/**
 * Payme FISKAL callback integratsion test skripti (standalone).
 *
 * Payme'ning fiskal (Soliq/OFD) chek callbackini simulyatsiya qiladi va uning
 * AVTO saqlanishini uchdan-uchgacha tekshiradi:
 *   webhook (Basic-auth) -> parse -> PaymeFiscalReceipt saqlash -> tranzaksiyaga bog'lash
 *   -> PERFORM bo'lsa PaymeTransaction.fiscalUrl ga qr_code_url ko'chirish.
 *
 * Ikkala metod nomi ham tekshiriladi:
 *   - `SetFiscalData`              (Merchant API — checkout oqimi)
 *   - `receipts.set_fiscal_data`  (Subscribe API — karta oqimi)
 *
 * Ishga tushirish:
 *   Server ishlab turishi kerak (npm run dev / start).
 *   npm run payme:fiscal-test                     -> oxirgi to'langan tranzaksiya bo'yicha
 *   npm run payme:fiscal-test -- <paycomId>       -> aniq tranzaksiya bo'yicha
 *   npm run payme:fiscal-test -- <paycomId> cancel-> CANCEL (qaytarish) cheki
 *
 * Sozlash (.env / muhit o'zgaruvchilari, ixtiyoriy):
 *   PAYME_WEBHOOK_URL  — to'liq webhook manzili (default: http://127.0.0.1:<PORT>/payme/webhook)
 *
 * MUHIM: `env.ts` import QILINMAYDI (prod'da SECRET_KEY validatsiyasini ishga tushirmaslik uchun).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_MODE = (process.env.PAYME_TEST_MODE ?? '1') === '1';
// Faol Payme kaliti (webhook Basic-auth uchun) — payme-test.ts bilan bir xil mantiq.
const ACTIVE_KEY =
  process.env.PAYME_SECRET_KEY ||
  (TEST_MODE ? process.env.PAYME_TEST_KEY : process.env.PAYME_KEY) ||
  process.env.PAYME_KEY ||
  process.env.PAYME_TEST_KEY ||
  '';
const PORT = process.env.PORT ?? '8000';
const WEBHOOK_URL = process.env.PAYME_WEBHOOK_URL ?? `http://127.0.0.1:${PORT}/payme/webhook`;
const authHeader = 'Basic ' + Buffer.from(`Paycom:${ACTIVE_KEY}`, 'utf8').toString('base64');

const PERFORMED_STATE = 2; // PaymeState.Performed

// ── Argumentlar ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isCancel = args.some((a) => a.toLowerCase() === 'cancel');
// Metod: 'sub'/'receipts' berilsa Subscribe callbackini sinaymiz.
const useSubscribeMethod = args.some((a) => ['sub', 'receipts', 'subscribe'].includes(a.toLowerCase()));
// Birinchi "flag bo'lmagan" argument — paycomId.
const argId = args.find(
  (a) => !['cancel', 'sub', 'receipts', 'subscribe', 'perform'].includes(a.toLowerCase()),
);

const TYPE: 'PERFORM' | 'CANCEL' = isCancel ? 'CANCEL' : 'PERFORM';
const METHOD = useSubscribeMethod ? 'receipts.set_fiscal_data' : 'SetFiscalData';

// Aniq paycomId berilmasa — oxirgi to'langan (Performed) tranzaksiyani olamiz.
async function resolvePaycomId(): Promise<{ id: string; fromDb: boolean }> {
  if (argId) return { id: argId, fromDb: false };
  const tx = await prisma.paymeTransaction.findFirst({
    where: { state: PERFORMED_STATE },
    orderBy: { performTime: 'desc' },
  });
  if (tx) return { id: tx.paycomId, fromDb: true };
  return { id: `test_fiscal_${TYPE.toLowerCase()}`, fromDb: false };
}

function line(): void {
  console.log('─'.repeat(64));
}

async function main(): Promise<void> {
  const { id, fromDb } = await resolvePaycomId();
  // Barqaror, ammo aniqlanadigan test QR havolasi (Date.now o'rniga id asosida).
  const qrUrl = `https://ofd.soliq.uz/check?c=TEST-${id}-${TYPE}`;

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: METHOD,
    params: {
      id,
      // Subscribe callbackida `type` bo'lmasligi mumkin — uni ataylab tashlab ketamiz,
      // schema PERFORM deb qabul qilishini tekshirish uchun.
      ...(useSubscribeMethod && TYPE === 'PERFORM' ? {} : { type: TYPE }),
      fiscal_data: {
        receipt_id: 100500,
        status_code: 0,
        message: '',
        terminal_id: 'VM00000001',
        fiscal_sign: '123456789012',
        qr_code_url: qrUrl,
        date: '20260702120000',
      },
    },
  };

  line();
  console.log('POST', WEBHOOK_URL);
  console.log('Metod:', METHOD, '| type:', TYPE, '| paycomId:', id, fromDb ? '(DB dan)' : '(qo\'lda/soxta)');
  console.log("So'rov (request):");
  console.log(JSON.stringify(body, null, 2));
  line();

  if (!ACTIVE_KEY) {
    console.error('❌ Payme kaliti topilmadi (.env: PAYME_KEY / PAYME_TEST_KEY / PAYME_SECRET_KEY).');
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  // ── 1) Webhookka so'rov ──────────────────────────────────────────
  let json: { result?: { success?: boolean }; error?: unknown } | null = null;
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    console.log('HTTP holati:', res.status, res.statusText);
    console.log('Javob (response):', json !== null ? JSON.stringify(json) : text);
  } catch (err) {
    console.error('❌ So\'rov yuborilmadi:', err instanceof Error ? err.message : err);
    console.error('   PAYME_WEBHOOK_URL va server ishlab turganini tekshiring.');
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }
  line();

  // ── 2) Tekshiruvlar (assertions) ─────────────────────────────────
  let ok = true;
  const check = (cond: boolean, pass: string, fail: string) => {
    console.log(cond ? `✅ ${pass}` : `❌ ${fail}`);
    if (!cond) ok = false;
  };

  check(
    Boolean(json?.result?.success) && !json?.error,
    'Webhook { result: { success: true } } qaytardi',
    `Webhook success qaytarmadi (error: ${JSON.stringify(json?.error ?? null)})`,
  );

  // Fiskal chek bazaga saqlandimi?
  const receipt = await prisma.paymeFiscalReceipt.findFirst({
    where: { paymeReceiptId: id, type: TYPE },
    orderBy: { createdAt: 'desc' },
  });
  check(Boolean(receipt), `PaymeFiscalReceipt saqlandi (type=${TYPE})`, 'PaymeFiscalReceipt topilmadi');
  if (receipt) {
    check(receipt.qrCodeUrl === qrUrl, `qr_code_url to'g'ri saqlandi: ${receipt.qrCodeUrl}`, `qr_code_url mos emas: ${receipt.qrCodeUrl}`);
    check(receipt.fiscalSign === '123456789012', 'fiscal_sign saqlandi', `fiscal_sign mos emas: ${receipt.fiscalSign}`);
  }

  // Tranzaksiyaga bog'landimi va PERFORM'da fiscalUrl ko'chdimi?
  const tx = await prisma.paymeTransaction.findUnique({ where: { paycomId: id } });
  if (tx) {
    check(receipt?.transactionId === tx.id, 'Fiskal chek tranzaksiyaga bog\'landi', 'Fiskal chek tranzaksiyaga bog\'lanmadi');
    check(receipt?.subscriptionId === tx.subscriptionId, 'Fiskal chek obunaga bog\'landi', 'Fiskal chek obunaga bog\'lanmadi');
    if (TYPE === 'PERFORM') {
      check(tx.fiscalUrl === qrUrl, 'PaymeTransaction.fiscalUrl yangilandi (frontendga chiqadi)', `fiscalUrl ko'chmadi: ${tx.fiscalUrl}`);
    }
  } else {
    console.log('ℹ️  Bu paycomId bo\'yicha tranzaksiya yo\'q — chek saqlandi, lekin bog\'lanmadi (soxta id).');
  }

  line();
  console.log(ok ? '✅ HAMMA TEKSHIRUV MUVAFFAQIYATLI' : '❌ BA\'ZI TEKSHIRUVLAR O\'TMADI');
  await prisma.$disconnect();
  process.exitCode = ok ? 0 : 1;
}

void main();
