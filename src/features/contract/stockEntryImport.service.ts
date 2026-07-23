import ExcelJS from 'exceljs';
import { prisma } from '../../db/prisma.js';
import { ValidationError } from '../../common/errors.js';
import { createEntry } from './stockEntry.service.js';

// Django apps/contract/services/stock_entry_import_service.py ekvivalenti.
// Oqim: Excel fayl → parse + validatsiya → mahsulotlarni aniqlash (barcode/sku/nom)
//       → items ro'yxati → createEntry() → StockEntry.
// Supplier, cash_amount, card_amount va do'kon API darajasida beriladi;
// mahsulot satrlari (nom/barcode/sku, miqdor, narxlar) Excelda joylashadi.

// Bitta importdagi maksimal satr — RAM/tranzaksiya himoyasi.
const MAX_ROWS = 5000;

const REQUIRED_COLUMNS = ['quantity', 'purchase_price', 'selling_price'] as const;
const IDENTIFIER_COLUMNS = ['barcode', 'sku', 'name'] as const;

const HEADER_MAP: Record<string, string> = {
  // Identifikatorlar
  barcode: 'barcode',
  'shtrix kod': 'barcode',
  'shtrix-kod': 'barcode',
  sku: 'sku',
  artikul: 'sku',
  name: 'name',
  nomi: 'name',
  mahsulot: 'name',
  'mahsulot nomi': 'name',
  // Miqdor
  quantity: 'quantity',
  miqdor: 'quantity',
  miqdori: 'quantity',
  soni: 'quantity',
  // Narxlar
  purchase_price: 'purchase_price',
  'sotib olingan narx': 'purchase_price',
  'kirim narxi': 'purchase_price',
  tannarx: 'purchase_price',
  selling_price: 'selling_price',
  'sotish narxi': 'selling_price',
  'sotuv narxi': 'selling_price',
  wholesale_price: 'wholesale_price',
  'optom narx': 'wholesale_price',
  'ulgurji narx': 'wholesale_price',
};

export interface SkippedRow {
  row: number;
  reason: string;
}

export interface StockEntryImportResult {
  entry_id: number | null;
  created: number;
  skipped: SkippedRow[];
  total_amount: string;
  paid_amount: string;
  debt_amount: string;
  payment_type: string | null;
}

interface ParsedRow {
  row: number;
  barcode: string;
  sku: string;
  name: string;
  quantity: number;
  purchase_price: number;
  selling_price: number;
  wholesale_price: number;
}

// ─────────────────────────────────────────────
// Yordamchi parse funksiyalari
// ─────────────────────────────────────────────

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

// Butun son (miqdor): > 0
function parseQty(value: string): { value: number | null; err: string | null } {
  if (value === '') return { value: null, err: "bo'sh" };
  const n = Number.parseFloat(value.replace(/\s+/g, '').replace(',', '.'));
  if (Number.isNaN(n)) return { value: null, err: 'raqam emas' };
  const parsed = Math.trunc(n);
  if (parsed <= 0) return { value: null, err: "0 dan katta bo'lishi kerak" };
  return { value: parsed, err: null };
}

// Narx (decimal): >= 0. default berilsa bo'sh qiymat o'rniga ishlatiladi.
function parsePrice(
  value: string,
  fallback?: number,
): { value: number | null; err: string | null } {
  if (value === '') {
    if (fallback !== undefined) return { value: fallback, err: null };
    return { value: null, err: "bo'sh" };
  }
  const n = Number.parseFloat(value.replace(/\s+/g, '').replace(',', '.'));
  if (Number.isNaN(n)) return { value: null, err: 'raqam emas' };
  if (n < 0) return { value: null, err: "manfiy bo'lmasligi kerak" };
  return { value: n, err: null };
}

// StockEntryItem biznes qoidalari (contract.schemas.ts bilan bir xil).
function validateBusiness(p: ParsedRow): string | null {
  if (p.purchase_price <= 0) return "sotib olingan narx 0 dan katta bo'lishi kerak";
  if (p.selling_price <= 0) return "sotish narxi 0 dan katta bo'lishi kerak";
  if (p.selling_price < p.purchase_price) {
    return "sotish narxi sotib olingan narxdan past bo'lmasligi kerak";
  }
  if (p.wholesale_price > 0) {
    if (p.wholesale_price < p.purchase_price) return "optom narx tannarxdan past bo'lmasligi kerak";
    if (p.wholesale_price > p.selling_price) {
      return "optom narx sotish narxidan yuqori bo'lmasligi kerak";
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Excel o'qish: header'larni normalizatsiya + satrlar
// ─────────────────────────────────────────────
async function readSheet(buffer: Buffer): Promise<{ col: Record<string, number>; dataRows: string[][] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ValidationError({
      detail: "Excel faylni o'qib bo'lmadi. Fayl .xlsx formatida bo'lishi kerak.",
    });
  }

  const ws = wb.worksheets[0];
  if (!ws) throw new ValidationError({ detail: 'Excel faylda ishchi varaq topilmadi.' });

  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const raw = row.values as ExcelJS.CellValue[];
    const values: string[] = [];
    // exceljs row.values[0] bo'sh; 1-indeksdan boshlanadi
    for (let i = 1; i < raw.length; i += 1) values.push(cellStr(raw[i]));
    rows.push(values);
  });

  if (rows.length === 0) throw new ValidationError({ detail: "Excel fayl bo'sh." });
  if (rows.length - 1 > MAX_ROWS) {
    throw new ValidationError({
      detail: `Satrlar soni ${MAX_ROWS} dan oshmasligi kerak (faylda: ${rows.length - 1}).`,
    });
  }

  // Sarlavhalar: "*" majburiylik belgisi va ortiqcha bo'shliqlar olib tashlanadi.
  const rawHeaders = rows[0]!.map((h) => h.toLowerCase().trim().replace(/\*+$/, '').trim());
  const mappedHeaders = rawHeaders.map((h) => HEADER_MAP[h] ?? h);

  const col: Record<string, number> = {};
  mappedHeaders.forEach((name, idx) => {
    if (name && !(name in col)) col[name] = idx;
  });

  const missing = REQUIRED_COLUMNS.filter((c) => !(c in col));
  if (missing.length > 0) {
    throw new ValidationError({ detail: `Ustunlar topilmadi: ${missing.join(', ')}` });
  }
  if (!IDENTIFIER_COLUMNS.some((c) => c in col)) {
    throw new ValidationError({
      detail: "Kamida bitta mahsulot identifikatori ustuni kerak: 'Barcode', 'SKU' yoki 'Mahsulot nomi'.",
    });
  }

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    throw new ValidationError({ detail: "Shablon bo'sh — ma'lumot qatorlari yo'q." });
  }

  return { col, dataRows };
}

// ─────────────────────────────────────────────
// Mahsulotlarni aniqlash — N+1 siz, 3 ta jamlangan query (tenant doirasida)
// ─────────────────────────────────────────────
type ProductRef = { id: number; name: string };

interface ProductMaps {
  barcode: Map<string, ProductRef>;
  sku: Map<string, ProductRef>;
  name: Map<string, ProductRef | 'AMBIGUOUS'>;
}

async function buildProductMaps(companyId: number, parsed: ParsedRow[]): Promise<ProductMaps> {
  const barcodes = [...new Set(parsed.map((p) => p.barcode).filter(Boolean))];
  const skus = [...new Set(parsed.map((p) => p.sku).filter(Boolean))];
  const names = [...new Set(parsed.map((p) => p.name.toLowerCase()).filter(Boolean))];

  const maps: ProductMaps = { barcode: new Map(), sku: new Map(), name: new Map() };

  if (barcodes.length) {
    const found = await prisma.product.findMany({
      where: { companyId, status: 'a', barcode: { in: barcodes } },
      select: { id: true, name: true, barcode: true },
    });
    for (const p of found) maps.barcode.set(p.barcode!, { id: p.id, name: p.name });
  }
  if (skus.length) {
    const found = await prisma.product.findMany({
      where: { companyId, status: 'a', sku: { in: skus } },
      select: { id: true, name: true, sku: true },
    });
    for (const p of found) maps.sku.set(p.sku!, { id: p.id, name: p.name });
  }
  if (names.length) {
    // Nom case-insensitive; nom UNIKAL emas — bir nechta mos kelsa AMBIGUOUS.
    const found = await prisma.product.findMany({
      where: { companyId, status: 'a', name: { in: names, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    for (const p of found) {
      const key = p.name.toLowerCase();
      if (maps.name.has(key)) maps.name.set(key, 'AMBIGUOUS');
      else maps.name.set(key, { id: p.id, name: p.name });
    }
  }

  return maps;
}

// Ustuvorlik: barcode → sku → nom.
function resolveProduct(p: ParsedRow, maps: ProductMaps): { product: ProductRef | null; reason: string | null } {
  if (p.barcode) {
    const product = maps.barcode.get(p.barcode);
    if (product) return { product, reason: null };
    return { product: null, reason: `barcode bo'yicha faol mahsulot topilmadi: ${p.barcode}` };
  }
  if (p.sku) {
    const product = maps.sku.get(p.sku);
    if (product) return { product, reason: null };
    return { product: null, reason: `sku bo'yicha faol mahsulot topilmadi: ${p.sku}` };
  }
  const match = maps.name.get(p.name.toLowerCase());
  if (match === 'AMBIGUOUS') {
    return { product: null, reason: `nom bir nechta mahsulotga mos keldi (barcode/sku ishlating): ${p.name}` };
  }
  if (match) return { product: match, reason: null };
  return { product: null, reason: `nom bo'yicha faol mahsulot topilmadi: ${p.name}` };
}

// ─────────────────────────────────────────────
// Asosiy import
// ─────────────────────────────────────────────
export async function importStockEntryFromExcel(opts: {
  companyId: number;
  userId: number;
  buffer: Buffer;
  supplierId: number;
  storeId: number;
  cashAmount: number;
  cardAmount: number;
}): Promise<StockEntryImportResult> {
  const { col, dataRows } = await readSheet(opts.buffer);

  const has = (key: string) => key in col;
  const cell = (row: string[], key: string): string => {
    const idx = col[key];
    return idx === undefined ? '' : (row[idx] ?? '');
  };

  // ── 1. Parse + validatsiya ──
  const parsed: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];

  dataRows.forEach((row, i) => {
    const rowNum = i + 2;
    const barcode = has('barcode') ? cell(row, 'barcode') : '';
    const sku = has('sku') ? cell(row, 'sku') : '';
    const name = has('name') ? cell(row, 'name') : '';

    // To'liq bo'sh satrni jimgina o'tkazamiz
    const allEmpty = Object.values(col).every((idx) => (row[idx] ?? '') === '');
    if (!barcode && !sku && !name && allEmpty) return;

    if (!barcode && !sku && !name) {
      skipped.push({ row: rowNum, reason: "mahsulot identifikatori yo'q (barcode/sku/nom)" });
      return;
    }

    const qty = parseQty(cell(row, 'quantity'));
    if (qty.err) {
      skipped.push({ row: rowNum, reason: `miqdor: ${qty.err}` });
      return;
    }
    const purchase = parsePrice(cell(row, 'purchase_price'));
    if (purchase.err) {
      skipped.push({ row: rowNum, reason: `sotib olingan narx: ${purchase.err}` });
      return;
    }
    const selling = parsePrice(cell(row, 'selling_price'));
    if (selling.err) {
      skipped.push({ row: rowNum, reason: `sotish narxi: ${selling.err}` });
      return;
    }
    const wholesale = has('wholesale_price')
      ? parsePrice(cell(row, 'wholesale_price'), 0)
      : { value: 0, err: null };
    if (wholesale.err) {
      skipped.push({ row: rowNum, reason: `optom narx: ${wholesale.err}` });
      return;
    }

    const candidate: ParsedRow = {
      row: rowNum,
      barcode,
      sku,
      name,
      quantity: qty.value!,
      purchase_price: purchase.value!,
      selling_price: selling.value!,
      wholesale_price: wholesale.value!,
    };
    const reason = validateBusiness(candidate);
    if (reason) {
      skipped.push({ row: rowNum, reason });
      return;
    }
    parsed.push(candidate);
  });

  // ── 2. Mahsulotlarni aniqlash ──
  const maps = await buildProductMaps(opts.companyId, parsed);

  const items: Array<{
    product: number;
    quantity: number;
    purchase_price: string;
    selling_price: string;
    wholesale_price: string;
  }> = [];
  const seenPids = new Set<number>();

  for (const p of parsed) {
    const { product, reason } = resolveProduct(p, maps);
    if (!product) {
      skipped.push({ row: p.row, reason: reason! });
      continue;
    }
    // Bitta kirimda bir mahsulot ikki marta kelsa — dublikat batch oldini olamiz
    if (seenPids.has(product.id)) {
      skipped.push({ row: p.row, reason: `mahsulot satrlarda takrorlangan: ${product.name}` });
      continue;
    }
    seenPids.add(product.id);

    items.push({
      product: product.id,
      quantity: p.quantity,
      purchase_price: p.purchase_price.toFixed(2),
      selling_price: p.selling_price.toFixed(2),
      wholesale_price: p.wholesale_price.toFixed(2),
    });
  }

  if (items.length === 0) {
    return {
      entry_id: null,
      created: 0,
      skipped,
      total_amount: '0.00',
      paid_amount: '0.00',
      debt_amount: '0.00',
      payment_type: null,
    };
  }

  // ── 3. To'lov validatsiyasi (faqat valid satrlar bo'yicha) ──
  const totalAmount = items.reduce((acc, i) => acc + Number(i.purchase_price) * i.quantity, 0);
  const paidAmount = opts.cashAmount + opts.cardAmount;
  if (paidAmount > totalAmount) {
    throw new ValidationError({
      detail: `To'lov (${paidAmount}) umumiy kirim summasidan (${totalAmount.toFixed(2)}) oshib ketdi.`,
    });
  }

  // ── 4. Kirimni yaratish — mavjud servis qayta ishlatiladi (atomik) ──
  const entry = await createEntry({
    companyId: opts.companyId,
    userId: opts.userId,
    data: {
      supplier: opts.supplierId,
      store: opts.storeId,
      cash_amount: opts.cashAmount.toFixed(2),
      card_amount: opts.cardAmount.toFixed(2),
      bank_card: null,
      payments: [],
      note: '',
      items,
    },
  });

  return {
    entry_id: entry.id,
    created: items.length,
    skipped,
    total_amount: Number(entry.totalAmount).toFixed(2),
    paid_amount: Number(entry.paidAmount).toFixed(2),
    debt_amount: Number(entry.debtAmount).toFixed(2),
    payment_type: entry.paymentType,
  };
}

// ─────────────────────────────────────────────
// Do'konni aniqlash: berilsa istalgan faol do'kon (ombor yoki savdo do'koni)
// qabul qilinadi; berilmasa yagona asosiy (type='b') do'kon avtomatik tanlanadi
// (Django _resolve_base_store ekvivalenti — default faqat auto-tanlashda).
// ─────────────────────────────────────────────
export async function resolveEntryStore(companyId: number, storeId?: number | null): Promise<number> {
  if (storeId) {
    const store = await prisma.store.findFirst({
      where: { id: storeId, companyId, isActive: true },
      select: { id: true },
    });
    if (!store) {
      throw new ValidationError({ detail: "Do'kon topilmadi yoki faol emas." });
    }
    return store.id;
  }

  const bases = await prisma.store.findMany({
    where: { companyId, isActive: true, type: 'b' },
    select: { id: true },
    take: 2,
  });
  if (bases.length === 0) {
    throw new ValidationError({ detail: "Asosiy do'kon (ombor) topilmadi." });
  }
  if (bases.length > 1) {
    throw new ValidationError({
      detail: "Bir nechta faol asosiy do'kon mavjud — 'store' maydonida bittasini ko'rsating.",
    });
  }
  return bases[0]!.id;
}

// ─────────────────────────────────────────────
// Kirim import shabloni — kirim_import_shablon.xlsx bilan bir xil tuzilma
// (Kirim varag'i + Qo'llanma varag'i). Statik fayl o'rniga dinamik generatsiya.
// ─────────────────────────────────────────────
export async function buildKirimTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet('Kirim');
  ws.columns = [
    { header: 'Mahsulot nomi', key: 'name', width: 30 },
    { header: 'Barcode', key: 'barcode', width: 18 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Miqdori *', key: 'quantity', width: 12 },
    { header: 'Sotib olingan narx *', key: 'purchase_price', width: 20 },
    { header: 'Sotish narxi *', key: 'selling_price', width: 16 },
    { header: 'Optom narx', key: 'wholesale_price', width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  // Namuna satr
  ws.addRow(['Sakadeska', null, null, 10, 50000, 65000, 60000]);

  const guide = wb.addWorksheet("Qo'llanma");
  guide.columns = [
    { header: 'Maydon', key: 'field', width: 24 },
    { header: 'Qoida / Izoh', key: 'note', width: 100 },
  ];
  guide.getRow(1).font = { bold: true };
  const guideRows: Array<[string, string]> = [
    ['Mahsulot nomi', "Identifikator. Barcode/SKU bo'lmasa nom bo'yicha qidiriladi. Nom unikal bo'lishi shart."],
    ['Barcode', 'Identifikator (tavsiya etiladi). Eng aniq moslik. Faol mahsulotning EAN-13 kodi.'],
    ['SKU', 'Identifikator. Mahsulotning artikul kodi.'],
    ['—', "Kamida BITTA identifikator (Barcode / SKU / Nom) to'ldirilishi shart. Ustuvorlik: Barcode > SKU > Nom."],
    ['Miqdori *', 'MAJBURIY. Butun son, 0 dan katta.'],
    ['Sotib olingan narx *', 'MAJBURIY. Tannarx, 0 dan katta.'],
    ['Sotish narxi *', "MAJBURIY. Sotib olingan narxdan past bo'lmasligi kerak."],
    ['Optom narx', "Ixtiyoriy. Bo'sh yoki 0 = ishlatilmaydi. Aks holda: tannarx <= optom <= sotish narxi."],
    ['Eslatma', "Yetkazib beruvchi, naqd/karta to'lov va do'kon Excelda emas, formada beriladi. Kirim faqat asosiy do'konga qilinadi."],
  ];
  for (const r of guideRows) guide.addRow(r);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
