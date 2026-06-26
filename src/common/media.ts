import { env } from '../config/env.js';

// DB'da saqlangan nisbiy media yo'lini (`products/...`, `categories/...`)
// frontend uchun URL'ga aylantiradi: `/media/products/...`.
// Allaqachon to'liq URL yoki /media/ bilan boshlanса — tegmaydi.
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path) || path.startsWith(env.MEDIA_URL)) return path;
  const clean = path.replace(/^\/+/, '');
  return `${env.MEDIA_URL}${clean}`;
}
