import ExcelJS from 'exceljs';
import { prisma } from '../../db/prisma.js';
import { listSuppliersAnnotated } from './supplier.service.js';
import { buildStockEntryWhere } from './stockEntry.service.js';

// Django apps/contract/views/export_views.py ekvivalenti (openpyxl → exceljs).
// Ikkala eksport ham ro'yxat filtrlari bilan bir xil natijani .xlsx qilib qaytaradi.

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

// ─────────────────────────────────────────────
// SupplierExportAPIView — ta'minotchilar .xlsx
// ─────────────────────────────────────────────
export async function buildSupplierExportExcel(opts: {
  companyId: number;
  search?: string | null;
  isActive?: string | null;
  hasDebt?: boolean;
  ordering?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<Buffer> {
  let annotated = await listSuppliersAnnotated(opts);

  // date_field="created_at" (Django BaseExcelExportAPIView)
  if (opts.dateFrom) {
    const from = new Date(`${opts.dateFrom}T00:00:00.000Z`);
    annotated = annotated.filter((row) => row.supplier.createdAt >= from);
  }
  if (opts.dateTo) {
    const to = new Date(`${opts.dateTo}T23:59:59.999Z`);
    annotated = annotated.filter((row) => row.supplier.createdAt <= to);
  }

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Ta'minotchilar");
  const columns: Array<[string, number]> = [
    ['ID', 8],
    ['Nomi', 30],
    ['Telefon', 16],
    ['INN', 14],
    ['Manzil', 30],
    ['Jami xarid', 16],
    ['Qarz', 16],
    ['Faol', 8],
    ["Qo'shilgan sana", 17],
  ];
  styleHeaderRow(sheet, columns);

  annotated.forEach((row, i) => {
    const r = i + 2;
    const s = row.supplier;
    sheet.getCell(r, 1).value = s.id;
    sheet.getCell(r, 2).value = s.name;
    sheet.getCell(r, 3).value = s.phoneNumber;
    sheet.getCell(r, 4).value = s.inn ?? '';
    sheet.getCell(r, 5).value = s.address;
    sheet.getCell(r, 6).value = row.totalPurchase;
    sheet.getCell(r, 7).value = row.totalDebt;
    sheet.getCell(r, 8).value = s.isActive ? 'Ha' : "Yo'q";
    sheet.getCell(r, 9).value = fmtDate(s.createdAt);
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

// ─────────────────────────────────────────────
// StockEntryExportAPIView — kirimlar .xlsx (2 sheet: Xaridlar, Mahsulotlar)
// ─────────────────────────────────────────────
export async function buildStockEntryExportExcel(opts: {
  companyId: number;
  search?: string | null;
  supplier?: number | null;
  store?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}): Promise<Buffer> {
  const where = buildStockEntryWhere(opts);

  const entries = await prisma.stockEntry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      supplier: { select: { name: true } },
      store: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      items: { include: { product: { select: { name: true, sku: true } } } },
    },
  });

  const wb = new ExcelJS.Workbook();

  const entrySheet = wb.addWorksheet('Xaridlar');
  const entryColumns: Array<[string, number]> = [
    ['ID', 8],
    ['Sana', 17],
    ["Ta'minotchi", 26],
    ["Do'kon", 20],
    ['Jami summa', 14],
    ['Naqd', 14],
    ['Karta', 14],
    ["To'langan", 14],
    ['Qarz', 14],
    ['Yaratdi', 24],
    ['Mahsulot xillari', 14],
    ['Jami dona', 12],
    ['Izoh', 34],
  ];
  styleHeaderRow(entrySheet, entryColumns);

  entries.forEach((entry, i) => {
    const r = i + 2;
    entrySheet.getCell(r, 1).value = entry.id;
    entrySheet.getCell(r, 2).value = fmtDate(entry.createdAt);
    entrySheet.getCell(r, 3).value = entry.supplier?.name ?? '';
    entrySheet.getCell(r, 4).value = entry.store?.name ?? '';
    entrySheet.getCell(r, 5).value = Number(entry.totalAmount);
    entrySheet.getCell(r, 6).value = Number(entry.cashAmount);
    entrySheet.getCell(r, 7).value = Number(entry.cardAmount);
    entrySheet.getCell(r, 8).value = Number(entry.paidAmount);
    entrySheet.getCell(r, 9).value = Number(entry.debtAmount);
    entrySheet.getCell(r, 10).value = entry.createdBy?.fullName ?? '';
    entrySheet.getCell(r, 11).value = entry.items.length;
    entrySheet.getCell(r, 12).value = entry.items.reduce((sum, item) => sum + item.quantity, 0);
    entrySheet.getCell(r, 13).value = entry.note ?? '';
  });

  const itemSheet = wb.addWorksheet('Mahsulotlar');
  const itemColumns: Array<[string, number]> = [
    ['Xarid ID', 10],
    ['Sana', 17],
    ['Mahsulot', 40],
    ['SKU', 14],
    ['Miqdor', 10],
    ['Olish narxi', 14],
    ['Sotish narxi', 14],
  ];
  styleHeaderRow(itemSheet, itemColumns);

  let itemRow = 2;
  for (const entry of entries) {
    for (const item of entry.items) {
      itemSheet.getCell(itemRow, 1).value = entry.id;
      itemSheet.getCell(itemRow, 2).value = fmtDate(entry.createdAt);
      itemSheet.getCell(itemRow, 3).value = item.product?.name ?? '';
      itemSheet.getCell(itemRow, 4).value = item.product?.sku ?? '';
      itemSheet.getCell(itemRow, 5).value = item.quantity;
      itemSheet.getCell(itemRow, 6).value = Number(item.purchasePrice);
      itemSheet.getCell(itemRow, 7).value = Number(item.sellingPrice);
      itemRow += 1;
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
