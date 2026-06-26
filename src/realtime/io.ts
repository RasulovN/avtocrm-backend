import { Server as IOServer, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { verifyAccess } from '../common/jwt.js';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';

// ──────────────────────────────────────────────────────────────
// Realtime (socket.io) — bildirishnomalarni jonli yetkazish.
// Har bir ulangan foydalanuvchi `user:<id>` xonasiga qo'shiladi;
// kompaniya a'zolari `company:<id>` xonasiga, super adminlar `superadmins`ga.
// JWT (cookie `access_token` yoki handshake.auth.token) orqali autentifikatsiya.
// ──────────────────────────────────────────────────────────────

let io: IOServer | null = null;

function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const part = cookieHeader
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

function extractSocketToken(socket: Socket): string | null {
  // 1) socket.io-client `auth: { token }` (mobil / Bearer)
  const authToken = (socket.handshake.auth as { token?: string } | undefined)?.token;
  if (authToken) return authToken.startsWith('Bearer ') ? authToken.slice(7) : authToken;
  // 2) cookie `access_token` (web, withCredentials)
  const cookieToken = parseCookie(socket.handshake.headers.cookie, 'access_token');
  if (cookieToken) return cookieToken;
  // 3) ?token= query
  const queryToken = (socket.handshake.query as { token?: string } | undefined)?.token;
  return queryToken ?? null;
}

export function initRealtime(httpServer: HttpServer): IOServer {
  io = new IOServer(httpServer, {
    path: '/socket.io',
    cors: {
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = extractSocketToken(socket);
      if (!token) return next(new Error('unauthorized'));
      const { user_id } = verifyAccess(token);
      const user = await prisma.user.findUnique({
        where: { id: user_id },
        select: { id: true, companyId: true, isSuperuser: true, isActive: true },
      });
      if (!user || !user.isActive) return next(new Error('unauthorized'));
      socket.data.userId = user.id;
      socket.data.companyId = user.companyId;
      socket.data.isSuperuser = user.isSuperuser;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as number;
    const companyId = socket.data.companyId as number | null;
    const isSuperuser = socket.data.isSuperuser as boolean;

    socket.join(`user:${userId}`);
    if (companyId) socket.join(`company:${companyId}`);
    if (isSuperuser) socket.join('superadmins');
  });

  return io;
}

export function getIo(): IOServer | null {
  return io;
}

// Berilgan foydalanuvchilarga event yuboradi (ularning `user:<id>` xonalariga).
export function emitToUsers(userIds: number[], event: string, payload: unknown): void {
  if (!io || userIds.length === 0) return;
  const unique = [...new Set(userIds)];
  for (const id of unique) {
    io.to(`user:${id}`).emit(event, payload);
  }
}
