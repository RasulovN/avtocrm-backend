// Django apps/products/utils/barcode_utility.py ekvivalenti.
// Django `python-barcode` (EAN-13) ishlatadi; bu yerda Node `bwip-js` bilan
// EAN-13 rasm generatsiya qilinadi. EAN-13 checksum qo'lda hisoblanadi.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import bwipjs from 'bwip-js/node';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';

// ─────────────────────────────────────────────
// EAN-13 checksum (python-barcode get_fullcode ekvivalenti)
// ─────────────────────────────────────────────

// 12 raqamli (yoki to'liq 13 raqamli) qiymatdan EAN-13 checksum hisoblaydi.
function ean13CheckDigit(twelveDigits: string): number {
  // EAN-13: o'ngdan chapga toq pozitsiyalar *3, juftlar *1.
  // 12 ta raqam uchun (chapdan): indeks 0,2,4.. *1; 1,3,5.. *3.
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(twelveDigits[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

// 12 yoki 13 raqamli qiymatni to'liq 13 raqamli EAN-13 ga keltiradi (checksum bilan).
function toFullEan13(value: string): string {
  if (value.length === 13) {
    // Berilgan checksum'ni e'tiborga olmasdan, 12 raqam asosida qayta hisoblaymiz
    // (python-barcode ham xuddi shunday qiladi).
    const base = value.slice(0, 12);
    return base + String(ean13CheckDigit(base));
  }
  // 12 raqam
  return value + String(ean13CheckDigit(value));
}

// ─────────────────────────────────────────────
// normalize_barcode
// ─────────────────────────────────────────────

// Qo'lda kiritilgan barcode'ni EAN-13 formatga keltiradi (12-13 raqam -> 13 raqam checksum bilan).
// Yaroqsiz qiymatda xato (Error) ko'taradi — chaqiruvchi ushlaydi.
export function normalizeBarcode(value: string): string {
  const v = (value ?? '').trim();
  if (!/^\d+$/.test(v)) {
    throw new Error("Barcode faqat raqamlardan iborat bo'lishi kerak.");
  }
  if (v.length !== 12 && v.length !== 13) {
    throw new Error("Barcode 12 yoki 13 raqamdan iborat bo'lishi kerak.");
  }
  return toFullEan13(v);
}

// ─────────────────────────────────────────────
// generate_unique_barcode
// ─────────────────────────────────────────────

// 12 ta random raqam + checksum -> 13 raqamli EAN-13. DB'da unique bo'lguncha qayta urinadi.
// Unikallik tenant doirasida tekshiriladi (barcode @@unique([companyId, barcode])).
export async function generateUniqueBarcode(companyId: number): Promise<string> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let code = '';
    for (let i = 0; i < 12; i += 1) {
      code += String(Math.floor(Math.random() * 10));
    }
    const fullCode = toFullEan13(code);
    const existing = await prisma.product.findFirst({
      where: { companyId, barcode: fullCode },
      select: { id: true },
    });
    if (!existing) {
      return fullCode;
    }
  }
}

// ─────────────────────────────────────────────
// generate_barcode_image
// ─────────────────────────────────────────────

// Django shtrix rasm yo'l strukturasi: path_utility.product_barcode_path
//   products/{category_slug}/barcodes/{filename}
// Bu yerda PNG fayl assets/media/ ostiga yoziladi va DB uchun nisbiy path qaytariladi.
export async function generateBarcodeImage(
  barcodeNumber: string,
  categorySlug: string | null,
): Promise<string> {
  const slug = categorySlug || 'uncategorized';
  const relativePath = join('products', slug, 'barcodes', `${barcodeNumber}.png`).replace(/\\/g, '/');
  const absolutePath = join(process.cwd(), env.MEDIA_ROOT, relativePath);

  const png = await bwipjs.toBuffer({
    bcid: 'ean13',
    text: barcodeNumber,
    includetext: true,
    textxalign: 'center',
    scale: 3,
    height: 10,
  });

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, png);

  return relativePath;
}
