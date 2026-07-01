import crypto from 'node:crypto';
import { env } from '../config/env.js';

// Django PasswordResetTokenGenerator ekvivalenti (soddalashtirilgan, lekin xavfsiz).
// Token user.id + parol-hash + timestamp asosida HMAC bilan imzolanadi, 1 soat amal qiladi.

const TIMEOUT_SECONDS = 60 * 60; // 1 soat

export function encodeUid(userId: number): string {
  return Buffer.from(String(userId)).toString('base64url');
}

export function decodeUid(uidb64: string): number {
  return Number(Buffer.from(uidb64, 'base64url').toString('utf8'));
}

function makeHash(userId: number, passwordHash: string, ts: number): string {
  const value = `${userId}${passwordHash}${ts}`;
  return crypto.createHmac('sha256', env.SECRET_KEY).update(value).digest('base64url');
}

export function makeToken(userId: number, passwordHash: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const hash = makeHash(userId, passwordHash, ts);
  return `${ts}-${hash}`;
}

export function checkToken(userId: number, passwordHash: string, token: string): boolean {
  // DIQQAT: imzo (hash) base64url — ichida `-` bo'lishi mumkin. Shuning uchun
  // FAQAT birinchi `-` bo'yicha ajratamiz (split('-') bilan bo'lsa hash ichidagi
  // `-` tufayli token noto'g'ri rad etilardi).
  const idx = token.indexOf('-');
  if (idx === -1) return false;
  const ts = Number(token.slice(0, idx));
  const sig = token.slice(idx + 1);
  if (!Number.isFinite(ts)) return false;
  if (Math.floor(Date.now() / 1000) - ts > TIMEOUT_SECONDS) return false;
  const expected = makeHash(userId, passwordHash, ts);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
