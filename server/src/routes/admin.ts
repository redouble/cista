import { Router, Request, Response } from 'express';
import { dbRun, dbGet, dbAll } from '../db/index.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { getStorage } from '../storage/index.js';

export const adminRouter = Router();

adminRouter.use(authMiddleware, adminMiddleware);

// GET /api/admin/users
adminRouter.get('/users', (req: Request, res: Response) => {
  const rows = dbAll('SELECT id, email, display_name, role, is_active, locale, created_at FROM users ORDER BY created_at DESC');
  const users = rows.map((u: any) => ({
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    role: u.role,
    isActive: !!u.is_active,
    locale: u.locale,
    createdAt: u.created_at,
  }));
  res.json({ users });
});

// POST /api/admin/users/:id/toggle
adminRouter.post('/users/:id/toggle', (req: Request, res: Response) => {
  const user = dbGet('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.role === 'admin') {
    return res.status(400).json({ error: 'Cannot disable an admin account' });
  }

  dbRun('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?', [user.is_active ? 0 : 1, new Date().toISOString(), user.id]);

  res.json({ success: true, isActive: !user.is_active });
});

// DELETE /api/admin/users/:id
adminRouter.delete('/users/:id', async (req: Request, res: Response) => {
  const user = dbGet('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.role === 'admin') {
    return res.status(400).json({ error: 'Cannot delete an admin account' });
  }

  const userFiles = dbAll('SELECT storage_path FROM files WHERE user_id = ?', [user.id]);
  const storage = getStorage();
  for (const f of userFiles) {
    await storage.delete(f.storage_path);
  }

  dbRun('DELETE FROM users WHERE id = ?', [user.id]);
  res.json({ success: true });
});

// GET /api/admin/config
adminRouter.get('/config', (req: Request, res: Response) => {
  const configs = dbAll('SELECT * FROM system_config');
  const configMap: Record<string, string> = {};
  for (const c of configs) {
    configMap[c.key] = c.value;
  }
  res.json({ config: configMap });
});

// PUT /api/admin/config
adminRouter.put('/config', (req: Request, res: Response) => {
  const updates = req.body;
  const allowedKeys = ['max_file_size', 'share_code_length', 'share_code_expiry_days', 'share_code_max_downloads'];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedKeys.includes(key)) {
      const existing = dbGet('SELECT key FROM system_config WHERE key = ?', [key]);
      if (existing) {
        dbRun('UPDATE system_config SET value = ? WHERE key = ?', [String(value), key]);
      } else {
        dbRun('INSERT INTO system_config (key, value) VALUES (?, ?)', [key, String(value)]);
      }
    }
  }

  res.json({ success: true });
});

// GET /api/admin/stats
adminRouter.get('/stats', (req: Request, res: Response) => {
  const userCount = dbGet('SELECT COUNT(*) as count FROM users');
  const fileCount = dbGet('SELECT COUNT(*) as count FROM files');
  const shareCount = dbGet('SELECT COUNT(*) as count FROM share_codes');
  const totalSize = dbGet('SELECT COALESCE(SUM(size), 0) as total FROM files');

  res.json({
    stats: {
      totalUsers: userCount?.count || 0,
      totalFiles: fileCount?.count || 0,
      totalShares: shareCount?.count || 0,
      totalStorageBytes: totalSize?.total || 0,
    },
  });
});
