import { prisma } from '../../db/prisma.js';
import type { SetFiscalDataInput } from './payments.schemas.js';
import { paymeFiscalRepository } from './payme.fiscal.repository.js';

// ============================================================
//  SetFiscalData (Merchant API) — Payme fiskallashtirishdan so'ng
//  webhookga yuboradigan fiskal (Soliq/OFD) chekni qabul qilib saqlaydi.
//  Rasmiy hujjat: developer.help.paycom.uz/metody-merchant-api/setfiscaldata/
// ============================================================

export interface SetFiscalResult {
  matchedTransaction: boolean;
  subscriptionId: number | null;
  type: 'PERFORM' | 'CANCEL';
}

export async function handleSetFiscalData(params: SetFiscalDataInput): Promise<SetFiscalResult> {
  const paymeReceiptId = params.id; // Merchant API'da = tranzaksiya paycomId'si
  const fd = params.fiscal_data;

  const tx = await prisma.paymeTransaction.findUnique({ where: { paycomId: paymeReceiptId } });

  await paymeFiscalRepository.upsert({
    paymeReceiptId,
    type: params.type,
    transactionId: tx?.id ?? null,
    subscriptionId: tx?.subscriptionId ?? null,
    receiptId: fd.receipt_id ?? null,
    terminalId: fd.terminal_id ?? null,
    fiscalSign: fd.fiscal_sign ?? null,
    qrCodeUrl: fd.qr_code_url ?? null,
    statusCode: fd.status_code ?? null,
    message: fd.message ?? null,
    fiscalDate: fd.date ?? null,
    raw: fd,
  });

  // PERFORM (to'lov) cheki URL'ini tranzaksiyaga ko'chiramiz — mavjud "To'lov cheki"
  // modali va invoice endpointi shu orqali fiskal chekni darhol ko'rsatadi.
  if (tx && params.type === 'PERFORM' && fd.qr_code_url) {
    await prisma.paymeTransaction.update({
      where: { id: tx.id },
      data: { fiscalUrl: fd.qr_code_url },
    });
  }

  return {
    matchedTransaction: Boolean(tx),
    subscriptionId: tx?.subscriptionId ?? null,
    type: params.type,
  };
}
