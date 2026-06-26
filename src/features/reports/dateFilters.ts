import { ValidationError } from '../../common/errors.js';

// ─────────────────────────────────────────────
//  Sana filtrlash yordamchilari
//  Django apps/reports/utils/date_filters.py + date_parser.py +
//  dashboard_service.py:DateRangeResolver mantig'i AYNAN ko'chirilgan.
// ─────────────────────────────────────────────

// ── utils/date_filters.py: DateRangeResolver ──
// filter_type bo'yicha [start, end] oralig'ini qaytaradi (timestamps).
// daily  -> bugun 00:00 .. now
// weekly -> now - 7 kun .. now
// monthly-> now - 30 kun .. now
// yearly -> now - 365 kun .. now
// boshqa -> [null, null]
export function resolveDateRange(
  filterType: string | undefined,
): [Date, Date] | [null, null] {
  const now = new Date();

  if (filterType === 'daily') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return [start, now];
  }
  if (filterType === 'weekly') {
    return [addDays(now, -7), now];
  }
  if (filterType === 'monthly') {
    return [addDays(now, -30), now];
  }
  if (filterType === 'yearly') {
    return [addDays(now, -365), now];
  }
  return [null, null];
}

// ── utils/date_parser.py: DateValidator.validate ──
// from/to ikkalasi ham bo'lmasa -> [null, null].
// Yaroqsiz format -> ValidationError.
// from > to -> ValidationError.
// to -> shu kunning 23:59:59 ga ko'tariladi (inclusive range).
export function validateDates(
  fromStr: string | undefined | null,
  toStr: string | undefined | null,
): [Date, Date] | [null, null] {
  if (!fromStr || !toStr) {
    return [null, null];
  }

  const fromDt = parseDateTime(fromStr);
  const toDt = parseDateTime(toStr);

  if (!fromDt || !toDt) {
    throw new ValidationError({ detail: 'Invalid datetime format' });
  }

  if (fromDt.getTime() > toDt.getTime()) {
    throw new ValidationError({ detail: 'from_date cannot be greater than to_date' });
  }

  toDt.setHours(23, 59, 59, 0);
  return [fromDt, toDt];
}

// Django parse_datetime: ISO 'YYYY-MM-DD' yoki 'YYYY-MM-DDTHH:MM:SS' ni qabul qiladi.
// 'YYYY-MM-DD' bo'lsa Django parse_datetime None qaytaradi -> bu yerda ham null.
// (DateValidator only accepts datetime; date-only -> invalid -> ValidationError.)
function parseDateTime(value: string): Date | null {
  // parse_datetime faqat datetime (vaqt qismi bilan) ni qabul qiladi.
  // Sof 'YYYY-MM-DD' -> None (Django).
  const dateTimeRe = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;
  if (!dateTimeRe.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────
//  dashboard_service.py: DateRangeResolver (joriy + oldingi davr)
//  weekly | monthly | yearly. Growth hisoblash uchun prev oraliq ham.
// ─────────────────────────────────────────────
export interface DashboardDateRange {
  currentFrom: Date;
  currentTo: Date;
  prevFrom: Date;
  prevTo: Date;
}

export function resolveDashboardRange(period: string): DashboardDateRange {
  const now = new Date();

  if (period === 'weekly') {
    // Joriy haftaning Dushanbasi (weekday=0 — Django) soat 00:00:00
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    // JS getDay(): 0=Yakshanba..6=Shanba; Django weekday(): 0=Dushanba..6=Yakshanba
    const isoWeekday = (today.getDay() + 6) % 7; // 0=Dushanba
    const currentFrom = addDays(today, -isoWeekday);
    const currentTo = now;
    const prevFrom = addDays(currentFrom, -7);
    const prevTo = currentFrom;
    return { currentFrom, currentTo, prevFrom, prevTo };
  }

  if (period === 'monthly') {
    const currentFrom = addDays(now, -30);
    const currentTo = now;
    const prevFrom = addDays(currentFrom, -30);
    const prevTo = currentFrom;
    return { currentFrom, currentTo, prevFrom, prevTo };
  }

  // yearly
  const currentFrom = addDays(now, -365);
  const currentTo = now;
  const prevFrom = addDays(currentFrom, -365);
  const prevTo = currentFrom;
  return { currentFrom, currentTo, prevFrom, prevTo };
}

// ── Yordamchilar ──
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Django timezone.localdate() ekvivalenti — bugungi sana (00:00).
export function localDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// 'YYYY-MM-DD' sana stringidan local 00:00 Date.
export function dateFromISO(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) {
    throw new ValidationError({ 'from/to': 'ISO format bo\'lishi kerak: YYYY-MM-DD.' });
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

// Inclusive kun oxiri: shu sananing 23:59:59.999.
export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
