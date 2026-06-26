// Contract moduli service barrel — supplier, stock entry va supplier payment
// logikasi alohida fayllarga bo'lingan (Django services/ tuzilishiga mos).

export {
  serializeSupplierGet,
  serializeSupplierDetail,
  serializeSupplierListRow,
  serializeSupplierTransaction,
  listSuppliers,
  getSupplierOr404,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  listEntryTransactions,
  makePayment,
} from './supplier.service.js';

export {
  calculatePaymentFields,
  createEntry,
  listStockEntries,
  serializeCreateResponse,
} from './stockEntry.service.js';
