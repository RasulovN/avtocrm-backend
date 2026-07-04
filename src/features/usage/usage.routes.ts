import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parseRange, getUsageOverview, getUsageByCompany, getCompanyUsage } from './usage.service.js';

// Foydalanish tahlili — faqat super admin. Mijoz kompaniyalarining tizimdan
// foydalanish darajasi (kirishlar, amallar, faollik) va churn xavfi.
export async function usageRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireSuperuser] };
  const query = (req: FastifyRequest) => req.query as Record<string, string | undefined>;

  // Umumiy KPI + kunlik seriya (?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD, default: 7 kun)
  app.get('/overview/', guard, async (req) => getUsageOverview(parseRange(query(req))));

  // Kompaniyalar kesimi: engagement score, trend, churn xavfi
  app.get('/companies/', guard, async (req) => getUsageByCompany(parseRange(query(req))));

  // Bitta kompaniya: kunlik seriya, top foydalanuvchilar, modul kesimi
  app.get('/companies/:id/', guard, async (req) => {
    const id = Number((req.params as { id: string }).id);
    return getCompanyUsage(id, parseRange(query(req)));
  });
}
