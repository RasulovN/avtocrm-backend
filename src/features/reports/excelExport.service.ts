import ExcelJS from 'exceljs';
import type { ReportData } from './report.service.js';

// ─────────────────────────────────────────────
//  Excel export — Django apps/reports/services/excel_export_service.py
//  5 sheet: Umumiy, Filiallar, Top mahsulotlar, Mijoz qarzlari, Taminotchi qarzlari.
//  xlsxwriter -> exceljs. Buffer qaytaradi.
// ─────────────────────────────────────────────

const MONEY_FMT = '#,##0';

function styleHeader(cell: ExcelJS.Cell): void {
  cell.font = { bold: true };
  cell.alignment = { horizontal: 'center' };
  cell.border = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };
}

export async function generateReportExcel(data: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // ── 1. SUMMARY ──
  const s1 = wb.addWorksheet('Umumiy');
  styleHeader(s1.getCell('A1'));
  s1.getCell('A1').value = 'Umumiy hisobot';

  const summaryRows: Array<[string, number]> = [
    ['Jami daromad', data.summary.totalRevenue],
    ['Sof foyda', data.summary.totalProfit],
    ['Xarajat', data.summary.totalExpenses],
    ['Buyurtmalar soni', data.summary.totalOrders],
    ["O'rtacha chek", data.summary.averageOrderValue],
    ['Mijozlar soni', data.summary.totalCustomers],
  ];
  summaryRows.forEach(([label, value], i) => {
    const r = i + 2; // A2'dan boshlanadi
    s1.getCell(`A${r}`).value = label;
    const c = s1.getCell(`B${r}`);
    c.value = value;
    c.numFmt = MONEY_FMT;
  });

  // ── 2. BRANCH STATS ──
  const s2 = wb.addWorksheet('Filiallar');
  ['Filial', 'Daromad', 'Buyurtmalar', 'Mijozlar'].forEach((h, col) => {
    const cell = s2.getCell(1, col + 1);
    cell.value = h;
    styleHeader(cell);
  });
  data.branchStatistics.forEach((b, i) => {
    const row = i + 2;
    s2.getCell(row, 1).value = b.store__name;
    const c = s2.getCell(row, 2);
    c.value = b.revenue;
    c.numFmt = MONEY_FMT;
    s2.getCell(row, 3).value = b.orders;
    s2.getCell(row, 4).value = b.customers;
  });

  // ── 3. TOP PRODUCTS ──
  const s3 = wb.addWorksheet('Top mahsulotlar');
  ['#', 'Mahsulot', 'Sotilgan', 'Daromad'].forEach((h, col) => {
    const cell = s3.getCell(1, col + 1);
    cell.value = h;
    styleHeader(cell);
  });
  data.topSellingProducts.forEach((p, i) => {
    const row = i + 2;
    s3.getCell(row, 1).value = p.rank;
    s3.getCell(row, 2).value = p.name;
    s3.getCell(row, 3).value = p.totalSold;
    const c = s3.getCell(row, 4);
    c.value = p.totalRevenue;
    c.numFmt = MONEY_FMT;
  });

  // ── 4. CUSTOMER DEBT ──
  const s4 = wb.addWorksheet('Mijoz qarzlari');
  ['Mijoz', 'Qarz'].forEach((h, col) => {
    const cell = s4.getCell(1, col + 1);
    cell.value = h;
    styleHeader(cell);
  });
  data.debts.customerDebts.forEach((d, i) => {
    const row = i + 2;
    s4.getCell(row, 1).value = d.customerName;
    const c = s4.getCell(row, 2);
    c.value = d.debt;
    c.numFmt = MONEY_FMT;
  });

  // ── 5. SUPPLIER DEBT ──
  const s5 = wb.addWorksheet('Taminotchi qarzlari');
  ['Taminotchi', 'Qarz'].forEach((h, col) => {
    const cell = s5.getCell(1, col + 1);
    cell.value = h;
    styleHeader(cell);
  });
  data.debts.supplierDebts.forEach((d, i) => {
    const row = i + 2;
    s5.getCell(row, 1).value = d.supplierName;
    const c = s5.getCell(row, 2);
    c.value = d.debt;
    c.numFmt = MONEY_FMT;
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
