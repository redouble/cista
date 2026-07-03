import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { dbGet } from '../db/index.js';

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  displayName: string;
  locale: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    if (req.headers.accept?.includes('text/html')) {
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as any;
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      displayName: decoded.displayName || '',
      locale: decoded.locale || 'zh',
    };
    next();
  } catch {
    if (req.headers.accept?.includes('text/html')) {
      res.clearCookie('token');
      return res.redirect('/login');
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as any;
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        displayName: decoded.displayName || '',
        locale: decoded.locale || 'zh',
      };
    } catch {
      // Token invalid
    }
  }
  next();
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function hasKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = dbGet('SELECT id FROM user_keys WHERE user_id = ?', [req.user!.id]);
  if (!key) {
    if (req.headers.accept?.includes('text/html')) {
      return res.redirect('/keys/generate');
    }
    return res.status(400).json({ error: 'No public key found. Please generate or upload a key first.' });
  }
  next();
}
