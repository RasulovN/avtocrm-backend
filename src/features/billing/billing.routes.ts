import type { FastifyInstance } from 'fastify';
import { BadRequest } from '../../common/errors.js';
import { getInvoiceReceipt } from './billing.service.js';

export async function billingRoutes(app: FastifyInstance) {
  // GET /billing/invoices/:id/receipt — invoice (obuna) fiskal cheki.
  // Kompaniya foydalanuvchisi o'z invoice'ini, super admin istalganini ko'radi.
  app.get('/invoices/:id/receipt/', { onRequest: app.authenticate }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new BadRequest({ detail: "Noto'g'ri invoice id." });
    }
    const user = req.authUser!;
    return getInvoiceReceipt(id, {
      companyId: user.companyId,
      isSuperuser: user.isSuperuser,
    });
  });
}
