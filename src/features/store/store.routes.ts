import type { FastifyInstance } from 'fastify';
import { getCompanyId } from '../../common/tenant.js';
import { storeCreateSchema, storeUpdateSchema } from './store.schemas.js';
import {
  listStores,
  getStoreDetail,
  createStore,
  updateStore,
  deleteStore,
} from './store.service.js';

// Django apps/store/urls.py bilan AYNAN bir xil path'lar.
// Prefix `/store` modules/index.ts'da beriladi.
// Tenant-scope: barcha so'rovlar getCompanyId(req) bo'yicha filtrlanadi.
// RBAC guard'lar: o'qish -> company.stores.view, yozish -> company.stores.manage.
export async function storeRoutes(app: FastifyInstance) {
  // StoreListAPIView — GET ''
  app.get(
    '/',
    { onRequest: [app.requireCompany, app.requirePermission('company.stores.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      return listStores(companyId);
    },
  );

  // StoreCreateAPIView (service: faqat superuser) — POST 'create/'
  app.post(
    '/create/',
    { onRequest: [app.requireCompany, app.requirePermission('company.stores.create')] },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      const data = storeCreateSchema.parse(req.body);
      const store = await createStore({ user: req.authUser!, companyId, data });
      return reply.status(201).send(store);
    },
  );

  // StoreDetailAPIView.get — GET '<int:pk>/'
  app.get(
    '/:pk/',
    { onRequest: [app.requireCompany, app.requirePermission('company.stores.view')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const pk = Number((req.params as { pk: string }).pk);
      return getStoreDetail(pk, companyId);
    },
  );

  // StoreDetailAPIView.put — PUT '<int:pk>/'
  app.put(
    '/:pk/',
    { onRequest: [app.requireCompany, app.requirePermission('company.stores.update')] },
    async (req) => {
      const companyId = getCompanyId(req);
      const pk = Number((req.params as { pk: string }).pk);
      const data = storeUpdateSchema.parse(req.body);
      return updateStore(pk, companyId, data);
    },
  );

  // StoreDetailAPIView.delete — DELETE '<int:pk>/'
  app.delete(
    '/:pk/',
    { onRequest: [app.requireCompany, app.requirePermission('company.stores.delete')] },
    async (req, reply) => {
      const companyId = getCompanyId(req);
      const pk = Number((req.params as { pk: string }).pk);
      await deleteStore(pk, companyId);
      return reply.status(204).send();
    },
  );
}
