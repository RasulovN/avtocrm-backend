import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { join } from 'node:path';
import { env, isDev } from './config/env.js';
import { authPlugin } from './plugins/auth.js';
import { auditPlugin } from './plugins/audit.js';
import { errorHandler } from './plugins/errorHandler.js';
import { registerRoutes } from './features/index.js';
import { paymeWebhookRoutes } from './features/payments/payments.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isDev
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : true,
    bodyLimit: 20 * 1024 * 1024,
    // Django trailing-slash URL'lari bilan moslik uchun
    routerOptions: { ignoreTrailingSlash: true },
    // nginx reverse-proxy orqasida real mijoz IP'si X-Forwarded-For'dan olinadi
    // (Payme IP whitelist uchun zarur). Backend faqat 127.0.0.1'da, nginx ishonchli.
    trustProxy: true,
  });

  // CORS xavfsizligi: PRODUCTION'da `*` (barcha origin) bilan `credentials:true`
  // KOMBINATSIYASI xavfli (CSRF/cookie o'g'irlash), shuning uchun taqiqlanadi —
  // aniq frontend domen(lar)ini berish shart.
  // DEVELOPMENT'da qulaylik uchun so'rov origin'i aks ettiriladi va credentials
  // yoqiladi (localhost:5173, LAN qurilmalari va h.k.).
  const allowAllOrigins = env.CORS_ORIGIN === '*';
  if (allowAllOrigins && !isDev) {
    app.log.warn(
      'CORS_ORIGIN="*" production uchun xavfli va credentials o\'chirildi. ' +
        'Aniq frontend domen(lar)ini bering (masalan CORS_ORIGIN=https://zumex.uz).',
    );
  }
  // Prod'da `*` bo'lsa credentials'ni o'chiramiz; dev'da yoki aniq domen berilganda yoqamiz.
  const corsCredentials = !allowAllOrigins || isDev;

  // Ruxsat etilgan origin'lar — bo'shliq va oxirgi `/` ga chidamli (mustahkam moslashuv).
  const normalizeOrigin = (o: string): string => o.trim().replace(/\/+$/, '').toLowerCase();
  const allowedOrigins = new Set(
    env.CORS_ORIGIN.split(',').map(normalizeOrigin).filter(Boolean),
  );

  await app.register(cors, {
    // Origin funksiyasi: normalizatsiya qilib solishtiramiz — `https://zumex.uz/`
    // (oxirida slash) yoki bo'shliqli konfiguratsiya ham to'g'ri ishlaydi.
    origin: allowAllOrigins
      ? true
      : (origin, cb) => {
          // Origin yo'q so'rovlar (server-to-server, curl, same-origin) — ruxsat.
          if (!origin) return cb(null, true);
          cb(null, allowedOrigins.has(normalizeOrigin(origin)));
        },
    credentials: corsCredentials,
    // @fastify/cors default methods 'GET,HEAD,POST' — PUT/PATCH/DELETE'ni qo'shamiz
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  // Media static (Django MEDIA_URL ekvivalenti)
  await app.register(fastifyStatic, {
    root: join(process.cwd(), env.MEDIA_ROOT),
    prefix: env.MEDIA_URL,
    decorateReply: false,
    // Brauzer kontent-turini "sniffing" qilib bajarmasligi uchun (XSS himoyasi).
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });

  // Swagger / OpenAPI — faqat development'da. Production'da barcha endpoint sxemasini
  // oshkor qilmaslik uchun yopiq (recon yuzasini kamaytiradi).
  if (isDev) {
    await app.register(swagger, {
      openapi: {
        info: { title: 'Auto CRM API', description: 'Auto CRM project', version: '1.0.0' },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
    });
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  }

  await app.register(errorHandler);
  await app.register(authPlugin);
  await app.register(auditPlugin);

  // Barcha modul route'lari /api ostida
  await app.register(registerRoutes, { prefix: '/api' });

  // Payme webhook — /api prefiksisiz, kabinetdagi manzilga mos (POST /payme/webhook)
  await app.register(paymeWebhookRoutes);

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
