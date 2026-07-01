import { env } from '../../config/env.js';

// ============================================================
//  Fiskalizatsiya (soliq cheki) — `detail` obyekti
// ============================================================
// Bizning tizimimizda barcha to'lovlar BITTA xil xizmat uchun: dasturiy
// ta'minotdan (obuna) foydalanish. Shuning uchun doimiy bitta MXIK ishlatiladi.
//   - Merchant API: CheckPerformTransaction JAVOBIDA `detail` qaytariladi.
//   - Subscribe API: receipts.create SO'ROVIDA `detail` yuboriladi.
// QQS to'lamaymiz -> vat_percent = 0.

export interface PaymeReceiptItem {
  title: string;
  price: number; // 1 dona narxi (tiyin)
  count: number;
  code: string; // MXIK / ИКПУ
  package_code: string; // o'lchov birligi kodi
  vat_percent: number;
}

export interface PaymeReceiptDetail {
  receipt_type: number; // 0 = sotuv
  items: PaymeReceiptItem[];
}

interface SubscriptionLike {
  plan?: { name?: string | null } | null;
}

// Obuna + summa (tiyin) asosida fiskal `detail` yasaydi.
export function buildFiscalDetail(
  subscription: SubscriptionLike,
  amountTiyin: number,
): PaymeReceiptDetail {
  const planName = subscription.plan?.name?.trim();
  const title = planName
    ? `Obuna — ${planName} (dasturiy taʼminotdan foydalanish)`
    : 'Dasturiy taʼminotdan (maʼlumotlar bazasi) foydalanish xizmati';

  return {
    receipt_type: 0,
    items: [
      {
        title,
        price: amountTiyin,
        count: 1,
        code: env.PAYME_FISCAL_MXIK,
        package_code: env.PAYME_FISCAL_PACKAGE_CODE,
        vat_percent: env.PAYME_FISCAL_VAT_PERCENT,
      },
    ],
  };
}
