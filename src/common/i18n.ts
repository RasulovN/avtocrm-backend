import type { FastifyRequest } from 'fastify';

// Qo'llab-quvvatlanadigan tillar. 'uz' — asosiy (fallback) til.
export type Lang = 'uz' | 'ru' | 'en' | 'cyrl';

// So'rovning Accept-Language sarlavhasidan tilni aniqlaydi.
// uz-cyrl / cyrl -> 'cyrl'; ru -> 'ru'; en -> 'en'; aks holda 'uz' (default).
export function resolveLang(req: FastifyRequest): Lang {
  const raw = (req.headers['accept-language'] ?? '').toString().toLowerCase().trim();
  if (!raw) return 'uz';
  // Faqat birinchi tilni olamiz (masalan "ru,en;q=0.9" -> "ru")
  const primary = raw.split(',')[0]?.split(';')[0]?.trim() ?? '';
  if (primary === 'uz-cyrl' || primary === 'cyrl' || primary.startsWith('uz-cyrl')) return 'cyrl';
  if (primary === 'ru' || primary.startsWith('ru')) return 'ru';
  if (primary === 'en' || primary.startsWith('en')) return 'en';
  return 'uz';
}

// Ixtiyoriy maydonlar uchun til tanlovchi: uz (asosiy/fallback) + ru/en/cyrl.
// Tarjima bo'sh bo'lsa — uz ga fallback.
export function pickLang(
  uz: string | null | undefined,
  ru: string | null | undefined,
  en: string | null | undefined,
  cyrl: string | null | undefined,
  lang: Lang,
): string | null {
  const base = uz ?? null;
  switch (lang) {
    case 'ru':
      return ru || base;
    case 'en':
      return en || base;
    case 'cyrl':
      return cyrl || base;
    default:
      return base;
  }
}

// Lokalizatsiya maydonlari uchun umumiy shakl.
// base='name' bo'lsa: name, nameRu, nameEn, nameUzCyrl maydonlarini o'qiydi.
type LocalizedFields = {
  name?: string | null;
  nameRu?: string | null;
  nameEn?: string | null;
  nameUzCyrl?: string | null;
  description?: string | null;
  descriptionRu?: string | null;
  descriptionEn?: string | null;
  descriptionUzCyrl?: string | null;
};

// So'rov tiliga mos qiymatni qaytaradi. Tarjima bo'lmasa — uz (asosiy) ga fallback.
// base = 'name' yoki 'description'.
export function pickLocalized(
  obj: LocalizedFields,
  base: 'name' | 'description',
  lang: Lang,
): string | null {
  if (base === 'name') {
    const uz = obj.name ?? null;
    switch (lang) {
      case 'ru':
        return obj.nameRu || uz;
      case 'en':
        return obj.nameEn || uz;
      case 'cyrl':
        return obj.nameUzCyrl || uz;
      default:
        return uz;
    }
  }
  const uz = obj.description ?? null;
  switch (lang) {
    case 'ru':
      return obj.descriptionRu || uz;
    case 'en':
      return obj.descriptionEn || uz;
    case 'cyrl':
      return obj.descriptionUzCyrl || uz;
    default:
      return uz;
  }
}

// Barcha tillardagi qiymatlarni obyekt sifatida qaytaradi (admin forma uchun).
export function translationsOf(obj: LocalizedFields, base: 'name' | 'description') {
  if (base === 'name') {
    return {
      uz: obj.name ?? null,
      ru: obj.nameRu ?? null,
      en: obj.nameEn ?? null,
      cyrl: obj.nameUzCyrl ?? null,
    };
  }
  return {
    uz: obj.description ?? null,
    ru: obj.descriptionRu ?? null,
    en: obj.descriptionEn ?? null,
    cyrl: obj.descriptionUzCyrl ?? null,
  };
}
