import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { dbRun, dbGet, dbAll } from '../db/index.js';
import { authMiddleware, optionalAuth } from '../middleware/auth.js';
import { getStorage } from '../storage/index.js';

export const sharesRouter = Router();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length: number): string {
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

function generateUniqueCode(length: number): string {
  let code: string;
  do {
    code = generateCode(length);
  } while (dbGet('SELECT id FROM share_codes WHERE code = ?', [code]));
  return code;
}

export async function generateShareCode(
  fileId: string,
  createdBy: string,
  _targetUserId: string,
  shareType: 'registered' | 'unregistered',
  options?: {
    encryptedDek?: Buffer;
    tempPrivateKeyEncrypted?: Buffer;
    expiresAt?: string;
    maxDownloads?: number;
  }
): Promise<string> {
  const configRow = dbGet('SELECT value FROM system_config WHERE key = ?', ['share_code_length']);
  const codeLength = configRow ? parseInt(configRow.value) : 8;
  const code = generateUniqueCode(codeLength);

  const file = dbGet('SELECT * FROM files WHERE id = ?', [fileId]);
  if (!file) throw new Error('File not found');

  const encryptedDek = options?.encryptedDek || file.encrypted_key;

  const expiryRow = dbGet('SELECT value FROM system_config WHERE key = ?', ['share_code_expiry_days']);
  const defaultExpiryDays = expiryRow ? parseInt(expiryRow.value) : 7;
  const expiresAt = options?.expiresAt
    ? options.expiresAt
    : new Date(Date.now() + defaultExpiryDays * 24 * 60 * 60 * 1000).toISOString();

  const downloadsRow = dbGet('SELECT value FROM system_config WHERE key = ?', ['share_code_max_downloads']);
  const defaultMaxDownloads = downloadsRow ? parseInt(downloadsRow.value) : 5;
  const maxDownloads = options?.maxDownloads || defaultMaxDownloads;

  dbRun(
    'INSERT INTO share_codes (id, file_id, code, created_by, share_type, target_email, encrypted_dek, temp_private_key_encrypted, expires_at, max_downloads, download_count, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)',
    [
      uuidv4(), fileId, code, createdBy, shareType, '',
      encryptedDek, options?.tempPrivateKeyEncrypted || Buffer.from(''),
      expiresAt, maxDownloads, new Date().toISOString()
    ]
  );

  return code;
}

// POST /api/shares/generate
sharesRouter.post('/generate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { fileId, shareType, targetEmail, encryptedDek, tempPrivateKeyEncrypted, expiresAt, maxDownloads } = req.body;

    if (!fileId || !shareType || !encryptedDek) {
      return res.status(400).json({ error: 'File ID, share type, and encrypted DEK are required' });
    }

    if (!['registered', 'unregistered'].includes(shareType)) {
      return res.status(400).json({ error: 'Invalid share type' });
    }

    const file = dbGet('SELECT * FROM files WHERE id = ? AND user_id = ?', [fileId, req.user!.id]);
    if (!file) return res.status(404).json({ error: 'File not found' });

    if (shareType === 'registered' && targetEmail) {
      const targetUser = dbGet('SELECT id FROM users WHERE email = ?', [targetEmail.toLowerCase()]);
      if (!targetUser) return res.status(404).json({ error: 'Target user not found' });

      const targetKey = dbGet('SELECT id FROM user_keys WHERE user_id = ?', [targetUser.id]);
      if (!targetKey) {
        return res.status(400).json({ error: 'Target user has not uploaded a public key yet' });
      }
    }

    const code = await generateShareCode(
      fileId, req.user!.id, '', shareType,
      {
        encryptedDek: Buffer.from(encryptedDek, 'base64'),
        tempPrivateKeyEncrypted: tempPrivateKeyEncrypted ? Buffer.from(tempPrivateKeyEncrypted, 'base64') : undefined,
        expiresAt,
        maxDownloads: maxDownloads ? parseInt(maxDownloads) : undefined,
      }
    );

    res.json({ success: true, code });
  } catch (err) {
    console.error('Generate share code error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/shares/mine
sharesRouter.get('/mine', authMiddleware, (req: Request, res: Response) => {
  const codes = dbAll(
    `SELECT sc.id, sc.code, sc.file_id, sc.share_type, sc.target_email,
            sc.expires_at, sc.max_downloads, sc.download_count, sc.is_active, sc.created_at,
            f.name as file_name
     FROM share_codes sc
     LEFT JOIN files f ON sc.file_id = f.id
     WHERE sc.created_by = ?
     ORDER BY sc.created_at DESC`,
    [req.user!.id]
  );

  res.json({ codes });
});

// POST /api/shares/redeem
sharesRouter.post('/redeem', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Share code is required' });

    const share = dbGet('SELECT * FROM share_codes WHERE code = ?', [code.toUpperCase()]);
    if (!share) return res.status(404).json({ error: 'Invalid share code' });

    if (!share.is_active) return res.status(400).json({ error: 'Share code has been revoked' });

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      dbRun('UPDATE share_codes SET is_active = 0 WHERE id = ?', [share.id]);
      return res.status(400).json({ error: 'Share code has expired' });
    }

    if (share.download_count >= share.max_downloads) {
      return res.status(400).json({ error: 'Share code has reached maximum download count' });
    }

    // Type-specific auth check: registered shares require login
    if (share.share_type === 'registered' && !req.user) {
      return res.status(401).json({ error: 'Please log in to redeem this share code' });
    }

    const file = dbGet('SELECT * FROM files WHERE id = ?', [share.file_id]);
    if (!file) return res.status(404).json({ error: 'File not found' });

    dbRun('UPDATE share_codes SET download_count = download_count + 1 WHERE id = ?', [share.id]);

    const storage = getStorage();
    const data = await storage.read(file.storage_path);

    res.json({
      success: true,
      file: {
        id: file.id,
        name: file.name,
        size: data.length,
        encryptedData: data.toString('base64'),
        encryptedKey: Buffer.from(share.encrypted_dek).toString('base64'),
        encryptedKeyAlgorithm: file.encrypted_key_algorithm,
        mimeType: file.mime_type,
        shareType: share.share_type,
        tempPrivateKeyEncrypted: share.temp_private_key_encrypted ? Buffer.from(share.temp_private_key_encrypted).toString('base64') : '',
      },
    });
  } catch (err) {
    console.error('Redeem share code error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/shares/:id
sharesRouter.delete('/:id', authMiddleware, (req: Request, res: Response) => {
  const share = dbGet('SELECT id FROM share_codes WHERE id = ? AND created_by = ?', [req.params.id, req.user!.id]);
  if (!share) return res.status(404).json({ error: 'Share code not found' });

  dbRun('UPDATE share_codes SET is_active = 0 WHERE id = ?', [share.id]);
  res.json({ success: true });
});

// GET /api/shares/verify/:code
sharesRouter.get('/verify/:code', (req: Request, res: Response) => {
  const share = dbGet('SELECT * FROM share_codes WHERE code = ?', [req.params.code.toUpperCase()]);

  if (!share) return res.json({ valid: false, reason: 'Code not found' });
  if (!share.is_active) return res.json({ valid: false, reason: 'Code has been revoked' });
  if (share.expires_at && new Date(share.expires_at) < new Date()) return res.json({ valid: false, reason: 'Code has expired' });
  if (share.download_count >= share.max_downloads) return res.json({ valid: false, reason: 'Download limit reached' });

  const file = dbGet('SELECT name, size FROM files WHERE id = ?', [share.file_id]);

  res.json({
    valid: true,
    fileName: file?.name || 'Unknown',
    fileSize: file?.size || 0,
    shareType: share.share_type,
  });
});
