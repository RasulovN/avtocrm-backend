import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { ApiError } from '../common/errors.js';
import { notifyServerError } from '../common/telegramAlert.js';

export const errorHandler = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error, req, reply) => {
    // Bizning API xatoliklarimiz
    if (error instanceof ApiError) {
      if (error.statusCode >= 500) {
        notifyServerError({
          statusCode: error.statusCode,
          method: req.method,
          url: req.url,
          reqId: String(req.id),
          userId: req.authUser?.id ?? null,
          errorName: error.name,
          message: error.message,
          stack: error.stack,
        });
      }
      return reply.status(error.statusCode).send(error.payload);
    }

    // Zod validatsiya xatoliklari -> DRF uslubidagi {field: [messages]}
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const key = issue.path.length ? issue.path.join('.') : 'non_field_errors';
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return reply.status(400).send(fieldErrors);
    }

    // Prisma noyob cheklov buzilishi
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
        return reply.status(400).send({ detail: `${target} allaqachon mavjud.` });
      }
      if (error.code === 'P2025') {
        return reply.status(404).send({ detail: 'Not found.' });
      }
      if (error.code === 'P2003') {
        return reply.status(400).send({ detail: 'Bog\'liq yozuv mavjudligi sababli amal bajarilmadi.' });
      }
    }

    // Fastify validatsiya (schema) xatoliklari
    const err = error as { validation?: unknown; message?: string };
    if (err.validation) {
      return reply.status(400).send({ detail: err.message ?? 'Validation error' });
    }

    req.log.error(error);
    // Telegram'ga 5xx alert (fire-and-forget, so'rovni sekinlashtirmaydi)
    notifyServerError({
      statusCode: 500,
      method: req.method,
      url: req.url,
      reqId: String(req.id),
      userId: req.authUser?.id ?? null,
      errorName: (error as Error).name,
      message: (error as Error).message ?? String(error),
      stack: (error as Error).stack,
    });
    return reply.status(500).send({ detail: 'Internal server error' });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ detail: 'Not found.' });
  });
});
