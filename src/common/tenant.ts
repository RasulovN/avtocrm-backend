import type { FastifyRequest } from 'fastify';
import { Forbidden } from './errors.js';

// Autentifikatsiya qilingan foydalanuvchining companyId sini qaytaradi.
// CRM endpointlari shu orqali tenant bo'yicha filtrlanadi.
export function getCompanyId(req: FastifyRequest): number {
  if (!req.companyId) {
    throw new Forbidden({ detail: 'Siz hech qaysi kompaniyaga biriktirilmagansiz.' });
  }
  return req.companyId;
}
