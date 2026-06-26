import { PrismaClient } from '@prisma/client';
import { isDev } from '../config/env.js';

export const prisma = new PrismaClient({
  log: isDev ? ['warn', 'error'] : ['error'],
});

export type Prisma = typeof prisma;
