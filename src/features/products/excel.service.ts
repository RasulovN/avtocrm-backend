import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { prisma } from '../../db/prisma.js';
import { ValidationError } from '../../common/errors.js';
import { generateBarcodeImage, generateUniqueBarcode, normalizeBarcode } from './barcode.js';

// Django apps/products/services/product_import_service.py ekvivalenti.

const VALID_STATUSES: Record<string, string> = {
  active: 'a',
  inactive: 'i',
  draft: 'd',
};

const REQUIRED_COLUMNS = new Set([
  'name',
  'category',
  'brand',
  'unit_measurement',
  'description',
  'status',
  'min_stock',
]);

const HEADER_MAP: Record<string, string> = {
  // O'zbekcha
  'nomi *': 'name',
  nomi: 'name',
  kategoriya: 'category',
  brend: 'brand',
  "o'lchov birligi": 'unit_measurement',
  tavsif: 'description',
  status: 'status',
  'min. qoldiq': 'min_stock',
  'minimal qoldiq': 'min_stock',
  'shtrix kod': 'barcode',
  artikul: 'sku',
  // Inglizcha
  name: 'name',
  category: 'category',
  brand: 'brand',
  unit_measurement: 'unit_measurement',
  description: 'description',
  min_stock: 'min_stock',
  barcode: 'barcode',
  sku: 'sku',
};

interface ImportResult {
  created: number;
  skipped: number;
  errors: Array<{ row: number; error: string }>;
}

function cellStr(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    // RichText / formula natijasi
    const obj = value as { text?: string; result?: unknown };
    if (typeof obj.text === 'string') return obj.text.trim();
    if (obj.result !== undefined) return String(obj.result).trim();
    return String(value).trim();
  }
  return String(value).trim();
}

function parseIntSafe(value: string, fallback = 0): number {
  const n = Number.parseInt(String(Number.parseFloat(value)), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(n, 0);
}

// ─────────────────────────────────────────────
// ProductImportService.import_from_excel
// ─────────────────────────────────────────────
export async function importFromExcel(companyId: number, buffer: Buffer): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ValidationError({
      detail: "Excel faylni o'qib bo'lmadi. Fayl .xlsx formatida bo'lishi kerak.",
    });
  }

  const ws = wb.worksheets[0];
  if (!ws) {
    throw new ValidationError({ detail: "Excel fayl bo'sh." });
  }

  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    // exceljs row.values[0] bo'sh; 1-indeksdan boshlanadi
    const raw = row.values as ExcelJS.CellValue[];
    for (let i = 1; i < raw.length; i += 1) {
      values.push(cellStr(raw[i]));
    }
    rows.push(values);
  });

  if (rows.length === 0) {
    throw new ValidationError({ detail: "Excel fayl bo'sh." });
  }

  // Header normalize
  const rawHeaders = rows[0]!.map((h) => h.toLowerCase().trim());
  const mappedHeaders = rawHeaders.map((h) => HEADER_MAP[h] ?? h);

  const missing = [...REQUIRED_COLUMNS].filter((c) => !mappedHeaders.includes(c));
  if (missing.length > 0) {
    throw new ValidationError({ detail: `Ustunlar topilmadi: ${missing.join(', ')}` });
  }

  const col: Record<string, number> = {};
  mappedHeaders.forEach((name, idx) => {
    if (!(name in col)) col[name] = idx;
  });

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    throw new ValidationError({ detail: "Shablon bo'sh — ma'lumot qatorlari yo'q." });
  }

  const getCell = (row: string[], key: string): string => {
    const idx = col[key];
    if (idx === undefined) return '';
    return row[idx] ?? '';
  };

  const hasBarcode = 'barcode' in col;
  const hasSku = 'sku' in col;

  // Lookup map'lar (N+1 oldini olish)
  const catNames = new Set<string>();
  const brandNames = new Set<string>();
  const unitNames = new Set<string>();
  for (const r of dataRows) {
    const c = getCell(r, 'category');
    if (c) catNames.add(c);
    const b = getCell(r, 'brand');
    if (b) brandNames.add(b);
    const u = getCell(r, 'unit_measurement');
    if (u) unitNames.add(u);
  }

  const categoryMap = await buildCategoryMap(companyId, catNames);
  const brandMap = await buildBrandMap(companyId, brandNames);
  const unitMap = await buildUnitMap(companyId, unitNames);

  // mavjud barcode/sku (provided)
  const providedBarcodes = new Set<string>();
  if (hasBarcode) {
    for (const r of dataRows) {
      const raw = getCell(r, 'barcode');
      if (raw) {
        try {
          providedBarcodes.add(normalizeBarcode(raw));
        } catch {
          // yaroqsizlar qatorlar bo'yicha ushlanadi
        }
      }
    }
  }
  const existingBarcodes = providedBarcodes.size
    ? new Set(
        (
          await prisma.product.findMany({
            where: { companyId, barcode: { in: [...providedBarcodes] } },
            select: { barcode: true },
          })
        ).map((p) => p.barcode!),
      )
    : new Set<string>();

  const providedSkus = new Set<string>();
  if (hasSku) {
    for (const r of dataRows) {
      const raw = getCell(r, 'sku');
      if (raw) providedSkus.add(raw);
    }
  }
  const existingSkus = providedSkus.size
    ? new Set(
        (
          await prisma.product.findMany({
            where: { companyId, sku: { in: [...providedSkus] } },
            select: { sku: true },
          })
        ).map((p) => p.sku!),
      )
    : new Set<string>();

  interface PendingRow {
    rowNum: number;
    name: string;
    categoryId: number | null;
    categorySlug: string | null;
    categoryName: string | null;
    brandId: number | null;
    unitId: number | null;
    description: string;
    status: string;
    minStock: number;
    barcode: string | null;
    sku: string | null;
  }

  const toCreate: PendingRow[] = [];
  const errors: Array<{ row: number; error: string }> = [];
  const seenBarcodes = new Set<string>();
  const seenSkus = new Set<string>();

  dataRows.forEach((row, i) => {
    const rowNum = i + 2;
    const name = getCell(row, 'name');
    if (!name) {
      errors.push({ row: rowNum, error: "name bo'sh — qator o'tkazib yuborildi" });
      return;
    }

    const statusRaw = getCell(row, 'status').toLowerCase();
    const status = VALID_STATUSES[statusRaw] ?? 'a';
    const unitName = getCell(row, 'unit_measurement') || 'dona';
    const minStock = parseIntSafe(getCell(row, 'min_stock'), 0);

    let barcodeVal: string | null = null;
    if (hasBarcode) {
      const rawBc = getCell(row, 'barcode');
      if (rawBc) {
        try {
          barcodeVal = normalizeBarcode(rawBc);
        } catch {
          errors.push({ row: rowNum, error: 'barcode yaroqsiz (faqat 12-13 raqamli EAN-13)' });
          return;
        }
        if (existingBarcodes.has(barcodeVal) || seenBarcodes.has(barcodeVal)) {
          errors.push({ row: rowNum, error: `barcode takrorlangan: ${barcodeVal}` });
          return;
        }
        seenBarcodes.add(barcodeVal);
      }
    }

    let skuVal: string | null = null;
    if (hasSku) {
      const rawSku = getCell(row, 'sku');
      if (rawSku) {
        if (existingSkus.has(rawSku) || seenSkus.has(rawSku)) {
          errors.push({ row: rowNum, error: `sku takrorlangan: ${rawSku}` });
          return;
        }
        seenSkus.add(rawSku);
        skuVal = rawSku;
      }
    }

    const cat = categoryMap.get(getCell(row, 'category').toLowerCase());

    toCreate.push({
      rowNum,
      name,
      categoryId: cat?.id ?? null,
      categorySlug: cat?.slug ?? null,
      categoryName: cat?.name ?? null,
      brandId: brandMap.get(getCell(row, 'brand').toLowerCase()) ?? null,
      unitId: unitMap.get(unitName.toLowerCase()) ?? null,
      description: getCell(row, 'description'),
      status,
      minStock,
      barcode: barcodeVal,
      sku: skuVal,
    });
  });

  if (toCreate.length === 0) {
    return { created: 0, skipped: dataRows.length, errors };
  }

  // Har birini alohida save() ekvivalenti — SKU/barcode/shtrix generatsiya bilan
  let createdCount = 0;
  for (const p of toCreate) {
    try {
      const created = await prisma.product.create({
        data: {
          companyId, // tenant-scope: import qilingan mahsulot shu company ostida
          name: p.name,
          categoryId: p.categoryId,
          brandId: p.brandId,
          unitMeasurementId: p.unitId,
          description: p.description,
          status: p.status,
          minStock: p.minStock,
          barcode: p.barcode,
          sku: p.sku,
        },
      });

      const finalBarcode = p.barcode ?? (await generateUniqueBarcode(companyId));
      const finalSku = p.sku ?? generateImportSku(p.categoryName, created.id);
      const shtrixPath = await generateBarcodeImage(finalBarcode, p.categorySlug);

      await prisma.product.update({
        where: { id: created.id },
        data: { barcode: finalBarcode, sku: finalSku, shtrixCode: shtrixPath },
      });

      createdCount += 1;
    } catch (e) {
      errors.push({ row: p.rowNum, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const skippedFromName = errors.filter((e) => e.error.includes("o'tkazib yuborildi")).length;
  const skipped = Math.max(dataRows.length - createdCount - skippedFromName, 0);

  return { created: createdCount, skipped, errors };
}

// Product.generate_sku ekvivalenti (import uchun)
function generateImportSku(categoryName: string | null, id: number): string {
  let prefix = 'PRD';
  if (categoryName) {
    const words = categoryName.trim().split(/\s+/).filter(Boolean);
    const built = words.map((w) => w[0]!.toUpperCase()).join('');
    if (built) prefix = built;
  }
  return `${prefix}-${String(id).padStart(6, '0')}`;
}

async function buildCategoryMap(
  companyId: number,
  names: Set<string>,
): Promise<Map<string, { id: number; slug: string; name: string }>> {
  const map = new Map<string, { id: number; slug: string; name: string }>();
  if (names.size === 0) return map;
  const cats = await prisma.category.findMany({
    where: { companyId, name: { in: [...names] } },
    select: { id: true, slug: true, name: true },
  });
  for (const c of cats) map.set(c.name.toLowerCase(), c);
  return map;
}

async function buildBrandMap(companyId: number, names: Set<string>): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (names.size === 0) return map;
  const brands = await prisma.brand.findMany({
    where: { companyId, name: { in: [...names] } },
    select: { id: true, name: true },
  });
  for (const b of brands) map.set(b.name.toLowerCase(), b.id);
  return map;
}

// Mavjud bo'lmagan o'lchov birliklari yaratiladi (Django: bulk_create) — tenant-scope
async function buildUnitMap(companyId: number, names: Set<string>): Promise<Map<string, number>> {
  const all = new Set(names);
  all.add('dona');
  const map = new Map<string, number>();

  const existing = await prisma.productUnitMeasurement.findMany({
    where: { companyId, measurement: { in: [...all] } },
    select: { id: true, measurement: true },
  });
  for (const u of existing) map.set(u.measurement.toLowerCase(), u.id);

  const toCreate: Prisma.ProductUnitMeasurementCreateManyInput[] = [];
  for (const name of all) {
    if (!map.has(name.toLowerCase())) {
      toCreate.push({ companyId, measurement: name });
    }
  }
  if (toCreate.length > 0) {
    await prisma.productUnitMeasurement.createMany({ data: toCreate });
    const refreshed = await prisma.productUnitMeasurement.findMany({
      where: { companyId, measurement: { in: toCreate.map((u) => u.measurement) } },
      select: { id: true, measurement: true },
    });
    for (const u of refreshed) map.set(u.measurement.toLowerCase(), u.id);
  }

  return map;
}

// ─────────────────────────────────────────────
// ProductImportTemplateAPIView — shablon faylini generatsiya qiladi
//   (Django statik fayl o'rniga exceljs bilan dinamik shablon yaratamiz)
// ─────────────────────────────────────────────
export async function buildImportTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Mahsulotlar');
  ws.columns = [
    { header: 'nomi *', key: 'name', width: 30 },
    { header: 'kategoriya', key: 'category', width: 20 },
    { header: 'brend', key: 'brand', width: 20 },
    { header: "o'lchov birligi", key: 'unit_measurement', width: 18 },
    { header: 'tavsif', key: 'description', width: 30 },
    { header: 'status', key: 'status', width: 12 },
    { header: 'min. qoldiq', key: 'min_stock', width: 12 },
    { header: 'shtrix kod', key: 'barcode', width: 18 },
    { header: 'artikul', key: 'sku', width: 18 },
  ];
  ws.getRow(1).font = { bold: true };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
