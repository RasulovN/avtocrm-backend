import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

// rest_framework_simplejwt token tuzilishini takrorlaydi:
//   HS256, SIGNING_KEY = SECRET_KEY, USER_ID_CLAIM = "user_id",
//   token_type ("access"/"refresh"), jti claim.

export interface AccessPayload {
  token_type: 'access';
  user_id: number;
  jti: string;
}

export interface RefreshPayload {
  token_type: 'refresh';
  user_id: number;
  jti: string;
}

export function createTokens(userId: number): { access: string; refresh: string } {
  const access = jwt.sign(
    { token_type: 'access', user_id: userId, jti: randomUUID() } satisfies AccessPayload,
    env.SECRET_KEY,
    { algorithm: 'HS256', expiresIn: env.ACCESS_TOKEN_TTL },
  );
  const refresh = jwt.sign(
    { token_type: 'refresh', user_id: userId, jti: randomUUID() } satisfies RefreshPayload,
    env.SECRET_KEY,
    { algorithm: 'HS256', expiresIn: env.REFRESH_TOKEN_TTL },
  );
  return { access, refresh };
}

export function verifyAccess(token: string): AccessPayload {
  const decoded = jwt.verify(token, env.SECRET_KEY, { algorithms: ['HS256'] }) as AccessPayload;
  if (decoded.token_type !== 'access') {
    throw new Error('Token has wrong type');
  }
  return decoded;
}

export function verifyRefresh(token: string): RefreshPayload {
  const decoded = jwt.verify(token, env.SECRET_KEY, { algorithms: ['HS256'] }) as RefreshPayload;
  if (decoded.token_type !== 'refresh') {
    throw new Error('Token has wrong type');
  }
  return decoded;
}

export function accessFromRefresh(refreshToken: string): string {
  const payload = verifyRefresh(refreshToken);
  return jwt.sign(
    { token_type: 'access', user_id: payload.user_id, jti: randomUUID() } satisfies AccessPayload,
    env.SECRET_KEY,
    { algorithm: 'HS256', expiresIn: env.ACCESS_TOKEN_TTL },
  );
}
