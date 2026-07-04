import { prisma } from '../db/prisma.js';

// ──────────────────────────────────────────────────────────────
// Kunlik foydalanish hisoblagichi — mijoz (kompaniya) foydalanuvchilarining
// faolligini xotirada yig'ib, davriy ravishda usage_daily jadvaliga qo'shadi.
// Har so'rovda DB yozuvi bo'lmasligi uchun buffer + flush arxitekturasi.
// Statistika hech qachon asosiy oqimni buzmaydi (barcha xatolar yutiladi).
// ──────────────────────────────────────────────────────────────

interface Counters {
  requests: number;
  logins: number;
  actions: number;
}

// key: `${companyId}:${userId}:${YYYY-MM-DD}`
const buffer = new Map<string, Counters>();

// Asia/Tashkent (UTC+5, DST yo'q) bo'yicha bugungi sana
export function tashkentToday(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

export function trackUsage(companyId: number, userId: number, inc: Partial<Counters>): void {
  const key = `${companyId}:${userId}:${tashkentToday()}`;
  const c = buffer.get(key) ?? { requests: 0, logins: 0, actions: 0 };
  c.requests += inc.requests ?? 0;
  c.logins += inc.logins ?? 0;
  c.actions += inc.actions ?? 0;
  buffer.set(key, c);
}

// Bufferni DB'ga o'tkazish (upsert: mavjud kun qatoriga qo'shib boradi).
export async function flushUsage(): Promise<void> {
  if (buffer.size === 0) return;
  const entries = [...buffer.entries()];
  buffer.clear();
  for (const [key, c] of entries) {
    const [companyId, userId, date] = key.split(':');
    try {
      await prisma.$executeRaw`
        INSERT INTO usage_daily (company_id, user_id, date, requests, logins, actions)
        VALUES (${Number(companyId)}, ${Number(userId)}, ${date}::date, ${c.requests}, ${c.logins}, ${c.actions})
        ON CONFLICT (company_id, user_id, date)
        DO UPDATE SET
          requests = usage_daily.requests + EXCLUDED.requests,
          logins   = usage_daily.logins   + EXCLUDED.logins,
          actions  = usage_daily.actions  + EXCLUDED.actions`;
    } catch {
      // FK buzilishi (foydalanuvchi/kompaniya o'chirilgan) yoki vaqtinchalik DB
      // xatosi — statistika yo'qoladi, lekin ilova ishlashda davom etadi.
    }
  }
}
