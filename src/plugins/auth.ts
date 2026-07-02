import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Company, Store, StoreUser, User } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { verifyAccess } from '../common/jwt.js';
import { isTokenRevoked } from '../common/tokenBlacklist.js';
import { Forbidden, Unauthorized } from '../common/errors.js';
import { PERMISSIONS, ALWAYS_AVAILABLE_CODES } from '../features/rbac/permissions.catalog.js';

const ALL_PERMISSION_CODES = PERMISSIONS.map((p) => p.code);

declare module 'fastify' {
  interface FastifyRequest {
    authUser: User | null;
    companyId: number | null;
    company: Company | null;
    permissions: Set<string>;
    subscriptionActive: boolean;
    // Kompaniya administrator tomonidan nofaollashtirilgan (isActive=false) — tizimga kirish taqiqlanadi.
    companyDisabled: boolean;
    store: Store | null;
    storeUser: StoreUser | null;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSuperuser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireEmailVerified: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireCompany: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireActiveSubscription: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    // RBAC ruxsat tekshiruvi (obuna gating bilan)
    requirePermission: (code: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    // CRM (eski)
    requireStore: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSeller: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function extractToken(req: FastifyRequest): string | null {
  const cookieToken = (req.cookies as Record<string, string | undefined>)?.access_token;
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

function computeSubscriptionActive(
  company: { subscriptions: { status: string; endAt: Date | null }[] } | null,
): boolean {
  if (!company) return false;
  const now = Date.now();
  return company.subscriptions.some(
    (s) => s.status === 'active' && (!s.endAt || s.endAt.getTime() > now),
  );
}

async function resolveContext(req: FastifyRequest): Promise<void> {
  req.authUser = null;
  req.companyId = null;
  req.company = null;
  req.permissions = new Set();
  req.subscriptionActive = false;
  req.companyDisabled = false;
  req.store = null;
  req.storeUser = null;

  const token = extractToken(req);
  if (!token) return;

  let userId: number;
  try {
    const payload = verifyAccess(token);
    // Logout qilingan (bekor qilingan) token — kontekst tiklanmaydi.
    if (isTokenRevoked(payload.jti)) return;
    userId = payload.user_id;
  } catch {
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      company: { include: { subscriptions: { where: { status: 'active' } } } },
    },
  });
  if (!user || !user.isActive) return;

  const { role, company, ...plainUser } = user;
  req.authUser = plainUser as User;
  req.companyId = user.companyId;
  req.company = (company as Company) ?? null;
  // Kompaniya admin tomonidan nofaollashtirilgan bo'lsa — kirish taqiqlanadi (guardlarda 403).
  req.companyDisabled = !!(company && company.isActive === false);

  // Ruxsatlar to'plami
  if (user.isSuperuser) {
    req.permissions = new Set(ALL_PERMISSION_CODES);
    req.subscriptionActive = true; // super admin uchun gating yo'q
  } else {
    req.permissions = new Set(role?.permissions.map((rp) => rp.permission.code) ?? []);
    req.subscriptionActive = computeSubscriptionActive(company);
  }

  // CRM store-context (X-Store-ID)
  const storeId = req.headers['x-store-id'];
  if (storeId) {
    const storeUser = await prisma.storeUser.findFirst({
      where: { userId: user.id, storeId: Number(storeId), isActive: true },
      include: { store: true },
    });
    if (storeUser) {
      req.storeUser = storeUser;
      req.store = storeUser.store;
    }
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('authUser', null);
  app.decorateRequest('companyId', null);
  app.decorateRequest('company', null);
  app.decorateRequest('permissions', null as unknown as Set<string>);
  app.decorateRequest('subscriptionActive', false);
  app.decorateRequest('companyDisabled', false);
  app.decorateRequest('store', null);
  app.decorateRequest('storeUser', null);

  app.addHook('onRequest', resolveContext);

  // Kompaniya nofaollashtirilgan foydalanuvchiga aniq xabar (barcha guardlar shundan foydalanadi).
  const COMPANY_DISABLED = {
    detail: 'Sizning tizimingiz administrator tomonidan faolsizlantirilgan. Iltimos, qo\'llab-quvvatlash bilan bog\'laning.',
    code: 'company_disabled',
  };

  app.decorate('authenticate', async (req: FastifyRequest) => {
    if (req.companyDisabled) throw new Forbidden(COMPANY_DISABLED);
    if (!req.authUser) throw new Unauthorized();
  });

  app.decorate('requireSuperuser', async (req: FastifyRequest) => {
    if (!req.authUser) throw new Unauthorized();
    if (!req.authUser.isSuperuser) throw new Forbidden();
  });

  app.decorate('requireEmailVerified', async (req: FastifyRequest) => {
    if (!req.authUser) throw new Unauthorized();
    if (!req.authUser.isEmailVerified && !req.authUser.isSuperuser) {
      throw new Forbidden({ detail: 'Email tasdiqlanmagan.' });
    }
  });

  app.decorate('requireCompany', async (req: FastifyRequest) => {
    if (req.companyDisabled) throw new Forbidden(COMPANY_DISABLED);
    if (!req.authUser) throw new Unauthorized();
    if (!req.companyId) throw new Forbidden({ detail: 'Siz hech qaysi kompaniyaga biriktirilmagansiz.' });
  });

  app.decorate('requireActiveSubscription', async (req: FastifyRequest) => {
    if (!req.authUser) throw new Unauthorized();
    if (!req.subscriptionActive) {
      throw new Forbidden({ detail: 'Obuna faol emas. Iltimos, obunani faollashtiring.' });
    }
  });

  app.decorate('requirePermission', (code: string) => {
    return async (req: FastifyRequest) => {
      if (req.companyDisabled) throw new Forbidden(COMPANY_DISABLED);
      if (!req.authUser) throw new Unauthorized();
      if (req.authUser.isSuperuser) return; // super admin -> hammasi ochiq
      if (!req.permissions.has(code)) {
        throw new Forbidden({ detail: 'Sizda bu amal uchun ruxsat yo\'q.' });
      }
      // Obuna gating FAQAT kompaniya (company.*) imkoniyatlariga tegishli.
      // Platform (super admin panel) ruxsatlari — `platform.*` — obuna talab qilmaydi,
      // chunki platform adminlarda obuna/kompaniya bo'lmaydi.
      if (
        code.startsWith('company.') &&
        !ALWAYS_AVAILABLE_CODES.has(code) &&
        !req.subscriptionActive
      ) {
        // `code: 'subscription_inactive'` — frontend menyularni bloklab, /subscription'ga yo'naltiradi.
        throw new Forbidden({
          detail: 'Obuna faol emas. Iltimos, obunani faollashtiring.',
          code: 'subscription_inactive',
        });
      }
    };
  });

  app.decorate('requireStore', async (req: FastifyRequest) => {
    if (!req.authUser) throw new Unauthorized();
    if (!req.storeUser) throw new Forbidden({ detail: 'X-Store-ID header orqali do\'kon tanlanmagan.' });
  });

  app.decorate('requireSeller', async (req: FastifyRequest) => {
    if (!req.authUser) throw new Unauthorized();
    if (!req.storeUser || !['m', 's'].includes(req.storeUser.role)) throw new Forbidden();
  });
});
