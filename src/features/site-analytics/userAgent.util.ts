// ──────────────────────────────────────────────────────────────
// Yengil User-Agent tahlilchisi — tashqi kutubxonasiz.
// Maqsad: qurilma turi / OS / brauzer taxminiy aniqlash + botlarni filtrlash.
// ──────────────────────────────────────────────────────────────

export interface ParsedUA {
  deviceType: 'desktop' | 'mobile' | 'tablet';
  os: string | null;
  browser: string | null;
  isBot: boolean;
}

const BOT_RE =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|headless|lighthouse|pingdom|uptime|monitor|scrapy|python-requests|curl|wget|axios|go-http-client/i;

export function parseUserAgent(ua: string | undefined): ParsedUA {
  const s = ua ?? '';
  if (!s || BOT_RE.test(s)) {
    return { deviceType: 'desktop', os: null, browser: null, isBot: true };
  }

  // Qurilma turi
  const isTablet = /iPad|Tablet|Nexus 7|Nexus 10|SM-T/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s));
  const isMobile = !isTablet && /Mobi|iPhone|Android.*Mobile|Windows Phone/i.test(s);
  const deviceType = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';

  // OS
  let os: string | null = null;
  if (/Windows NT 11|Windows NT 10/i.test(s)) os = 'Windows';
  else if (/Windows/i.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Mac OS X/i.test(s)) os = 'macOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Linux/i.test(s)) os = 'Linux';

  // Brauzer (tartib muhim: Edge/Opera Chrome'dan oldin tekshiriladi)
  let browser: string | null = null;
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(s)) browser = 'Samsung Internet';
  else if (/YaBrowser/i.test(s)) browser = 'Yandex';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Chrome\//i.test(s)) browser = 'Chrome';
  else if (/Safari\//i.test(s)) browser = 'Safari';

  return { deviceType, os, browser, isBot: false };
}
