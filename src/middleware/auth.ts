import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';

export interface AuthRequest extends Request {
  userId?: string;
  user?: {
    id: string;
    email?: string;
    roles?: string[];
  };
  file?: Express.Multer.File;
}

export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = await verifyToken(token);

    if (!decoded || !decoded.sub) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.userId = decoded.sub;
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      roles: decoded.roles || []
    };

    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

export const optionalAuthMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = await verifyToken(token);

      if (decoded && decoded.sub) {
        req.userId = decoded.sub;
        req.user = {
          id: decoded.sub,
          email: decoded.email,
          roles: decoded.roles || []
        };
      }
    }

    next();
  } catch {
    next();
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.roles) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const hasRole = roles.some(role => req.user!.roles!.includes(role));
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};
