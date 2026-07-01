/**
 * Payme webhook test skripti (standalone).
 *
 * Ishga tushirilganda Payme Merchant API webhookiga JSON-RPC so'rov yuboradi
 * va javobni console'ga chiqaradi. Serverda "so'rov ketyaptimi / JSON qaytyaptimi"
 * ni tez tekshirish uchun.
 *
 * Ishga tushirish:
 *   Dev:   npm run payme:test
 *   Prod:  node dist/scripts/payme-test.js
 *   Argument bilan:
 *     npm run payme:test -- CheckPerformTransaction 43 9900000
 *     (method)                (subscription_id) (amount tiyin)
 *
 * Sozlash (.env yoki muhit o'zgaruvchilari orqali, ixtiyoriy):
 *   PAYME_WEBHOOK_URL   — to'liq webhook manzili
 *                         (default: http://127.0.0.1:<PORT>/payme/webhook)
 *   PAYME_TEST_SUB_ID   — buyurtma (subscription) id (default: 43)
 *   PAYME_TEST_AMOUNT   — summa tiyin (default: 9900000)
 */

// MUHIM: bu skript `env.ts` ni import QILMAYDI — aks holda u production'da
// SECRET_KEY validatsiyasini ishga tushiradi (test uchun keraksiz). Faqat .env
// yuklab, kerakli qiymatlarni to'g'ridan-to'g'ri process.env'dan olamiz.
import 'dotenv/config';

// Faol Payme kaliti (webhook Basic-auth uchun). Rejimga qarab test/prod kaliti.
// Webhook barcha sozlangan kalitlarni qabul qiladi, shuning uchun mavjudini tanlaymiz.
const TEST_MODE = (process.env.PAYME_TEST_MODE ?? '1') === '1';
const ACTIVE_KEY =
  (TEST_MODE ? process.env.PAYME_TEST_KEY : process.env.PAYME_KEY) ||
  process.env.PAYME_KEY ||
  process.env.PAYME_TEST_KEY ||
  '';
const ACCOUNT_FIELD = process.env.PAYME_ACCOUNT_FIELD ?? 'subscription_id';
const PORT = process.env.PORT ?? '8000';

// ── Konfiguratsiya (argv > .env > default) ─────────────────────────
const [, , argMethod, argSubId, argAmount] = process.argv;

const METHOD = argMethod ?? 'CheckPerformTransaction';
const SUB_ID = argSubId ?? process.env.PAYME_TEST_SUB_ID ?? '43';
const AMOUNT = Number(argAmount ?? process.env.PAYME_TEST_AMOUNT ?? 9_900_000);

const WEBHOOK_URL =
  process.env.PAYME_WEBHOOK_URL ?? `http://127.0.0.1:${PORT}/payme/webhook`;

// Basic-auth: base64("Paycom:" + faol kalit) — Payme aynan shunday imzolaydi.
const authHeader =
  'Basic ' + Buffer.from(`Paycom:${ACTIVE_KEY}`, 'utf8').toString('base64');

// ── Metodga qarab params yasaymiz ──────────────────────────────────
function buildParams(): Record<string, unknown> {
  const account = { [ACCOUNT_FIELD]: SUB_ID };
  // Tranzaksiyaga tegishli metodlar uchun soxta paycom id (test uchun barqaror).
  const fakeId = `test_${SUB_ID}_${AMOUNT}`;
  switch (METHOD) {
    case 'CheckPerformTransaction':
      return { amount: AMOUNT, account };
    case 'CreateTransaction':
      return { id: fakeId, time: 1_700_000_000_000, amount: AMOUNT, account };
    case 'PerformTransaction':
    case 'CheckTransaction':
      return { id: fakeId };
    case 'CancelTransaction':
      return { id: fakeId, reason: 5 };
    case 'GetStatement':
      return { from: 0, to: Date.now() };
    default:
      return { amount: AMOUNT, account };
  }
}

async function main(): Promise<void> {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: METHOD,
    params: buildParams(),
  };

  console.log('─'.repeat(60));
  console.log('POST', WEBHOOK_URL);
  console.log('Authorization:', 'Basic Paycom:*** (faol kalit)');
  console.log('So\'rov (request):');
  console.log(JSON.stringify(body, null, 2));
  console.log('─'.repeat(60));

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    console.log('HTTP holati:', res.status, res.statusText);
    console.log('Javob (response):');
    console.log(json !== null ? JSON.stringify(json, null, 2) : text);
    console.log('─'.repeat(60));

    // JSON-RPC error bo'lsa ajratib ko'rsatamiz.
    if (json && typeof json === 'object' && 'error' in json && (json as { error?: unknown }).error) {
      console.log('⚠️  JSON-RPC xatosi qaytdi (yuqoridagi `error` ga qarang).');
      process.exitCode = 1;
    } else {
      console.log('✅ Muvaffaqiyatli javob olindi.');
    }
  } catch (err) {
    console.error('❌ So\'rov yuborilmadi:', err instanceof Error ? err.message : err);
    console.error('   Manzilni (PAYME_WEBHOOK_URL) va server ishlab turganini tekshiring.');
    process.exitCode = 1;
  }
}

void main();
