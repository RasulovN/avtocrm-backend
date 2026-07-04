// Yagona "ContactInfo" modeli — landing (site-settings) va kompaniya
// sozlamalari uchun bir xil shaklda ishlatiladi. JSON sifatida saqlanadi.

export interface SocialLink {
  name: string;
  url: string;
  // Ixtiyoriy icon kaliti (telegram, instagram, ...) — landing shu bo'yicha
  // SVG tanlaydi. Bo'lmasa nomdan taxmin qilinadi (eski ma'lumotlar uchun).
  icon?: string;
}

export interface ContactInfo {
  phone: string;
  phoneHref: string;
  email: string;
  address: string;
  location: { lat: number; lng: number } | null;
  socials: SocialLink[];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function normSocials(raw: unknown): SocialLink[] {
  if (Array.isArray(raw)) {
    return raw
      .map((s) => {
        const link: SocialLink = {
          name: str((s as SocialLink)?.name).trim(),
          url: str((s as SocialLink)?.url).trim(),
        };
        const icon = str((s as SocialLink)?.icon).trim().toLowerCase().slice(0, 30);
        if (icon) link.icon = icon;
        return link;
      })
      .filter((s) => s.name && s.url);
  }
  // Eski format: { telegram: 'url', instagram: 'url', ... } -> massivga.
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), url: str(v).trim() }))
      .filter((s) => s.url);
  }
  return [];
}

function normLocation(raw: unknown): { lat: number; lng: number } | null {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const lat = Number(o.lat);
    const lng = Number(o.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

// Har qanday (eski/yangi/qisman) shakldagi qiymatni to'liq ContactInfo'ga keltiradi.
export function normalizeContact(raw: unknown, defaults: ContactInfo): ContactInfo {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  // Eski landing shakli ma'lumotni `contact` ichida saqlagan bo'lishi mumkin.
  const c = (r.contact && typeof r.contact === 'object' ? (r.contact as Record<string, unknown>) : r) as Record<string, unknown>;

  const socials = normSocials(r.socials ?? c.socials ?? defaults.socials);
  // Eski telegram maydonlari -> Telegram social (agar yo'q bo'lsa).
  const tgUrl = str(c.telegramUrl);
  if (tgUrl && !socials.some((s) => /telegram/i.test(s.name))) {
    socials.unshift({ name: 'Telegram', url: tgUrl });
  }

  return {
    phone: str(c.phone) || defaults.phone,
    phoneHref: str(c.phoneHref) || defaults.phoneHref,
    email: str(c.email) || defaults.email,
    address: str(c.address) || defaults.address,
    location: normLocation(c.location) ?? defaults.location,
    socials: socials.length ? socials : defaults.socials,
  };
}

export const EMPTY_CONTACT: ContactInfo = {
  phone: '',
  phoneHref: '',
  email: '',
  address: '',
  location: null,
  socials: [],
};
