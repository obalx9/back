import jwt from 'jsonwebtoken';
import { logger } from './logger';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface JWTPayload {
  sub: string;
  userId?: string;
  telegramId?: number;
  email?: string;
  roles?: string[];
  isAdmin?: boolean;
  isSeller?: boolean;
  sellerId?: string;
}

export function generateToken(payload: Record<string, any> & { userId: string }): string {
  const tokenPayload: Record<string, any> = {
    ...payload,
    sub: payload.userId,
  };
  return jwt.sign(tokenPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    logger.error('JWT verification failed', error);
    return null;
  }
}

export function decodeToken(token: string): JWTPayload | null {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch (error) {
    return null;
  }
}
