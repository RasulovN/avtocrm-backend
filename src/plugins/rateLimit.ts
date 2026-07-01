import type { FastifyRequest } from 'fastify';
import { TooManyRequests } from '../common/errors.js';

// ─────────────────────────────────────────────
// Oddiy, bog'liqliksiz (in-memory) rate-limiter.
// Fixed-window: har (kalit) uchun `windowMs` oynasida `max` so'rovga ruxsat.
// Bir instansda ishlaydi (backend nginx orqasida bitta process). Ko'p instans
// bo'lsa Redis'ga o'tkazish tavsiya etiladi.
// ─────────────────────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

// Vaqti o'tgan yozuvlarni tozalash (xotira o'smasligi uchun).
let lastSweep = Date.now();
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

export interface RateLimitOptions {
  // Oynadagi maksimal so'rovlar soni.
  max: number;
  // Oyna davomiyligi (millisekund).
  windowMs: number;
  // Limit uchun noyob nom (endpoint ajratish uchun).
  name: string;
}

// Berilgan sozlamalar bilan onRequest hook qaytaradi.
// Kalit: name + mijoz IP (nginx orqasida X-Forwarded-For; trustProxy:true).
export function rateLimit(opts: RateLimitOptions) {
  const { max, windowMs, name } = opts;
  return async (req: FastifyRequest): Promise<void> => {
    const now = Date.now();
    sweep(now);

    const key = `${name}:${req.ip}`;
    const bucket = store.get(key);

    if (!bucket || bucket.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    if (bucket.count >= max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      throw new TooManyRequests({
        detail: `Juda ko'p urinish. ${retryAfter} soniyadan so'ng qayta urinib ko'ring.`,
        retry_after: retryAfter,
      });
    }

    bucket.count += 1;
  };
}
