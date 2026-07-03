import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { dbRun, dbGet } from '../db/index.js';
import { authMiddleware } from '../middleware/auth.js';

export const keysRouter = Router();

const uploadKeySchema = z.object({
  publicKey: z.string().min(1, 'Public key is required'),
  algorithm: z.enum(['rsa-4096', 'ecc-x25519']),
});

// Compute fingerprint (SHA-256 hash of PEM, formatted)
function computeFingerprint(publicKeyPem: string): string {
  const hash = crypto.createHash('sha256').update(publicKeyPem).digest('hex').toUpperCase();
  const chars = hash.split('');
  const formatted: string[] = [];
  for (let i = 0; i < chars.length; i += 4) {
    formatted.push(chars.slice(i, i + 4).join(''));
  }
  return formatted.join(':');
}

// POST /api/keys/upload - Upload public key
keysRouter.post('/upload', authMiddleware, async (req: Request, res: Response) => {
  try {
    const data = uploadKeySchema.parse(req.body);

    // Validate PEM format
    if (!data.publicKey.includes('-----BEGIN') || !data.publicKey.includes('PUBLIC KEY-----')) {
      return res.status(400).json({ error: 'Invalid public key format. Please provide a valid PEM-encoded public key.' });
    }

    const fingerprint = computeFingerprint(data.publicKey);

    // Check if user already has a key - replace it
    const existingKey = dbGet('SELECT id FROM user_keys WHERE user_id = ?', [req.user!.id]);
    const now = new Date().toISOString();

    if (existingKey) {
      dbRun(
        'UPDATE user_keys SET public_key = ?, algorithm = ?, fingerprint = ?, updated_at = ? WHERE id = ?',
        [data.publicKey, data.algorithm, fingerprint, now, existingKey.id]
      );
      return res.json({ success: true, fingerprint, replaced: true });
    }

    // Insert new key
    dbRun(
      'INSERT INTO user_keys (id, user_id, public_key, algorithm, fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), req.user!.id, data.publicKey, data.algorithm, fingerprint, now, now]
    );

    res.json({ success: true, fingerprint, replaced: false });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message });
    }
    console.error('Upload key error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/keys/mine - Get current user's public key
keysRouter.get('/mine', authMiddleware, (req: Request, res: Response) => {
  const key = dbGet('SELECT * FROM user_keys WHERE user_id = ?', [req.user!.id]);
  if (!key) {
    return res.status(404).json({ error: 'No public key found' });
  }
  res.json({
    publicKey: key.public_key,
    algorithm: key.algorithm,
    fingerprint: key.fingerprint,
    createdAt: key.created_at,
  });
});

// GET /api/keys/by-email/:email - Lookup public key by email
keysRouter.get('/by-email/:email', authMiddleware, (req: Request, res: Response) => {
  const user = dbGet('SELECT id FROM users WHERE email = ?', [req.params.email.toLowerCase()]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const key = dbGet('SELECT * FROM user_keys WHERE user_id = ?', [user.id]);
  if (!key) {
    return res.json({ found: false, userId: user.id, email: req.params.email.toLowerCase() });
  }

  res.json({
    found: true,
    userId: user.id,
    email: req.params.email.toLowerCase(),
    publicKey: key.public_key,
    algorithm: key.algorithm,
    fingerprint: key.fingerprint,
  });
});

// POST /api/keys/verify-fingerprint - Verify a fingerprint matches a public key
keysRouter.post('/verify-fingerprint', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { publicKey, fingerprint } = req.body;
    if (!publicKey || !fingerprint) {
      return res.status(400).json({ error: 'Public key and fingerprint are required' });
    }
    const computed = computeFingerprint(publicKey);
    res.json({ match: computed === fingerprint, computedFingerprint: computed });
  } catch (err) {
    console.error('Verify fingerprint error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
