import type { FastifyInstance } from 'fastify';

// ===== SaaS platform =====
import { authRoutes } from './auth/auth.routes.js';
import { rbacRoutes } from './rbac/rbac.routes.js';
import { companiesRoutes } from './companies/companies.routes.js';
import { companyCategoriesRoutes } from './company-categories/companyCategories.routes.js';
import { geoRoutes } from './geo/geo.routes.js';
import { plansRoutes } from './plans/plans.routes.js';
import { subscriptionsRoutes } from './subscriptions/subscriptions.routes.js';
import { paymentsRoutes } from './payments/payments.routes.js';
import { notificationsRoutes } from './notifications/notifications.routes.js';
import { auditRoutes } from './audit/audit.routes.js';

// ===== CRM (tenant) =====
import { usersRoutes } from './users/users.routes.js';
import { storeRoutes } from './store/store.routes.js';
import { contractRoutes } from './contract/contract.routes.js';
import { productsRoutes } from './products/products.routes.js';
import { transferRoutes } from './transfer/transfer.routes.js';
import { salesRoutes } from './sales/sales.routes.js';
import { debtsRoutes } from './debts/debts.routes.js';
import { reportsRoutes } from './reports/reports.routes.js';
import { inventoryRoutes } from './inventory/inventory.routes.js';
import { leadsRoutes } from './leads/leads.routes.js';
import { siteSettingsRoutes } from './site-settings/siteSettings.routes.js';

export async function registerRoutes(app: FastifyInstance) {
  // SaaS platform
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(rbacRoutes, { prefix: '/rbac' });
  await app.register(companiesRoutes, { prefix: '/companies' });
  await app.register(companyCategoriesRoutes, { prefix: '/company-categories' });
  await app.register(geoRoutes, { prefix: '/geo' });
  await app.register(plansRoutes, { prefix: '/plans' });
  await app.register(subscriptionsRoutes, { prefix: '/subscriptions' });
  await app.register(paymentsRoutes, { prefix: '/payments' });
  await app.register(notificationsRoutes, { prefix: '/notifications' });
  await app.register(auditRoutes, { prefix: '/audit' });
  await app.register(leadsRoutes, { prefix: '/leads' });
  await app.register(siteSettingsRoutes, { prefix: '/site-settings' });

  // CRM (tenant ma'lumotlari)
  await app.register(usersRoutes, { prefix: '/users' });
  await app.register(storeRoutes, { prefix: '/store' });
  await app.register(contractRoutes, { prefix: '/contract' });
  await app.register(productsRoutes, { prefix: '/products' });
  await app.register(transferRoutes, { prefix: '/transfer' });
  await app.register(salesRoutes, { prefix: '/sales' });
  await app.register(debtsRoutes, { prefix: '/debts' });
  await app.register(reportsRoutes, { prefix: '/reports' });
  await app.register(inventoryRoutes, { prefix: '/inventory' });
}
