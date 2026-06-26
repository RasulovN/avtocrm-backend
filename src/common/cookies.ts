import type { FastifyReply } from 'fastify';

// Django login view bilan bir xil cookie sozlamalari.
export function setAuthCookies(reply: FastifyReply, access: string, refresh: string): void {
  reply.setCookie('access_token', access, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 60 * 60, // 1 soat
  });
  reply.setCookie('refresh_token', refresh, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 kun
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie('access_token', { path: '/' });
  reply.clearCookie('refresh_token', { path: '/' });
}
