import type { FastifyInstance } from 'fastify';
import { landingSettingsSchema } from './siteSettings.schemas.js';
import { getLandingSettings, updateLandingSettings } from './siteSettings.service.js';

export async function siteSettingsRoutes(app: FastifyInstance) {
  // ===================== PUBLIC (landing o'qiydi) =====================
  // GET /landing/public/ — aloqa + ijtimoiy tarmoqlar, autentifikatsiyasiz.
  app.get('/landing/public/', async () => {
    return getLandingSettings();
  });

  // ===================== Super admin =====================
  // GET /landing/ — joriy sozlamalar (forma to'ldirish uchun).
  app.get('/landing/', { onRequest: app.requirePermission('platform.settings.view') }, async () => {
    return getLandingSettings();
  });

  // PUT /landing/ — sozlamalarni yangilash.
  app.put('/landing/', { onRequest: app.requirePermission('platform.settings.manage') }, async (req) => {
    const body = landingSettingsSchema.parse(req.body);
    return updateLandingSettings(body);
  });
}
