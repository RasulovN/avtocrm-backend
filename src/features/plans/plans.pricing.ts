import { Prisma } from '@prisma/client';

// Oldindan to'lash mumkin bo'lgan oylar (1 asosiy + 3/6/12 oldindan).
export const PERIOD_MONTHS = [1, 3, 6, 12] as const;

// Chegirma foizini xavfsiz oraliqqa keltiradi (0..90 butun).
export function clampPercent(n: number | null | undefined): number {
  const v = Math.round(Number(n) || 0);
  return Math.max(0, Math.min(90, v));
}

interface PlanDiscounts {
  discountM3: number;
  discountM6: number;
  discountM12: number;
}

// Berilgan oy uchun chegirma foizi (1 oy -> 0).
export function discountForMonths(plan: PlanDiscounts, months: number): number {
  switch (months) {
    case 3:
      return clampPercent(plan.discountM3);
    case 6:
      return clampPercent(plan.discountM6);
    case 12:
      return clampPercent(plan.discountM12);
    default:
      return 0;
  }
}

// Chegirma qo'llangan yakuniy summa (2 kasr xonagacha yaxlitlangan).
//   gross = price * months ;  amount = gross * (100 - pct) / 100
export function discountedAmount(price: Prisma.Decimal, months: number, pct: number): Prisma.Decimal {
  const gross = price.mul(months);
  if (pct <= 0) return gross.toDecimalPlaces(2);
  return gross.mul(100 - pct).div(100).toDecimalPlaces(2);
}

// Frontend uchun har bir muddat bo'yicha narx varianti.
export interface PricingOption {
  months: number;
  discount_percent: number;
  gross: string; // chegirmasiz (price * months)
  total: string; // chegirma bilan
  monthly: string; // oylik ekvivalent (total / months)
}

export function buildPricingOptions(price: Prisma.Decimal, plan: PlanDiscounts): PricingOption[] {
  return PERIOD_MONTHS.map((months) => {
    const pct = discountForMonths(plan, months);
    const gross = price.mul(months).toDecimalPlaces(2);
    const total = discountedAmount(price, months, pct);
    const monthly = total.div(months).toDecimalPlaces(2);
    return {
      months,
      discount_percent: pct,
      gross: gross.toString(),
      total: total.toString(),
      monthly: monthly.toString(),
    };
  });
}
