import { prisma } from '../../db/prisma.js';
import { NotFound } from '../../common/errors.js';
import { paymeFiscalRepository } from '../payments/payme.fiscal.repository.js';

// ============================================================
//  Billing — invoice (obuna) uchun fiskal chek DTO
//  Fiskal ma'lumot Payme `SetFiscalData` orqali avtomatik keladi (payme_fiscal_receipt).
// ============================================================

export interface FiscalReceiptDTO {
  receiptNumber: string | null; // fiscal_data.receipt_id
  receiptUrl: string | null; // fiscal_data.qr_code_url (OFD chek manzili)
  qrCode: string | null; // QR ichidagi manzil (= receiptUrl)
  fiscalId: string | null; // fiscal_data.fiscal_sign
  date: string | null; // fiscal_data.date
}

export interface InvoiceReceiptResponse {
  success: boolean;
  invoiceId: number;
  fiscalReceipt: FiscalReceiptDTO | null;
  message?: string;
}

// invoiceId = obuna (subscription) id. Bizda invoice = obuna to'lovi.
export async function getInvoiceReceipt(
  invoiceId: number,
  ctx: { companyId: number | null; isSuperuser: boolean },
): Promise<InvoiceReceiptResponse> {
  const sub = await prisma.subscription.findUnique({
    where: { id: invoiceId },
    select: { id: true, companyId: true },
  });
  // Egasi bo'lmagan/mavjud bo'lmagan invoice — mavjudligini oshkor qilmaymiz (NotFound).
  if (!sub || (!ctx.isSuperuser && sub.companyId !== ctx.companyId)) {
    throw new NotFound({ detail: 'Invoice topilmadi.' });
  }

  const fiscal = await paymeFiscalRepository.findPerformBySubscription(invoiceId);
  if (!fiscal || !fiscal.qrCodeUrl) {
    return {
      success: false,
      invoiceId,
      fiscalReceipt: null,
      message: "Fiskal chek hali mavjud emas. Payme fiskallashtirgach avtomatik paydo bo'ladi.",
    };
  }

  return {
    success: true,
    invoiceId,
    fiscalReceipt: {
      receiptNumber: fiscal.receiptId,
      receiptUrl: fiscal.qrCodeUrl,
      qrCode: fiscal.qrCodeUrl,
      fiscalId: fiscal.fiscalSign,
      date: fiscal.fiscalDate,
    },
  };
}
