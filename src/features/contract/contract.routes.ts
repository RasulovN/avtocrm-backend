import type { FastifyInstance, FastifyReply } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import { getCompanyId } from '../../common/tenant.js';
import { BadRequest } from '../../common/errors.js';
import {
  supplierCreateSchema,
  supplierUpdateSchema,
  stockEntryCreateSchema,
  supplierPaymentSchema,
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
} from './supplier.service.js';
import {
  createEntry,
  listStockEntries,
  serializeCreateResponse,
} from './stockEntry.service.js';
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
  app.get(
    '/supplier/',
    { onRequest: [app.requireCompany, app.requirePermission('company.suppliers.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const q = req.query as Record<string, string | undefined>;
      const page = getPageParams(req);
      const search = (q.search ?? '').trim() || null;
      const isActive = q.is_active ?? null;
      const { results, count } = await listSuppliers({ companyId, search, isActive, page });
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
      const { results, count } = await listStockEntries({
        companyId,
        search: (q.search ?? '').trim() || null,
        supplier: q.supplier ? Number(q.supplier) : null,
        store: q.store ? Number(q.store) : null,
        dateFrom: q.date_from ?? null,
        dateTo: q.date_to ?? null,
        ordering: q.ordering ?? null,
        page,
      });
      return paginate(req, results, count, page);
    },
  );

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
