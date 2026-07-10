// ──────────────────────────────────────────────────────────────
// IP → geo (mamlakat/viloyat/shahar) — ip-api.com bepul xizmati orqali.
// Natija xotirada 7 kun keshlanadi (Redis yo'q — oddiy Map yetarli).
// Xatolar yutiladi: geo aniqlanmasa tashrif geo'siz saqlanadi.
// ──────────────────────────────────────────────────────────────

export interface GeoInfo {
  country: string | null;
  region: string | null;
  city: string | null;
}

const CACHE_TTL_MS = 7 * 24 * 3600_000;
const CACHE_MAX = 5000;
const LOOKUP_TIMEOUT_MS = 3500;

const cache = new Map<string, { geo: GeoInfo; expires: number }>();

function isPrivateIp(ip: string): boolean {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith('fe80:') ||
    ip.startsWith('fc') ||
    ip.startsWith('fd')
  );
}

export async function lookupGeo(rawIp: string): Promise<GeoInfo> {
  // IPv6-mapped IPv4 (::ffff:1.2.3.4) prefiksini olib tashlash
  const ip = rawIp.replace(/^::ffff:/i, '');
  if (!ip || isPrivateIp(ip)) return { country: 'Lokal tarmoq', region: null, city: null };

  const cached = cache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.geo;

  let geo: GeoInfo = { country: null, region: null, city: null };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LOOKUP_TIMEOUT_MS);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city`,
      { signal: ctrl.signal },
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { status?: string; country?: string; regionName?: string; city?: string };
      if (data.status === 'success') {
        geo = { country: data.country ?? null, region: data.regionName ?? null, city: data.city ?? null };
      }
    }
  } catch {
    /* geo ixtiyoriy — xato yutiladi */
  }

  // Kesh hajmini cheklash (eng eski yozuvlarni chiqarish)
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(ip, { geo, expires: Date.now() + CACHE_TTL_MS });
  return geo;
}
