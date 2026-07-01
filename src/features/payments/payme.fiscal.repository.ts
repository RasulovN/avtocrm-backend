import { Prisma } from '@prisma/client';
import type { PaymeFiscalReceipt } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

// ============================================================
//  Fiskal chek repozitoriysi (Repository Pattern)
//  Payme `SetFiscalData` orqali kelgan fiskal (Soliq/OFD) cheklarni saqlaydi/o'qiydi.
//  Ma'lumotlar bazasiga kirish faqat shu qatlamda — servis toza qoladi.
// ============================================================

export interface FiscalReceiptUpsert {
  paymeReceiptId: string;
  type: 'PERFORM' | 'CANCEL';
  transactionId?: number | null;
  subscriptionId?: number | null;
  receiptId?: string | null;
  terminalId?: string | null;
  fiscalSign?: string | null;
  qrCodeUrl?: string | null;
  statusCode?: number | null;
  message?: string | null;
  fiscalDate?: string | null;
  raw?: unknown;
}

export const paymeFiscalRepository = {
  // Idempotent: (paymeReceiptId, type) bo'yicha yaratadi yoki yangilaydi.
  upsert(data: FiscalReceiptUpsert): Promise<PaymeFiscalReceipt> {
    const payload = {
      transactionId: data.transactionId ?? null,
      subscriptionId: data.subscriptionId ?? null,
      receiptId: data.receiptId ?? null,
      terminalId: data.terminalId ?? null,
      fiscalSign: data.fiscalSign ?? null,
      qrCodeUrl: data.qrCodeUrl ?? null,
      statusCode: data.statusCode ?? null,
      message: data.message ?? null,
      fiscalDate: data.fiscalDate ?? null,
      raw: (data.raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    };
    return prisma.paymeFiscalReceipt.upsert({
      where: { paymeReceiptId_type: { paymeReceiptId: data.paymeReceiptId, type: data.type } },
      update: payload,
      create: { paymeReceiptId: data.paymeReceiptId, type: data.type, ...payload },
    });
  },

  // Obuna (invoice) bo'yicha to'lov (PERFORM) fiskal cheki.
  findPerformBySubscription(subscriptionId: number): Promise<PaymeFiscalReceipt | null> {
    return prisma.paymeFiscalReceipt.findFirst({
      where: { subscriptionId, type: 'PERFORM' },
      orderBy: { createdAt: 'desc' },
    });
  },
};
