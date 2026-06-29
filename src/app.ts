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

  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    credentials: true,
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
  });

  // Swagger / OpenAPI
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
