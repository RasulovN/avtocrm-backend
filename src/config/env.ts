import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 8000),
  HOST: process.env.HOST ?? '0.0.0.0',

  SECRET_KEY: required('SECRET_KEY', 'change-me-in-production'),
  ACCESS_TOKEN_TTL: Number(process.env.ACCESS_TOKEN_TTL ?? 60 * 60 * 24), // 1 day
  REFRESH_TOKEN_TTL: Number(process.env.REFRESH_TOKEN_TTL ?? 60 * 60 * 24 * 7), // 7 days

  DATABASE_URL: required('DATABASE_URL'),

  CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
  FRONTEND_URL: process.env.FRONTEND_URL ?? 'https://avtoyon.uz',
  // Public backend URL (email havolalari uchun)
  APP_URL: process.env.APP_URL ?? 'http://localhost:8000',
  EMAIL_VERIFICATION_TTL: Number(process.env.EMAIL_VERIFICATION_TTL ?? 60 * 60 * 24), // 24 soat

  // ===== Payme (Merchant API) =====
  PAYME_MERCHANT_ID: process.env.PAYME_MERCHANT_ID ?? '',
  PAYME_KEY: process.env.PAYME_KEY ?? '', // webhook Basic-auth paroli (X-Auth)
  PAYME_TEST_KEY: process.env.PAYME_TEST_KEY ?? '',
  PAYME_CHECKOUT_URL: process.env.PAYME_CHECKOUT_URL ?? 'https://checkout.paycom.uz',
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
