import type { FastifyInstance, FastifyReply } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import { getCompanyId } from '../../common/tenant.js';
import { BadRequest } from '../../common/errors.js';
import {
  supplierCreateSchema,
  supplierUpdateSchema,
  stockEntryCreateSchema,
  supplierPaymentSchema,
  purchaseSessionCreateSchema,
  purchaseSessionUpdateSchema,
} from './contract.schemas.js';
import {
  listSuppliers,
  getSupplierOr404,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  serializeSupplierGet,
  serializeSupplierDetail,
  listEntryTransactions,
  makePayment,
  getSupplierStats,
  listSupplierPayments,
  listSupplierProducts,
} from './supplier.service.js';
import {
  createEntry,
  listStockEntries,
  serializeCreateResponse,
  type StockEntryPaymentStatus,
} from './stockEntry.service.js';
import {
  listActiveSessions,
  createSession,
  getSessionOr404,
  serializePurchaseSession,
  updateSession,
  cancelSession,
  receiveSession,
  confirmSession,
} from './purchaseSession.service.js';
import {
  buildSupplierExportExcel,
  buildStockEntryExportExcel,
} from './contractExport.service.js';
import {
  importStockEntryFromExcel,
  resolveEntryStore,
  buildKirimTemplate,
} from './stockEntryImport.service.js';

// Multipart matn maydonini o'qish (@fastify/multipart fields formatidan).
function multipartField(fields: Record<string, unknown>, name: string): string {
  const f = fields[name];
  const single = Array.isArray(f) ? f[0] : f;
  const value = (single as { value?: unknown } | undefined)?.value;
  return value === undefined || value === null ? '' : String(value).trim();
}

// Django apps/contract/urls.py bilan AYNAN bir xil path'lar (prefix /contract index.ts'da).
export async function contractRoutes(app: FastifyInstance) {
  // ───────────────────── Supplier ─────────────────────

  // GET supplier/ — SupplierListAPIView (company scope + suppliers.view)
  // ?search= &is_active= &has_debt=true &ordering=name|-total_purchase_amount|-total_debt|-created_at
  app.get(
    '/supplier/',
    { onRequest: [app.requireCompany, app.requirePermission('company.suppliers.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const search = (q.search ?? '').trim() || null;
      const isActive = q.is_active ?? null;
      const hasDebt = q.has_debt === 'true' || q.has_debt === '1';
      const ordering = (q.ordering ?? '').trim() || null;
      const { results, count } = await listSuppliers({ companyId, search, isActive, hasDebt, ordering, page });
      return paginate(req, results, count, page);
    },
  );

  // GET supplier/export/ — SupplierExportAPIView (.xlsx)
  app.get(
    '/supplier/export/',
    { onRequest: [app.requireCompany, app.requirePermission('company.suppliers.view')] },
    async (req, reply: FastifyReply) => {
      const companyId = getCompanyId(req);
      const q = req.query as Record<string, string | undefined>;
      const buffer = await buildSupplierExportExcel({
        companyId,
        search: (q.search ?? '').trim() || null,
        isActive: q.is_active ?? null,
        hasDebt: q.has_debt === 'true' || q.has_debt === '1',
        ordering: (q.ordering ?? '').trim() || null,
        dateFrom: q.date_from ?? null,
        dateTo: q.date_to ?? null,
      });
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="taminotchilar.xlsx"')
        .send(buffer);
    },
  );

  // GET supplier/:pk/stats/ — SupplierStatsAPIView (detail sahifa dashboardi)
  app.get(
    '/supplier/:pk/stats/',
    { onRequest: [app.requireCompany, app.requirePermission('company.suppliers.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const pk = Number((req.params as { pk: string }).pk);
      return getSupplierStats(companyId, pk);
    },
  );

  // GET supplier/:pk/payments/ — SupplierPaymentsBySupplierAPIView (paginated)
  app.get(
    '/supplier/:pk/payments/',
    { onRequest: [app.requireCompany, app.requirePermission('company.suppliers.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const pk = Number((req.params as { pk: string }).pk);
      const page = getPageParams(req);
      const { results, count } = await listSupplierPayments({ companyId, supplierId: pk, page });
      return paginate(req, results, count, page);
    },
  );

  // GET supplier/:pk/products/ — SupplierProductsAPIView (paginated, ?search=)
  app.get(
    '/supplier/:pk/products/',
    { onRequest: [app.requireCompany, app.requirePermission('company.suppliers.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const pk = Number((req.params as { pk: string }).pk);
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const { results, count } = await listSupplierProducts({
        companyId,
        supplierId: pk,
        search: (q.search ?? '').trim() || null,
        page,
      });
      return paginate(req, results, count, page);
    },
  );

  // POST supplier/create/ — SupplierCreateAPIView (suppliers.manage; service superuser ham tekshiradi)
  app.post(
    '/supplier/create/',
    { onRequest: [app.requireCompany, app.requirePermission('company.suppliers.create')] },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      const body = supplierCreateSchema.parse(req.body);
      const supplier = await createSupplier({
        companyId,
        requestUserIsSuperuser: req.authUser!.isSuperuser,
        data: body,
      });
      return reply.status(201).send(serializeSupplierGet(supplier));
    },
  );

  // GET supplier/:pk/ — SupplierDetailAPIView.get (SupplierSerializer)
  app.get(
    '/supplier/:pk/',
    { onRequest: [app.requireCompany, app.requirePermission('company.suppliers.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const pk = Number((req.params as { pk: string }).pk);
      const supplier = await getSupplierOr404(companyId, pk);
      return serializeSupplierDetail(supplier);
    },
  );

  // PUT supplier/:pk/ — SupplierDetailAPIView.put (partial; SupplierGetSerializer javob)
  app.put(
    '/supplier/:pk/',
    { onRequest: [app.requireCompany, app.requirePermission('company.suppliers.update')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const pk = Number((req.params as { pk: string }).pk);
      const instance = await getSupplierOr404(companyId, pk);
      const body = supplierUpdateSchema.parse(req.body);
      const supplier = await updateSupplier({
        requestUserIsSuperuser: req.authUser!.isSuperuser,
        instance,
        data: body,
      });
      return serializeSupplierGet(supplier);
    },
  );

  // DELETE supplier/:pk/ — SupplierDetailAPIView.delete (204)
  app.delete(
    '/supplier/:pk/',
    { onRequest: [app.requireCompany, app.requirePermission('company.suppliers.delete')] },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      const pk = Number((req.params as { pk: string }).pk);
      const instance = await getSupplierOr404(companyId, pk);
      await deleteSupplier({
        requestUserIsSuperuser: req.authUser!.isSuperuser,
        instance,
      });
      return reply.status(204).send();
    },
  );

  // ───────────────────── Stock Entry ─────────────────────

  // GET entry/list/ — StockEntryListAPIView (company scope + stock_entries.view)
  app.get(
    '/entry/list/',
    { onRequest: [app.requireCompany, app.requirePermission('company.stock_entries.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const paymentStatus = ['unpaid', 'partial', 'paid'].includes(q.payment_status ?? '')
        ? (q.payment_status as StockEntryPaymentStatus)
        : null;
      const { results, count } = await listStockEntries({
        companyId,
        search: (q.search ?? '').trim() || null,
        supplier: q.supplier ? Number(q.supplier) : null,
        store: q.store ? Number(q.store) : null,
        dateFrom: q.date_from ?? null,
        dateTo: q.date_to ?? null,
        ordering: q.ordering ?? null,
        paymentStatus,
        page,
      });
      return paginate(req, results, count, page);
    },
  );

  // GET entry/export/ — StockEntryExportAPIView (.xlsx, ro'yxat filtrlari bilan)
  app.get(
    '/entry/export/',
    { onRequest: [app.requireCompany, app.requirePermission('company.stock_entries.view')] },
    async (req, reply: FastifyReply) => {
      const companyId = getCompanyId(req);
      const q = req.query as Record<string, string | undefined>;
      const buffer = await buildStockEntryExportExcel({
        companyId,
        search: (q.search ?? '').trim() || null,
        supplier: q.supplier ? Number(q.supplier) : null,
        store: q.store ? Number(q.store) : null,
        dateFrom: q.date_from ?? null,
        dateTo: q.date_to ?? null,
      });
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="xaridlar.xlsx"')
        .send(buffer);
    },
  );

  // ───────────────────── Purchase session (progressiv kirim wizard'i) ─────────────────────
  // Django: entry/session/ (list/create), entry/session/:pk/ (get/patch/delete),
  //         entry/session/:pk/receive/, entry/session/:pk/confirm/

  const sessionGuard = {
    onRequest: [app.requireCompany, app.requirePermission('company.stock_entries.create')],
  };

  // GET entry/session/ — foydalanuvchining faol (tugallanmagan) sessiyalari
  app.get('/entry/session/', sessionGuard, async (req) => {
    const companyId = getCompanyId(req);
    return listActiveSessions(companyId, req.authUser!.id);
  });

  // POST entry/session/ — yangi sessiya boshlash (1-bosqich yakunida)
  app.post('/entry/session/', sessionGuard, async (req, reply) => {
    const companyId = getCompanyId(req);
    const body = purchaseSessionCreateSchema.parse(req.body);
    const session = await createSession({ companyId, userId: req.authUser!.id, data: body });
    return reply.status(201).send(session);
  });

  // GET entry/session/:pk/ — sessiyani olish
  app.get('/entry/session/:pk/', sessionGuard, async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const session = await getSessionOr404(companyId, req.authUser!.id, pk);
    return serializePurchaseSession(session);
  });

  // PATCH entry/session/:pk/ — avto-saqlash (qisman yangilash)
  app.patch('/entry/session/:pk/', sessionGuard, async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const body = purchaseSessionUpdateSchema.parse(req.body);
    return updateSession({ companyId, userId: req.authUser!.id, pk, data: body });
  });

  // DELETE entry/session/:pk/ — bekor qilish (status=cancelled, 204)
  app.delete('/entry/session/:pk/', sessionGuard, async (req, reply) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    await cancelSession(companyId, req.authUser!.id, pk);
    return reply.status(204).send();
  });

  // POST entry/session/:pk/receive/ — mahsulotlarni qabul qilish (ombor o'zgarmaydi)
  app.post('/entry/session/:pk/receive/', sessionGuard, async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    return receiveSession(companyId, req.authUser!.id, pk);
  });

  // POST entry/session/:pk/confirm/ — tasdiqlash: haqiqiy kirim yaratiladi
  app.post('/entry/session/:pk/confirm/', sessionGuard, async (req, reply) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const result = await confirmSession(companyId, req.authUser!.id, pk);
    return reply.status(201).send(result);
  });

  // POST entry/create/ — StockEntryCreateAPIView (stock_entries.manage)
  app.post(
    '/entry/create/',
    { onRequest: [app.requireCompany, app.requirePermission('company.stock_entries.create')] },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      const body = stockEntryCreateSchema.parse(req.body);
      const entry = await createEntry({ companyId, data: body, userId: req.authUser!.id });
      return reply.status(201).send(serializeCreateResponse(entry, body.items.length));
    },
  );

  // ───────────────────── Stock Entry — Excel import ─────────────────────

  // POST entry/import/ — Excel fayldan kirim yaratish (Django StockEntryImportAPIView).
  // multipart/form-data: file (.xlsx, majburiy), supplier (majburiy),
  // cash_amount / card_amount (ixtiyoriy, default 0), store (ixtiyoriy — berilmasa
  // yagona asosiy do'kon avtomatik tanlanadi).
  app.post(
    '/entry/import/',
    { onRequest: [app.requireCompany, app.requirePermission('company.stock_entries.create')] },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      if (!req.isMultipart()) {
        throw new BadRequest({ detail: 'file maydoni majburiy.' });
      }
      const file = await req.file();
      if (!file) {
        throw new BadRequest({ detail: 'file maydoni majburiy.' });
      }
      if (!file.filename.toLowerCase().endsWith('.xlsx')) {
        throw new BadRequest({ detail: 'Faqat .xlsx fayl qabul qilinadi.' });
      }
      const buffer = await file.toBuffer();

      const fields = file.fields as Record<string, unknown>;
      const supplierId = Number(multipartField(fields, 'supplier'));
      if (!Number.isInteger(supplierId) || supplierId <= 0) {
        throw new BadRequest({ detail: 'supplier maydoni majburiy.' });
      }
      const cashAmount = Number(multipartField(fields, 'cash_amount') || '0');
      const cardAmount = Number(multipartField(fields, 'card_amount') || '0');
      if (Number.isNaN(cashAmount) || cashAmount < 0 || Number.isNaN(cardAmount) || cardAmount < 0) {
        throw new BadRequest({ detail: "cash_amount / card_amount manfiy bo'lmagan raqam bo'lishi kerak." });
      }
      const storeRaw = multipartField(fields, 'store');
      const storeId = await resolveEntryStore(companyId, storeRaw ? Number(storeRaw) : null);

      const result = await importStockEntryFromExcel({
        companyId,
        userId: req.authUser!.id,
        buffer,
        supplierId,
        storeId,
        cashAmount,
        cardAmount,
      });

      if (result.entry_id === null) {
        // Hech bir satr import qilinmadi — sabablar skipped da
        return reply.status(400).send({
          detail: "Hech qanday yaroqli satr topilmadi, kirim yaratilmadi.",
          ...result,
        });
      }
      return reply.status(201).send(result);
    },
  );

  // GET entry/import/template/ — kirim shablonini yuklab olish
  app.get(
    '/entry/import/template/',
    { onRequest: [app.requireCompany, app.requirePermission('company.stock_entries.view')] },
    async (_req, reply: FastifyReply) => {
      const buffer = await buildKirimTemplate();
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="kirim_import_shablon.xlsx"')
        .send(buffer);
    },
  );

  // ───────────────────── Supplier payments ─────────────────────

  // POST supplier-payments/create/ — SupplierPaymentAPIView (stock_entries.manage)
  app.post(
    '/supplier-payments/create/',
    { onRequest: [app.requireCompany, app.requirePermission('company.suppliers.update')] },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      const body = supplierPaymentSchema.parse(req.body);
      const payment = await makePayment({
        companyId,
        supplierId: body.supplier,
        entryId: body.entry,
        amount: body.amount,
        note: body.note,
        paymentType: body.payment_type,
        bankCardId: body.bank_card,
        userFullName: req.authUser!.fullName,
      });
      return reply.status(201).send({
        status: 'success',
        message: "To'lov muvaffaqiyatli qabul qilindi",
        transaction_id: payment.id,
        amount: Number(payment.amount).toFixed(2),
      });
    },
  );

  // GET supplier-payments/:entry_id/ — SupplierPaymentListAPIView (stock_entries.view)
  app.get(
    '/supplier-payments/:entry_id/',
    { onRequest: [app.requireCompany, app.requirePermission('company.stock_entries.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const entryId = Number((req.params as { entry_id: string }).entry_id);
      return listEntryTransactions(companyId, entryId);
    },
  );
}
