import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { dbRun, dbGet, dbAll } from '../db/index.js';
import { authMiddleware, optionalAuth } from '../middleware/auth.js';
import { getTranslations } from '../i18n/index.js';
import { config } from '../config.js';

const APP_VERSION = '0.1.0-alpha';

export const pagesRouter = Router();

function getLocale(req: Request): string {
  return req.user?.locale || req.cookies?.locale || (req.headers['accept-language']?.startsWith('en') ? 'en' : 'zh');
}

function renderWithI18n(res: Response, view: string, options: Record<string, any> = {}) {
  const locale = options.locale || 'zh';
  res.render(view, {
    ...options,
    t: (key: string) => getTranslations(locale)[key] || key,
    locale,
    appVersion: APP_VERSION,
  });
}

// GET /
pagesRouter.get('/', optionalAuth, (req: Request, res: Response) => {
  const locale = getLocale(req);
  if (req.user) return res.redirect('/dashboard');
  renderWithI18n(res, 'index', { locale, user: req.user });
});

// GET /dashboard
pagesRouter.get('/dashboard', authMiddleware, (req: Request, res: Response) => {
  const locale = getLocale(req);
  const key = dbGet('SELECT fingerprint, algorithm FROM user_keys WHERE user_id = ?', [req.user!.id]);

  renderWithI18n(res, 'dashboard', {
    locale,
    user: req.user,
    hasKey: !!key,
    keyInfo: key ? { fingerprint: key.fingerprint, algorithm: key.algorithm } : null,
  });
});

// GET /login
pagesRouter.get('/login', optionalAuth, (req: Request, res: Response) => {
  if (req.user) return res.redirect('/dashboard');
  renderWithI18n(res, 'login', { locale: getLocale(req), user: req.user });
});

// GET /register
pagesRouter.get('/register', optionalAuth, (req: Request, res: Response) => {
  if (req.user) return res.redirect('/dashboard');
  renderWithI18n(res, 'register', { locale: getLocale(req), user: req.user });
});

// GET /forgot-password
pagesRouter.get('/forgot-password', optionalAuth, (req: Request, res: Response) => {
  renderWithI18n(res, 'forgot-password', { locale: getLocale(req), user: req.user });
});

// GET /reset-password
pagesRouter.get('/reset-password', optionalAuth, (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) return res.redirect('/forgot-password');
  renderWithI18n(res, 'reset-password', { locale: getLocale(req), user: req.user, token });
});

// GET /keys/generate
pagesRouter.get('/keys/generate', authMiddleware, (req: Request, res: Response) => {
  const locale = getLocale(req);
  const key = dbGet('SELECT fingerprint, algorithm FROM user_keys WHERE user_id = ?', [req.user!.id]);
  renderWithI18n(res, 'keys-generate', { locale, user: req.user, existingKey: key || null });
});

// GET /keys/upload
pagesRouter.get('/keys/upload', authMiddleware, (req: Request, res: Response) => {
  renderWithI18n(res, 'keys-upload', { locale: getLocale(req), user: req.user });
});

// GET /files
pagesRouter.get('/files', authMiddleware, (req: Request, res: Response) => {
  renderWithI18n(res, 'files', { locale: getLocale(req), user: req.user });
});

// GET /files/upload
pagesRouter.get('/files/upload', authMiddleware, (req: Request, res: Response) => {
  const locale = getLocale(req);
  renderWithI18n(res, 'files-upload', { locale, user: req.user });
});

// GET /files/:id
pagesRouter.get('/files/:id', authMiddleware, (req: Request, res: Response) => {
  const locale = getLocale(req);
  const file = dbGet('SELECT * FROM files WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  if (!file) return res.redirect('/files');

  const codes = dbAll('SELECT * FROM share_codes WHERE file_id = ?', [file.id]);
  renderWithI18n(res, 'file-detail', { locale, user: req.user, file, shareCodes: codes });
});

// GET /shares
pagesRouter.get('/shares', authMiddleware, (req: Request, res: Response) => {
  renderWithI18n(res, 'shares', { locale: getLocale(req), user: req.user });
});

// GET /shares/redeem
pagesRouter.get('/shares/redeem', optionalAuth, (req: Request, res: Response) => {
  renderWithI18n(res, 'shares-redeem', { locale: getLocale(req), user: req.user });
});

// GET /profile
pagesRouter.get('/profile', authMiddleware, (req: Request, res: Response) => {
  const locale = getLocale(req);
  const key = dbGet('SELECT fingerprint, algorithm FROM user_keys WHERE user_id = ?', [req.user!.id]);
  renderWithI18n(res, 'profile', { locale, user: req.user, keyInfo: key || null });
});

// GET /admin
pagesRouter.get('/admin', authMiddleware, (req: Request, res: Response) => {
  if (req.user?.role !== 'admin') return res.redirect('/dashboard');
  renderWithI18n(res, 'admin', { locale: getLocale(req), user: req.user });
});

// GET /test
pagesRouter.get('/test', optionalAuth, (req: Request, res: Response) => {
  renderWithI18n(res, 'test', { locale: getLocale(req), user: req.user });
});

// POST /api/locale
pagesRouter.post('/api/locale', optionalAuth, (req: Request, res: Response) => {
  const { locale } = req.body;
  if (locale && ['zh', 'en'].includes(locale)) {
    res.cookie('locale', locale, { maxAge: 365 * 24 * 60 * 60 * 1000 });

    // If user is authenticated, also update DB locale and re-issue JWT
    if (req.user) {
      const now = new Date().toISOString();
      dbRun('UPDATE users SET locale = ?, updated_at = ? WHERE id = ?', [locale, now, req.user.id]);

      const { sign } = jwt;
      const newToken = sign(
        { id: req.user.id, email: req.user.email, role: req.user.role, displayName: req.user.displayName, locale },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );

      res.cookie('token', newToken, {
        httpOnly: true,
        secure: config.nodeEnv === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }
  }
  res.json({ success: true });
});
