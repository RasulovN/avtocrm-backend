import ExcelJS from 'exceljs';
import type { ReportData } from './report.service.js';

// ─────────────────────────────────────────────
//  Excel export — hisobotning BARCHA bo'limlari, rangli/formatlangan:
//  Umumiy (KPI), Diagrammalar (bar-chart vizualizatsiya), Filiallar,
//  Kategoriyalar, Top mahsulotlar, To'lovlar tarkibi,
//  To'lov turlari kirim-chiqim, Mijoz qarzlari, Taminotchi qarzlari.
//  ExcelJS nativ chart qo'llamaydi — "Diagrammalar" varag'ida barlar
//  katak-bloklar bilan chiziladi (oflayn Excel'da ham bir xil ko'rinadi),
//  jadval ustunlarida esa dataBar/colorScale shartli formatlash ishlatiladi.
// ─────────────────────────────────────────────

const MONEY_FMT = '#,##0';

// Rang palitrasi (ARGB)
const C = {
  headerBg: 'FF334155', // slate-700
  headerText: 'FFFFFFFF',
  titleBg: 'FF0F172A', // slate-900
  band: 'FFF1F5F9', // slate-100
  border: 'FFCBD5E1', // slate-300
  totalBg: 'FFE2E8F0', // slate-200
  green: 'FF10B981', // emerald-500
  greenLight: 'FFD1FAE5',
  red: 'FFEF4444', // red-500
  redLight: 'FFFEE2E2',
  blue: 'FF3B82F6',
  amber: 'FFF59E0B',
  violet: 'FF8B5CF6',
  cyan: 'FF06B6D4',
  pink: 'FFEC4899',
  slate: 'FF64748B',
} as const;

// Diagramma barlari uchun aylanadigan ranglar
const BAR_PALETTE = [C.blue, C.green, C.amber, C.violet, C.cyan, C.pink, C.red, C.slate];

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: C.border } },
  left: { style: 'thin', color: { argb: C.border } },
  bottom: { style: 'thin', color: { argb: C.border } },
  right: { style: 'thin', color: { argb: C.border } },
};

function fill(argb: string): ExcelJS.FillPattern {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

// Varaq sarlavhasi: A1..(span) birlashtirilgan qoraga oq matn
function addTitle(sheet: ExcelJS.Worksheet, text: string, span: number): void {
  sheet.mergeCells(1, 1, 1, span);
  const cell = sheet.getCell(1, 1);
  cell.value = text;
  cell.font = { bold: true, size: 13, color: { argb: C.headerText } };
  cell.fill = fill(C.titleBg);
  cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  sheet.getRow(1).height = 26;
}

// Jadval header qatori: to'q fon, oq qalin matn, kenglik
function styleTableHeader(
  sheet: ExcelJS.Worksheet,
  rowIdx: number,
  headers: string[],
  widths: number[],
): void {
  headers.forEach((h, col) => {
    const cell = sheet.getCell(rowIdx, col + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10, color: { argb: C.headerText } };
    cell.fill = fill(C.headerBg);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder;
    if (widths[col]) sheet.getColumn(col + 1).width = widths[col];
  });
  sheet.getRow(rowIdx).height = 22;
}

// Ma'lumot qatori: zebra fon + border
function styleDataRow(sheet: ExcelJS.Worksheet, rowIdx: number, cols: number, banded: boolean): void {
  for (let col = 1; col <= cols; col += 1) {
    const cell = sheet.getCell(rowIdx, col);
    cell.border = thinBorder;
    if (banded) cell.fill = fill(C.band);
  }
}

// "Jami" qatori: to'q fon, qalin
function styleTotalRow(sheet: ExcelJS.Worksheet, rowIdx: number, cols: number): void {
  for (let col = 1; col <= cols; col += 1) {
    const cell = sheet.getCell(rowIdx, col);
    cell.border = thinBorder;
    cell.fill = fill(C.totalBg);
    cell.font = { ...(cell.font ?? {}), bold: true };
  }
}

// Ustunga ko'k dataBar (katak ichida gorizontal bar) shartli formatlash
function addDataBar(sheet: ExcelJS.Worksheet, ref: string, argb: string = C.blue): void {
  sheet.addConditionalFormatting({
    ref,
    rules: [
      {
        type: 'dataBar',
        priority: 1,
        gradient: false,
        minLength: 0,
        maxLength: 100,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb },
      } as ExcelJS.ConditionalFormattingRule,
    ],
  });
}

// Qizil→yashil rang shkalasi (masalan, balans/net ustuni uchun)
function addColorScale(sheet: ExcelJS.Worksheet, ref: string): void {
  sheet.addConditionalFormatting({
    ref,
    rules: [
      {
        type: 'colorScale',
        priority: 1,
        cfvo: [{ type: 'min' }, { type: 'num', value: 0 }, { type: 'max' }],
        color: [{ argb: 'FFF87171' }, { argb: 'FFFFFFFF' }, { argb: 'FF34D399' }],
      } as ExcelJS.ConditionalFormattingRule,
    ],
  });
}

// ── Diagramma: katak-bloklardan gorizontal bar chart ──
// label (A..B merge) | qiymat (C) | bar (D..D+BAR_COLS-1)
const BAR_COLS = 28;

interface BarItem {
  label: string;
  value: number;
  color?: string;
  /** Qiymat yonida ko'rsatiladigan qo'shimcha matn (masalan "42.1%") */
  suffix?: string;
}

function drawBarChart(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  title: string,
  items: BarItem[],
): number {
  // Bo'lim sarlavhasi
  sheet.mergeCells(startRow, 1, startRow, 3 + BAR_COLS);
  const t = sheet.getCell(startRow, 1);
  t.value = title;
  t.font = { bold: true, size: 12, color: { argb: C.headerText } };
  t.fill = fill(C.headerBg);
  t.alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(startRow).height = 22;

  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  let row = startRow + 1;
  items.forEach((item, idx) => {
    sheet.mergeCells(row, 1, row, 2);
    const label = sheet.getCell(row, 1);
    label.value = item.label;
    label.font = { size: 10 };
    label.alignment = { vertical: 'middle' };

    const val = sheet.getCell(row, 3);
    val.value = item.suffix ? `${Math.round(item.value).toLocaleString('ru-RU')} ${item.suffix}` : item.value;
    if (!item.suffix) val.numFmt = MONEY_FMT;
    val.font = { size: 10, bold: true };
    val.alignment = { horizontal: 'right', vertical: 'middle' };

    const units = item.value <= 0 ? 0 : Math.max(1, Math.round((item.value / max) * BAR_COLS));
    const color = item.color ?? BAR_PALETTE[idx % BAR_PALETTE.length];
    for (let i = 0; i < units; i += 1) {
      sheet.getCell(row, 4 + i).fill = fill(color);
    }
    sheet.getRow(row).height = 16;
    row += 1;
  });
  return row + 1; // bo'limlar orasida bo'sh qator
}

export async function generateReportExcel(data: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // ── 1. UMUMIY (KPI kartalari uslubida) ──
  const s1 = wb.addWorksheet('Umumiy', { views: [{ showGridLines: false }] });
  addTitle(s1, 'Umumiy hisobot', 3);
  s1.getColumn(1).width = 26;
  s1.getColumn(2).width = 20;

  const summaryRows: Array<[string, number, string, boolean]> = [
    // [nom, qiymat, aksent rang, pul formatimi]
    ['Jami daromad', data.summary.totalRevenue, C.blue, true],
    ['Sof foyda', data.summary.totalProfit, C.green, true],
    ['Xarajat', data.summary.totalExpenses, C.red, true],
    ['Buyurtmalar soni', data.summary.totalOrders, C.violet, false],
    ["O'rtacha chek", data.summary.averageOrderValue, C.cyan, true],
    ['Mijozlar soni', data.summary.totalCustomers, C.amber, false],
  ];
  summaryRows.forEach(([label, value, accent, money], i) => {
    const r = i + 3;
    const labelCell = s1.getCell(r, 1);
    labelCell.value = label;
    labelCell.font = { size: 11 };
    labelCell.border = thinBorder;
    labelCell.fill = fill(C.band);

    const valueCell = s1.getCell(r, 2);
    valueCell.value = value;
    if (money) valueCell.numFmt = MONEY_FMT;
    valueCell.font = { size: 11, bold: true, color: { argb: accent } };
    valueCell.alignment = { horizontal: 'right' };
    valueCell.border = thinBorder;
    s1.getRow(r).height = 20;
  });

  // ── 2. DIAGRAMMALAR (bar-chart vizualizatsiya) ──
  const sChart = wb.addWorksheet('Diagrammalar', { views: [{ showGridLines: false }] });
  sChart.getColumn(1).width = 16;
  sChart.getColumn(2).width = 12;
  sChart.getColumn(3).width = 15;
  for (let i = 0; i < BAR_COLS; i += 1) sChart.getColumn(4 + i).width = 1.2;
  addTitle(sChart, 'Diagrammalar — vizual tahlil', 3 + BAR_COLS);

  let chartRow = 3;
  if (data.branchStatistics.length > 0) {
    chartRow = drawBarChart(
      sChart,
      chartRow,
      "Do'konlar bo'yicha daromad",
      data.branchStatistics.map((b) => ({ label: b.store__name, value: b.revenue })),
    );
  }
  if (data.categoryStatistics.length > 0) {
    chartRow = drawBarChart(
      sChart,
      chartRow,
      "Kategoriyalar bo'yicha daromad ulushi",
      data.categoryStatistics.map((cat) => ({
        label: cat.categoryName,
        value: cat.revenue,
        suffix: `(${cat.percent}%)`,
      })),
    );
  }
  if (data.paymentStructure.length > 0) {
    chartRow = drawBarChart(
      sChart,
      chartRow,
      "To'lov usullari bo'yicha tushum",
      data.paymentStructure.map((p) => ({
        label: p.method,
        value: p.amount,
        suffix: `(${p.percent})`,
      })),
    );
  }
  if (data.paymentMethodFlows.length > 0) {
    // Har usul uchun ikkita bar: kirim (yashil) va chiqim (qizil)
    const duo: BarItem[] = [];
    for (const f of data.paymentMethodFlows) {
      duo.push({ label: `${f.method} — kirim`, value: f.income_total, color: C.green });
      duo.push({ label: `${f.method} — chiqim`, value: f.expense_total, color: C.red });
    }
    chartRow = drawBarChart(sChart, chartRow, 'Kartalar kesimida kirim va chiqim', duo);
  }
  if (data.topSellingProducts.length > 0) {
    drawBarChart(
      sChart,
      chartRow,
      'Top mahsulotlar (sotilgan soni)',
      data.topSellingProducts.map((p) => ({ label: p.name ?? '-', value: p.totalSold, suffix: 'dona' })),
    );
  }

  // ── 3. FILIALLAR ──
  const s2 = wb.addWorksheet('Filiallar', { views: [{ showGridLines: false }] });
  addTitle(s2, "Do'konlar bo'yicha sotuvlar", 4);
  styleTableHeader(s2, 2, ['Filial', 'Daromad', 'Buyurtmalar', 'Mijozlar'], [26, 18, 14, 12]);
  data.branchStatistics.forEach((b, i) => {
    const row = i + 3;
    s2.getCell(row, 1).value = b.store__name;
    const c = s2.getCell(row, 2);
    c.value = b.revenue;
    c.numFmt = MONEY_FMT;
    s2.getCell(row, 3).value = b.orders;
    s2.getCell(row, 4).value = b.customers;
    styleDataRow(s2, row, 4, i % 2 === 1);
  });
  if (data.branchStatistics.length > 0) {
    addDataBar(s2, `B3:B${data.branchStatistics.length + 2}`, C.blue);
  }

  // ── 4. KATEGORIYALAR ──
  const sCat = wb.addWorksheet('Kategoriyalar', { views: [{ showGridLines: false }] });
  addTitle(sCat, "Kategoriyalar bo'yicha sotuvlar", 3);
  styleTableHeader(sCat, 2, ['Kategoriya', 'Daromad', 'Ulushi (%)'], [28, 18, 12]);
  data.categoryStatistics.forEach((cat, i) => {
    const row = i + 3;
    sCat.getCell(row, 1).value = cat.categoryName;
    const c = sCat.getCell(row, 2);
    c.value = cat.revenue;
    c.numFmt = MONEY_FMT;
    sCat.getCell(row, 3).value = cat.percent;
    styleDataRow(sCat, row, 3, i % 2 === 1);
  });
  if (data.categoryStatistics.length > 0) {
    addDataBar(sCat, `B3:B${data.categoryStatistics.length + 2}`, C.violet);
  }

  // ── 5. TOP MAHSULOTLAR ──
  const s3 = wb.addWorksheet('Top mahsulotlar', { views: [{ showGridLines: false }] });
  addTitle(s3, "Sotuvlar bo'yicha top mahsulotlar", 5);
  styleTableHeader(s3, 2, ['#', 'Mahsulot', 'Kategoriya', 'Sotilgan', 'Daromad'], [6, 30, 20, 12, 18]);
  data.topSellingProducts.forEach((p, i) => {
    const row = i + 3;
    s3.getCell(row, 1).value = p.rank;
    s3.getCell(row, 2).value = p.name;
    s3.getCell(row, 3).value = p.category ?? '';
    s3.getCell(row, 4).value = p.totalSold;
    const c = s3.getCell(row, 5);
    c.value = p.totalRevenue;
    c.numFmt = MONEY_FMT;
    styleDataRow(s3, row, 5, i % 2 === 1);
  });
  if (data.topSellingProducts.length > 0) {
    addDataBar(s3, `D3:D${data.topSellingProducts.length + 2}`, C.amber);
    addDataBar(s3, `E3:E${data.topSellingProducts.length + 2}`, C.green);
  }

  // ── 6. TO'LOVLAR TARKIBI (sotuv to'lovlari usullar bo'yicha) ──
  const sPay = wb.addWorksheet("To'lovlar tarkibi", { views: [{ showGridLines: false }] });
  addTitle(sPay, "To'lovlar tarkibi (sotuvlar)", 4);
  styleTableHeader(sPay, 2, ["To'lov usuli", "To'lovlar soni", 'Summa', 'Ulushi'], [20, 14, 18, 12]);
  data.paymentStructure.forEach((p, i) => {
    const row = i + 3;
    sPay.getCell(row, 1).value = p.method;
    sPay.getCell(row, 2).value = p.count;
    const c = sPay.getCell(row, 3);
    c.value = p.amount;
    c.numFmt = MONEY_FMT;
    sPay.getCell(row, 4).value = p.percent;
    sPay.getCell(row, 4).alignment = { horizontal: 'right' };
    styleDataRow(sPay, row, 4, i % 2 === 1);
  });
  if (data.paymentStructure.length > 0) {
    addDataBar(sPay, `C3:C${data.paymentStructure.length + 2}`, C.cyan);
  }

  // ── 7. KARTALAR KESIMIDA KIRIM-CHIQIM ──
  const sFlows = wb.addWorksheet("To'lov turlari kirim-chiqim", { views: [{ showGridLines: false }] });
  addTitle(sFlows, 'Kartalar kesimida kirim-chiqim', 7);
  styleTableHeader(
    sFlows,
    2,
    [
      "To'lov turi",
      'Kirim (sotuvlar)',
      'Chiqim: xarid (kirim)',
      "Chiqim: ta'minotchi to'lovi",
      'Chiqim: qaytarish',
      'Chiqim jami',
      'Balans (net)',
    ],
    [20, 17, 17, 19, 15, 15, 16],
  );
  data.paymentMethodFlows.forEach((f, i) => {
    const row = i + 3;
    sFlows.getCell(row, 1).value = f.method;
    const values = [
      f.income_total,
      f.expense_purchases,
      f.expense_supplier,
      f.expense_refunds,
      f.expense_total,
      f.net,
    ];
    values.forEach((v, col) => {
      const cell = sFlows.getCell(row, col + 2);
      cell.value = v;
      cell.numFmt = MONEY_FMT;
    });
    // Kirim yashil, chiqim jami qizil, balans ijobiy/salbiy rang
    sFlows.getCell(row, 2).font = { color: { argb: C.green }, bold: true };
    sFlows.getCell(row, 6).font = { color: { argb: C.red }, bold: true };
    sFlows.getCell(row, 7).font = { color: { argb: f.net >= 0 ? C.green : C.red }, bold: true };
    styleDataRow(sFlows, row, 7, i % 2 === 1);
  });
  if (data.paymentMethodFlows.length > 0) {
    const totalRow = data.paymentMethodFlows.length + 3;
    sFlows.getCell(totalRow, 1).value = 'Jami';
    const totals = data.paymentMethodFlows.reduce(
      (acc, f) => ({
        income: acc.income + f.income_total,
        purchases: acc.purchases + f.expense_purchases,
        supplier: acc.supplier + f.expense_supplier,
        refunds: acc.refunds + f.expense_refunds,
        expense: acc.expense + f.expense_total,
        net: acc.net + f.net,
      }),
      { income: 0, purchases: 0, supplier: 0, refunds: 0, expense: 0, net: 0 },
    );
    [totals.income, totals.purchases, totals.supplier, totals.refunds, totals.expense, totals.net].forEach(
      (v, col) => {
        const cell = sFlows.getCell(totalRow, col + 2);
        cell.value = v;
        cell.numFmt = MONEY_FMT;
      },
    );
    styleTotalRow(sFlows, totalRow, 7);
    sFlows.getCell(totalRow, 2).font = { bold: true, color: { argb: C.green } };
    sFlows.getCell(totalRow, 6).font = { bold: true, color: { argb: C.red } };
    sFlows.getCell(totalRow, 7).font = { bold: true, color: { argb: totals.net >= 0 ? C.green : C.red } };

    addDataBar(sFlows, `B3:B${data.paymentMethodFlows.length + 2}`, C.green);
    addDataBar(sFlows, `F3:F${data.paymentMethodFlows.length + 2}`, C.red);
    addColorScale(sFlows, `G3:G${data.paymentMethodFlows.length + 2}`);
  }

  // ── 8. MIJOZ QARZLARI ──
  const s4 = wb.addWorksheet('Mijoz qarzlari', { views: [{ showGridLines: false }] });
  addTitle(s4, 'Qarzdorligi bor mijozlar', 3);
  styleTableHeader(s4, 2, ['Mijoz', 'Telefon', 'Qarz'], [28, 18, 16]);
  data.debts.customerDebts.forEach((d, i) => {
    const row = i + 3;
    s4.getCell(row, 1).value = d.customerName;
    s4.getCell(row, 2).value = d.phone ?? '';
    const c = s4.getCell(row, 3);
    c.value = d.debt;
    c.numFmt = MONEY_FMT;
    c.font = { color: { argb: C.red }, bold: true };
    styleDataRow(s4, row, 3, i % 2 === 1);
  });
  if (data.debts.customerDebts.length > 0) {
    addDataBar(s4, `C3:C${data.debts.customerDebts.length + 2}`, C.red);
  }

  // ── 9. TAMINOTCHI QARZLARI ──
  const s5 = wb.addWorksheet('Taminotchi qarzlari', { views: [{ showGridLines: false }] });
  addTitle(s5, 'Taminotchilarga qarzdorlik', 2);
  styleTableHeader(s5, 2, ['Taminotchi', 'Qarz'], [30, 16]);
  data.debts.supplierDebts.forEach((d, i) => {
    const row = i + 3;
    s5.getCell(row, 1).value = d.supplierName;
    const c = s5.getCell(row, 2);
    c.value = d.debt;
    c.numFmt = MONEY_FMT;
    c.font = { color: { argb: C.red }, bold: true };
    styleDataRow(s5, row, 2, i % 2 === 1);
  });
  if (data.debts.supplierDebts.length > 0) {
    addDataBar(s5, `B3:B${data.debts.supplierDebts.length + 2}`, C.red);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
