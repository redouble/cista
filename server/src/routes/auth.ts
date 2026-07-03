import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { dbRun, dbGet, dbAll } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(config.password.minLength, `Password must be at least ${config.password.minLength} characters`),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/auth/register
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const data = registerSchema.parse(req.body);
    const email = data.email.toLowerCase();

    // Check if email already exists
    const existing = dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(400).json({ error: 'This email is already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, config.password.bcryptRounds);

    const now = new Date().toISOString();
    const userId = uuidv4();

    dbRun(
      'INSERT INTO users (id, email, password_hash, display_name, role, is_active, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, email, passwordHash, '', 'user', 1, req.cookies?.locale || 'zh', now, now]
    );

    // Generate JWT
    const token = jwt.sign(
      { id: userId, email, role: 'user', displayName: '', locale: req.cookies?.locale || 'zh' },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ success: true, user: { id: userId, email, role: 'user' } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
authRouter.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const data = loginSchema.parse(req.body);
    const email = data.email.toLowerCase();

    const user = dbGet('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is disabled' });
    }

    const valid = await bcrypt.compare(data.password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, displayName: user.display_name, locale: user.locale },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ success: true, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
authRouter.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// GET /api/auth/me
authRouter.get('/me', authMiddleware, (req: Request, res: Response) => {
  res.json({
    user: {
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role,
      displayName: req.user!.displayName,
      locale: req.user!.locale,
    },
  });
});

// POST /api/auth/change-password
authRouter.post('/change-password', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < config.password.minLength) {
      return res.status(400).json({ error: `Password must be at least ${config.password.minLength} characters` });
    }

    const user = dbGet('SELECT * FROM users WHERE id = ?', [req.user!.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const passwordHash = await bcrypt.hash(newPassword, config.password.bcryptRounds);
    dbRun('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, new Date().toISOString(), user.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/forgot-password
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = dbGet('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);

    if (user) {
      const token = uuidv4();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      dbRun(
        'INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), user.id, token, expiresAt, new Date().toISOString()]
      );

      const resetLink = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
      console.log(`Password reset link: ${resetLink}`);
    }

    res.json({ success: true, message: 'If the email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/reset-password
authRouter.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });

    if (password.length < config.password.minLength) {
      return res.status(400).json({ error: `Password must be at least ${config.password.minLength} characters` });
    }

    const resetToken = dbGet('SELECT * FROM password_reset_tokens WHERE token = ?', [token]);
    if (!resetToken) return res.status(400).json({ error: 'Invalid or expired reset token' });

    if (new Date(resetToken.expires_at) < new Date()) {
      dbRun('DELETE FROM password_reset_tokens WHERE id = ?', [resetToken.id]);
      return res.status(400).json({ error: 'Reset token has expired' });
    }

    const passwordHash = await bcrypt.hash(password, config.password.bcryptRounds);
    dbRun('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, new Date().toISOString(), resetToken.user_id]);
    dbRun('DELETE FROM password_reset_tokens WHERE id = ?', [resetToken.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/auth/account
authRouter.delete('/account', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required to delete account' });

    const user = dbGet('SELECT * FROM users WHERE id = ?', [req.user!.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Password is incorrect' });

    dbRun('DELETE FROM users WHERE id = ?', [user.id]);
    res.clearCookie('token');
    res.json({ success: true });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
