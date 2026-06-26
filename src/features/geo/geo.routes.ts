import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { BadRequest } from '../../common/errors.js';
import {
  countryCreateSchema,
  countryUpdateSchema,
  districtCreateSchema,
  districtUpdateSchema,
  regionCreateSchema,
  regionUpdateSchema,
} from './geo.schemas.js';
import {
  listActiveCountries,
  listAllCountries,
  createCountry,
  updateCountry,
  deleteCountry,
  listActiveRegions,
  createRegion,
  updateRegion,
  deleteRegion,
  listActiveDistricts,
  createDistrict,
  updateDistrict,
  deleteDistrict,
} from './geo.service.js';

function idParam(req: FastifyRequest): number {
  return Number((req.params as { id: string }).id);
}

export async function geoRoutes(app: FastifyInstance) {
  // ============================================================
  //  PUBLIC RO'YXAT (onboarding'da manzil tanlash uchun — authenticate yetarli)
  // ============================================================

  // Faol davlatlar; super admin uchun ?all=true -> barchasi (nofaol ham)
  app.get('/countries/', { onRequest: app.authenticate }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const wantAll = q.all === 'true';
    if (wantAll && (req.authUser?.isSuperuser || req.permissions.has('platform.geo.view'))) {
      return listAllCountries();
    }
    return listActiveCountries();
  });

  // country_id bo'yicha faol viloyatlar
  app.get('/regions/', { onRequest: app.authenticate }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const countryId = Number(q.country_id);
    if (!Number.isInteger(countryId) || countryId <= 0) {
      throw new BadRequest({ detail: 'country_id query parametri talab qilinadi.' });
    }
    return listActiveRegions(countryId);
  });

  // region_id bo'yicha faol tumanlar
  app.get('/districts/', { onRequest: app.authenticate }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const regionId = Number(q.region_id);
    if (!Number.isInteger(regionId) || regionId <= 0) {
      throw new BadRequest({ detail: 'region_id query parametri talab qilinadi.' });
    }
    return listActiveDistricts(regionId);
  });

  // Yandex xarita kaliti (frontend xaritani yuklash uchun)
  app.get('/yandex-key/', { onRequest: app.authenticate }, async () => {
    return { api_key: env.YANDEX_MAPS_API_KEY };
  });

  // ============================================================
  //  SUPER ADMIN CRUD — Country (requirePermission('platform.geo.manage'))
  // ============================================================
  const geoManage = { onRequest: [app.authenticate, app.requirePermission('platform.geo.manage')] };

  app.post('/countries/', geoManage, async (req, reply) => {
    const body = countryCreateSchema.parse(req.body);
    return reply.status(201).send(await createCountry(body));
  });

  app.put('/countries/:id/', geoManage, async (req) => {
    const body = countryUpdateSchema.parse(req.body);
    return updateCountry(idParam(req), body);
  });

  app.delete('/countries/:id/', geoManage, async (req, reply) => {
    await deleteCountry(idParam(req));
    return reply.status(204).send();
  });

  // ── Region ──────────────────────────────────────────────
  app.post('/regions/', geoManage, async (req, reply) => {
    const body = regionCreateSchema.parse(req.body);
    return reply.status(201).send(await createRegion(body));
  });

  app.put('/regions/:id/', geoManage, async (req) => {
    const body = regionUpdateSchema.parse(req.body);
    return updateRegion(idParam(req), body);
  });

  app.delete('/regions/:id/', geoManage, async (req, reply) => {
    await deleteRegion(idParam(req));
    return reply.status(204).send();
  });

  // ── District ────────────────────────────────────────────
  app.post('/districts/', geoManage, async (req, reply) => {
    const body = districtCreateSchema.parse(req.body);
    return reply.status(201).send(await createDistrict(body));
  });

  app.put('/districts/:id/', geoManage, async (req) => {
    const body = districtUpdateSchema.parse(req.body);
    return updateDistrict(idParam(req), body);
  });

  app.delete('/districts/:id/', geoManage, async (req, reply) => {
    await deleteDistrict(idParam(req));
    return reply.status(204).send();
  });
}
