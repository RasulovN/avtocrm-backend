import { ValidationError } from './errors.js';

// ─────────────────────────────────────────────
// Yuklangan rasm fayllarini xavfsiz tekshirish.
// Faqat rost rasm fayllarini qabul qilamiz — kengaytma foydalanuvchi
// nomidan olinadi, shuning uchun kontent (magic bytes) bo'yicha tekshiramiz.
// Bu .html/.svg/.php kabi fayllar orqali saqlangan XSS/RCE'ning oldini oladi.
// ─────────────────────────────────────────────

// Ruxsat etilgan tur -> xavfsiz kengaytma.
const ALLOWED = [
  { ext: '.jpg', test: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff }, // JPEG
  { ext: '.png', test: (b: Buffer) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 }, // PNG
  {
    ext: '.webp',
    test: (b: Buffer) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, // WEBP
  },
  { ext: '.gif', test: (b: Buffer) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 }, // GIF
] as const;

// Rasm buffer'ini tekshiradi va xavfsiz kengaytmani qaytaradi.
// Rasm bo'lmasa ValidationError tashlaydi.
export function resolveImageExtension(buffer: Buffer): string {
  if (!buffer || buffer.length < 12) {
    throw new ValidationError({ images: ["Yaroqsiz yoki bo'sh rasm fayli."] });
  }
  for (const { ext, test } of ALLOWED) {
    if (test(buffer)) return ext;
  }
  throw new ValidationError({
    images: ['Faqat rasm fayllari (JPG, PNG, WEBP, GIF) qabul qilinadi.'],
  });
}
