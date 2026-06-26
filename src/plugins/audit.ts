import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { recordAudit } from '../common/audit.js';

// ──────────────────────────────────────────────────────────────
// Avtomatik audit: muvaffaqiyatli yozuv (POST/PUT/PATCH/DELETE)
// so'rovlarini loglaydi. login/logout alohida (auth route'larda) yoziladi.
// ──────────────────────────────────────────────────────────────

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const ENTITY_MAP: Record<string, string> = {
  products: 'product',
  sales: 'sale',
  transfer: 'transfer',
  contract: 'stock_entry',
  inventory: 'inventory',
  store: 'store',
  users: 'user',
  debts: 'debt',
  companies: 'company',
  subscriptions: 'subscription',
  rbac: 'role',
  'company-categories': 'company_category',
  geo: 'geo',
  plans: 'plan',
  reports: 'report',
};

function actionFor(method: string): string {
  if (method === 'POST') return 'create';
  if (method === 'DELETE') return 'delete';
  return 'update';
}

function entityFor(path: string): string {
  const parts = path.split('?')[0].split('/').filter(Boolean); // ['api','products','create']
  const seg = parts[0] === 'api' ? parts[1] : parts[0];
  return ENTITY_MAP[seg] ?? seg ?? 'unknown';
}

function shouldSkip(path: string): boolean {
  const p = path.split('?')[0];
  return (
    p.startsWith('/api/auth') ||
    p.startsWith('/api/payments') || // Payme webhook (user yo'q)
    p === '/api/users/login/' ||
    p === '/api/users/logout/' ||
    p.startsWith('/api/users/auth') ||
    p.endsWith('/read/') ||
    p.endsWith('/read-all/')
  );
}

export const auditPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('onResponse', async (req, reply) => {
    try {
      if (!WRITE_METHODS.has(req.method)) return;
      if (reply.statusCode >= 400) return;
      const user = req.authUser;
      if (!user) return;
      const path = req.url;
      if (shouldSkip(path)) return;

      recordAudit({
        userId: user.id,
        companyId: req.companyId ?? user.companyId ?? null,
        action: actionFor(req.method),
        entity: entityFor(path),
        summary: `${req.method} ${path.split('?')[0]}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });
    } catch {
      /* audit hech qachon throw qilmaydi */
    }
  });
});
