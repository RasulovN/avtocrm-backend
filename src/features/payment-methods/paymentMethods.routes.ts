import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  paymentMethodCreateSchema,
  paymentMethodUpdateSchema,
} from './paymentMethods.schemas.js';
import {
  listActivePaymentMethods,
  listAllPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
} from './paymentMethods.service.js';

function idParam(req: FastifyRequest): number {
  return Number((req.params as { id: string }).id);
}

export async function paymentMethodsRoutes(app: FastifyInstance) {
  const manage = {
    onRequest: [app.authenticate, app.requirePermission('platform.payment_methods.manage')],
  };

  // ============================================================
  //  TENANT (POS): faol to'lov turlari — sotuvda karta kanali tanlash uchun
  // ============================================================
  app.get('/', { onRequest: app.authenticate }, async () => {
    return listActivePaymentMethods();
  });

  // ============================================================
  //  SUPER ADMIN CRUD
  // ============================================================
  app.get(
    '/admin/',
    { onRequest: [app.authenticate, app.requirePermission('platform.payment_methods.view')] },
    async () => {
      return listAllPaymentMethods();
    },
  );

  app.post('/', manage, async (req, reply) => {
    const body = paymentMethodCreateSchema.parse(req.body);
    return reply.status(201).send(await createPaymentMethod(body));
  });

  app.put('/:id/', manage, async (req) => {
    const body = paymentMethodUpdateSchema.parse(req.body);
    return updatePaymentMethod(idParam(req), body);
  });

  app.delete('/:id/', manage, async (req, reply) => {
    await deletePaymentMethod(idParam(req));
    return reply.status(204).send();
  });
}
