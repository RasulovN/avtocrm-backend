import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const IS_PROD = NODE_ENV === 'production';

// SECRET_KEY — JWT imzolash kaliti. Production'da MAJBURIY va kuchli bo'lishi shart.
// Zaif/default (django-insecure...) kalitlar bilan ishga tushirishga yo'l qo'ymaymiz,
// aks holda tajovuzkor istalgan foydalanuvchi uchun token soxtalashtira oladi.
function resolveSecretKey(): string {
  const key = process.env.SECRET_KEY;
  if (IS_PROD) {
    if (!key) throw new Error('SECRET_KEY production uchun majburiy');
    if (key.length < 32 || key.startsWith('django-insecure') || key === 'change-me-in-production') {
      throw new Error(
        'SECRET_KEY zaif yoki default. Production uchun kamida 32 belgili tasodifiy kalit bering ' +
          "(masalan: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\").",
      );
    }
    return key;
  }
  // Development: qulaylik uchun fallback ruxsat.
  return key ?? 'dev-only-insecure-secret-key-change-in-production';
}

// HOST default rejimga bog'liq:
//  - production: 127.0.0.1 — faqat localhost. Backend reverse-proxy (nginx) orqasida
//    turadi, shuning uchun public portda (0.0.0.0) ochiq bo'lishi shart emas va xavfli.
//  - development: 0.0.0.0 — LAN'dagi qurilmalardan ham test qilish qulay.
// .env'da HOST aniq berilsa, o'sha ustun bo'ladi.
const defaultHost = NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0';

// ===== Payme rejimi (test / production) =====
// PAYME_TEST_MODE=1 -> sandbox: test kalit + https://test.paycom.uz
// PAYME_TEST_MODE=0 -> production: asosiy kalit + https://checkout.paycom.uz
// Bitta o'zgaruvchi bilan butun oqim (auth kaliti + checkout sahifasi) almashadi.
const PAYME_TEST_MODE = (process.env.PAYME_TEST_MODE ?? '1') === '1';
const PAYME_MERCHANT_ID = process.env.PAYME_MERCHANT_ID ?? '';
const PAYME_KEY = process.env.PAYME_KEY ?? '';
const PAYME_TEST_KEY = process.env.PAYME_TEST_KEY ?? '';
// Faol kalit — webhook Basic-auth tekshiruvida ishlatiladi.
// Agar bitta PAYME_SECRET_KEY berilsa (boshqa loyihalardagi kabi), o'sha ishlatiladi;
// aks holda rejimga (TEST_MODE) qarab test yoki prod kaliti tanlanadi.
const PAYME_SECRET_KEY = process.env.PAYME_SECRET_KEY ?? '';
const PAYME_ACTIVE_KEY = PAYME_SECRET_KEY || (PAYME_TEST_MODE ? PAYME_TEST_KEY : PAYME_KEY);
// Checkout sahifasi (mijozni to'lovga yo'naltirish) — DOIM https://checkout.paycom.uz.
// DIQQAT: test.paycom.uz bu checkout EMAS, balki Merchant API sandbox konsoli — u yerga
// mijoz yo'naltirilmaydi. Test kassada checkout.paycom.uz test kartalarini ko'rsatadi.
// PAYME_TEST_MODE faqat webhook auth kalitini almashtiradi, checkout manzilini emas.
const PAYME_CHECKOUT_URL =
  (process.env.PAYME_CHECKOUT_URL ?? '').trim() || 'https://checkout.paycom.uz';
// Subscribe API (karta tokenizatsiya + receipts) endpoint — JSON-RPC.
// TEST_MODE=1 -> checkout.test.paycom.uz, aks holda checkout.paycom.uz. `/api` qo'shiladi.
// MUHIM: endpoint `/api` bilan tugashi SHART (JSON-RPC). Berilgan qiymatda `/api`
// bo'lmasa avtomatik qo'shamiz.
const PAYME_SUBSCRIBE_URL = (() => {
  const raw =
    (process.env.PAYME_SUBSCRIBE_URL ?? '').trim() ||
    (PAYME_TEST_MODE ? 'https://checkout.test.paycom.uz' : 'https://checkout.paycom.uz');
  const trimmed = raw.replace(/\/+$/, '');
  return /\/api$/.test(trimmed) ? trimmed : `${trimmed}/api`;
})();
// Subscribe API odatda alohida "Virtual terminal" kassasini talab qiladi (Merchant API
// webhook kassasidan boshqa). Alohida berilmasa — asosiy merchant/kalitga tushadi.
const PAYME_SUBSCRIBE_MERCHANT_ID =
  (process.env.PAYME_SUBSCRIBE_MERCHANT_ID ?? '').trim() || PAYME_MERCHANT_ID;
const PAYME_SUBSCRIBE_KEY = (process.env.PAYME_SUBSCRIBE_KEY ?? '').trim() || PAYME_ACTIVE_KEY;
// Webhook uchun ruxsat etilgan IP'lar (vergul bilan; IP yoki CIDR). Bo'sh = barchasi.
const PAYME_ALLOWED_IPS = (process.env.PAYME_ALLOWED_IPS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const env = {
  NODE_ENV,
  PORT: Number(process.env.PORT ?? 8000),
  HOST: process.env.HOST ?? defaultHost,

  SECRET_KEY: resolveSecretKey(),
  ACCESS_TOKEN_TTL: Number(process.env.ACCESS_TOKEN_TTL ?? 60 * 60 * 24), // 1 day
  REFRESH_TOKEN_TTL: Number(process.env.REFRESH_TOKEN_TTL ?? 60 * 60 * 24 * 7), // 7 days

  DATABASE_URL: required('DATABASE_URL'),

  CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
  FRONTEND_URL: process.env.FRONTEND_URL ?? 'https://zumex.uz',
  // Public backend URL (email havolalari uchun)
  APP_URL: process.env.APP_URL ?? 'http://localhost:8000',
  EMAIL_VERIFICATION_TTL: Number(process.env.EMAIL_VERIFICATION_TTL ?? 60 * 60 * 24), // 24 soat

  // ===== Payme (Merchant API) =====
  PAYME_TEST_MODE, // true = sandbox, false = production
  PAYME_MERCHANT_ID,
  PAYME_KEY, // production kaliti
  PAYME_TEST_KEY, // sandbox kaliti
  PAYME_ACTIVE_KEY, // rejimga mos faol kalit (Basic-auth)
  PAYME_CHECKOUT_URL, // rejimga mos checkout sahifasi
  PAYME_SUBSCRIBE_URL, // Subscribe API (cards/receipts) endpoint
  PAYME_SUBSCRIBE_MERCHANT_ID, // Subscribe API kassa id (default: PAYME_MERCHANT_ID)
  PAYME_SUBSCRIBE_KEY, // Subscribe API kassa kaliti (default: PAYME_ACTIVE_KEY)
  PAYME_ALLOWED_IPS, // ruxsat etilgan IP/CIDR ro'yxati (bo'sh = barchasi)
  // Payme account field nomi (checkout link uchun) — bizda subscription id
  PAYME_ACCOUNT_FIELD: process.env.PAYME_ACCOUNT_FIELD ?? 'subscription_id',

  // ===== Yandex Maps =====
  YANDEX_MAPS_API_KEY: process.env.YANDEX_MAPS_API_KEY ?? '',

  EMAIL_HOST: process.env.EMAIL_HOST ?? '',
  EMAIL_PORT: Number(process.env.EMAIL_PORT ?? 587),
  EMAIL_USE_TLS: (process.env.EMAIL_USE_TLS ?? 'true') === 'true',
  EMAIL_HOST_USER: process.env.EMAIL_HOST_USER ?? '',
  EMAIL_HOST_PASSWORD: process.env.EMAIL_HOST_PASSWORD ?? '',
  DEFAULT_FROM_EMAIL: process.env.DEFAULT_FROM_EMAIL ?? process.env.EMAIL_HOST_USER ?? '',

  MEDIA_ROOT: process.env.MEDIA_ROOT ?? 'assets/media',
  MEDIA_URL: process.env.MEDIA_URL ?? '/media/',
};

export const isDev = env.NODE_ENV !== 'production';
