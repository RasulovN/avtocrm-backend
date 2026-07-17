import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

// Django'dagi per-app export view'lari ekvivalenti (openpyxl → exceljs).
// Har bir builder ro'yxat filtrlari bilan .xlsx Buffer qaytaradi;
// route'lar mos feature ichida (products/users/sales/transfer/inventory).

function styleHeaderRow(sheet: ExcelJS.Worksheet, columns: Array<[string, number]>): void {
  columns.forEach(([header, width], i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = header;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
    sheet.getColumn(i + 1).width = width;
  });
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function num(value: Prisma.Decimal | null | undefined): number {
  return value ? Number(value.toString()) : 0;
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─────────────────────────────────────────────
// Mahsulotlar (.xlsx) — GET /products/export/
// ─────────────────────────────────────────────
export async function buildProductExportExcel(opts: {
  companyId: number;
  search?: string | null;
  category?: number | null;
}): Promise<Buffer> {
  const where: Prisma.ProductWhereInput = { companyId: opts.companyId, archivedAt: null };
  if (opts.category != null) where.categoryId = opts.category;
  if (opts.search) {
    where.OR = [
      { name: { contains: opts.search, mode: 'insensitive' } },
      { sku: { contains: opts.search, mode: 'insensitive' } },
      { barcode: { contains: opts.search, mode: 'insensitive' } },
    ];
  }

  const products = await prisma.product.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      category: { select: { name: true } },
      unitMeasurement: { select: { measurement: true } },
      batches: { where: { isActive: true }, select: { quantity: true, purchasePrice: true, sellingPrice: true, wholesalePrice: true } },
    },
  });

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Mahsulotlar');
  const columns: Array<[string, number]> = [
    ['ID', 8],
    ['Nomi', 34],
    ['SKU', 14],
    ['Barcode', 16],
    ['Kategoriya', 20],
    ['Birlik', 10],
    ['Kelish narxi', 14],
    ['Sotish narxi', 14],
    ['Ulgurji narx', 14],
    ['Jami qoldiq', 12],
    ['Holat', 10],
    ['Yaratilgan', 17],
  ];
  styleHeaderRow(sheet, columns);

  products.forEach((p, i) => {
    const r = i + 2;
    const totalQty = p.batches.reduce((s, b) => s + b.quantity, 0);
    const firstBatch = p.batches[0];
    sheet.getCell(r, 1).value = p.id;
    sheet.getCell(r, 2).value = p.name;
    sheet.getCell(r, 3).value = p.sku ?? '';
    sheet.getCell(r, 4).value = p.barcode ?? '';
    sheet.getCell(r, 5).value = p.category?.name ?? '';
    sheet.getCell(r, 6).value = p.unitMeasurement?.measurement ?? '';
    sheet.getCell(r, 7).value = num(firstBatch?.purchasePrice);
    sheet.getCell(r, 8).value = num(firstBatch?.sellingPrice);
    sheet.getCell(r, 9).value = num(firstBatch?.wholesalePrice);
    sheet.getCell(r, 10).value = totalQty;
    sheet.getCell(r, 11).value = p.status === 'a' ? 'Faol' : 'Nofaol';
    sheet.getCell(r, 12).value = fmtDate(p.createdAt);
  });

  return toBuffer(wb);
}

// ─────────────────────────────────────────────
// Kategoriyalar (.xlsx) — GET /products/categories/export/
// ─────────────────────────────────────────────
export async function buildCategoryExportExcel(opts: {
  companyId: number;
  search?: string | null;
}): Promise<Buffer> {
  const where: Prisma.CategoryWhereInput = { companyId: opts.companyId };
  if (opts.search) {
    where.OR = [
      { name: { contains: opts.search, mode: 'insensitive' } },
      { description: { contains: opts.search, mode: 'insensitive' } },
    ];
  }

  const categories = await prisma.category.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { products: true } } },
  });

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Kategoriyalar');
  const columns: Array<[string, number]> = [
    ['ID', 8],
    ['Nomi', 30],
    ['Nomi (kirill)', 30],
    ['Tavsif', 40],
    ['Mahsulotlar soni', 16],
    ['Yaratilgan', 17],
  ];
  styleHeaderRow(sheet, columns);

  categories.forEach((c, i) => {
    const r = i + 2;
    sheet.getCell(r, 1).value = c.id;
    sheet.getCell(r, 2).value = c.name;
    sheet.getCell(r, 3).value = c.nameUzCyrl ?? '';
    sheet.getCell(r, 4).value = c.description ?? '';
    sheet.getCell(r, 5).value = c._count.products;
    sheet.getCell(r, 6).value = fmtDate(c.createdAt);
  });

  return toBuffer(wb);
}

// ─────────────────────────────────────────────
// Mijozlar (.xlsx) — GET /users/customers/export/
// ─────────────────────────────────────────────
export async function buildCustomerExportExcel(opts: {
  companyId: number;
  search?: string | null;
}): Promise<Buffer> {
  const where: Prisma.CustomerWhereInput = { companyId: opts.companyId };
  if (opts.search) {
    where.OR = [
      { fullName: { contains: opts.search, mode: 'insensitive' } },
      { phoneNumber: { contains: opts.search, mode: 'insensitive' } },
    ];
  }

  const customers = await prisma.customer.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { sales: true } } },
  });
  const debtSums = await prisma.customerDebt.groupBy({
    by: ['customerId', 'type'],
    where: { companyId: opts.companyId },
    _sum: { amount: true },
    orderBy: { customerId: 'asc' },
  });

  // Qarz = increase(i) - decrease(d)
  const debtMap = new Map<number, number>();
  for (const row of debtSums) {
    const sign = row.type === 'i' ? 1 : -1;
    debtMap.set(row.customerId, (debtMap.get(row.customerId) ?? 0) + sign * num(row._sum?.amount));
  }

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Mijozlar');
  const columns: Array<[string, number]> = [
    ['ID', 8],
    ['F.I.Sh.', 30],
    ['Telefon', 16],
    ['Xaridlar soni', 14],
    ['Qarz', 16],
    ["Qo'shilgan sana", 17],
  ];
  styleHeaderRow(sheet, columns);

  customers.forEach((c, i) => {
    const r = i + 2;
    sheet.getCell(r, 1).value = c.id;
    sheet.getCell(r, 2).value = c.fullName;
    sheet.getCell(r, 3).value = c.phoneNumber;
    sheet.getCell(r, 4).value = c._count.sales;
    sheet.getCell(r, 5).value = Math.max(0, debtMap.get(c.id) ?? 0);
    sheet.getCell(r, 6).value = fmtDate(c.createdAt);
  });

  return toBuffer(wb);
}

// ─────────────────────────────────────────────
// Sotuvlar (.xlsx) — GET /sales/export/
// ─────────────────────────────────────────────
const SALE_STATUS_LABEL: Record<string, string> = {
  paid: "To'langan",
  partial: "Qisman to'langan",
  debt: 'Qarz',
  r: 'Qaytarilgan',
};

export async function buildSaleExportExcel(opts: {
  companyId: number;
  user: { id: number; isSuperuser: boolean };
  store?: number | null;
  status?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<Buffer> {
  const where: Prisma.SaleWhereInput = { companyId: opts.companyId };
  if (!opts.user.isSuperuser) {
    // Ro'yxat bilan bir xil scope: sotuvchi faqat o'z sotuvlarini eksport qiladi
    where.sellerId = opts.user.id;
  }
  if (opts.store != null) where.storeId = opts.store;
  if (opts.status) where.status = opts.status;
  if (opts.dateFrom || opts.dateTo) {
    where.createdAt = {};
    if (opts.dateFrom) where.createdAt.gte = new Date(`${opts.dateFrom}T00:00:00.000Z`);
    if (opts.dateTo) where.createdAt.lte = new Date(`${opts.dateTo}T23:59:59.999Z`);
  }

  const sales = await prisma.sale.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      store: { select: { name: true } },
      customer: { select: { fullName: true } },
      seller: { select: { fullName: true } },
      _count: { select: { items: true } },
    },
  });

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sotuvlar');
  const columns: Array<[string, number]> = [
    ['ID', 8],
    ['Sana', 17],
    ["Do'kon", 20],
    ['Mijoz', 24],
    ['Sotuvchi', 24],
    ['Mahsulot xillari', 14],
    ['Jami summa', 16],
    ["To'langan", 16],
    ['Qarz', 16],
    ['Chegirma', 14],
    ['Holat', 16],
  ];
  styleHeaderRow(sheet, columns);

  sales.forEach((s, i) => {
    const r = i + 2;
    const total = num(s.totalAmount);
    const paid = num(s.paidAmount);
    sheet.getCell(r, 1).value = s.id;
    sheet.getCell(r, 2).value = fmtDate(s.createdAt);
    sheet.getCell(r, 3).value = s.store.name;
    sheet.getCell(r, 4).value = s.customer?.fullName ?? '';
    sheet.getCell(r, 5).value = s.seller.fullName ?? '';
    sheet.getCell(r, 6).value = s._count.items;
    sheet.getCell(r, 7).value = total;
    sheet.getCell(r, 8).value = paid;
    sheet.getCell(r, 9).value = Math.max(0, total - paid);
    sheet.getCell(r, 10).value = num(s.discountAmount);
    sheet.getCell(r, 11).value = SALE_STATUS_LABEL[s.status] ?? s.status;
  });

  return toBuffer(wb);
}

// ─────────────────────────────────────────────
// Ko'chirishlar (.xlsx) — GET /transfer/export/
// ─────────────────────────────────────────────
const TRANSFER_STATUS_LABEL: Record<string, string> = {
  p: 'Kutilmoqda',
  a: 'Tasdiqlangan',
  r: 'Rad etilgan',
};

export async function buildTransferExportExcel(opts: {
  companyId: number;
  status?: string | null;
}): Promise<Buffer> {
  const where: Prisma.StockTransferWhereInput = { companyId: opts.companyId };
  if (opts.status) where.status = opts.status;

  const transfers = await prisma.stockTransfer.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      fromStore: { select: { name: true } },
      toStore: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
      items: { select: { quantity: true } },
    },
  });

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Ko'chirishlar");
  const columns: Array<[string, number]> = [
    ['ID', 8],
    ['Sana', 17],
    ['Qayerdan', 22],
    ['Qayerga', 22],
    ['Mahsulot xillari', 14],
    ['Jami dona', 12],
    ['Holat', 14],
    ['Yaratgan', 24],
    ['Tasdiqlagan', 24],
    ['Tasdiqlangan vaqt', 17],
  ];
  styleHeaderRow(sheet, columns);

  transfers.forEach((t, i) => {
    const r = i + 2;
    sheet.getCell(r, 1).value = t.id;
    sheet.getCell(r, 2).value = fmtDate(t.createdAt);
    sheet.getCell(r, 3).value = t.fromStore.name;
    sheet.getCell(r, 4).value = t.toStore.name;
    sheet.getCell(r, 5).value = t.items.length;
    sheet.getCell(r, 6).value = t.items.reduce((s, it) => s + it.quantity, 0);
    sheet.getCell(r, 7).value = TRANSFER_STATUS_LABEL[t.status] ?? t.status;
    sheet.getCell(r, 8).value = t.createdBy?.fullName ?? '';
    sheet.getCell(r, 9).value = t.approvedBy?.fullName ?? '';
    sheet.getCell(r, 10).value = fmtDate(t.approvedAt);
  });

  return toBuffer(wb);
}

// ─────────────────────────────────────────────
// Inventarizatsiya sessiyalari (.xlsx) — GET /inventory/export/
// ─────────────────────────────────────────────
const SESSION_STATUS_LABEL: Record<string, string> = {
  active: 'Faol',
  completed: 'Yakunlangan',
  cancelled: 'Bekor qilingan',
};

export async function buildInventoryExportExcel(opts: {
  companyId: number;
  status?: string | null;
}): Promise<Buffer> {
  const where: Prisma.InventorySessionWhereInput = { companyId: opts.companyId };
  if (opts.status) where.status = opts.status;

  const sessions = await prisma.inventorySession.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      store: { select: { name: true } },
      startedBy: { select: { fullName: true } },
      _count: { select: { snapshots: true, counts: true, adjustments: true } },
    },
  });

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Inventarizatsiya');
  const columns: Array<[string, number]> = [
    ['ID', 8],
    ["Do'kon", 24],
    ['Boshlagan', 24],
    ['Boshlangan sana', 17],
    ['Holat', 16],
    ['Mahsulotlar (snapshot)', 20],
    ['Sanalganlar', 14],
    ['Tuzatishlar', 14],
  ];
  styleHeaderRow(sheet, columns);

  sessions.forEach((s, i) => {
    const r = i + 2;
    sheet.getCell(r, 1).value = s.id;
    sheet.getCell(r, 2).value = s.store.name;
    sheet.getCell(r, 3).value = s.startedBy?.fullName ?? '';
    sheet.getCell(r, 4).value = fmtDate(s.startedAt);
    sheet.getCell(r, 5).value = SESSION_STATUS_LABEL[s.status] ?? s.status;
    sheet.getCell(r, 6).value = s._count.snapshots;
    sheet.getCell(r, 7).value = s._count.counts;
    sheet.getCell(r, 8).value = s._count.adjustments;
  });

  return toBuffer(wb);
}
