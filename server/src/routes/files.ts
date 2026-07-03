import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { dbRun, dbGet, dbAll } from '../db/index.js';
import { authMiddleware, hasKeyMiddleware } from '../middleware/auth.js';
import { getStorage } from '../storage/index.js';
import multer, { MulterError } from 'multer';

export const filesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.storage.maxFileSize },
});

// GET /api/files - List user's files
filesRouter.get('/', authMiddleware, (req: Request, res: Response) => {
  const userFiles = dbAll('SELECT id, name, description, size, mime_type, encrypted_key_algorithm, created_at FROM files WHERE user_id = ? ORDER BY created_at DESC', [req.user!.id]);

  const enriched = userFiles.map((f: any) => {
    const codes = dbAll('SELECT id, code, is_active FROM share_codes WHERE file_id = ?', [f.id]);
    const totalDownloads = codes.reduce((sum: number, c: any) => sum + (c.download_count || 0), 0);
    return {
      id: f.id,
      name: f.name,
      description: f.description,
      size: f.size,
      mimeType: f.mime_type,
      encryptedKeyAlgorithm: f.encrypted_key_algorithm,
      createdAt: f.created_at,
      shareCodes: codes,
      shareCount: codes.length,
      totalDownloads,
    };
  });

  res.json({ files: enriched });
});

// GET /api/files/:id - Get file details
filesRouter.get('/:id', authMiddleware, (req: Request, res: Response) => {
  const file = dbGet('SELECT * FROM files WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const codes = dbAll('SELECT * FROM share_codes WHERE file_id = ?', [file.id]);

  res.json({
    file: {
      ...file,
      mimeType: file.mime_type,
      storagePath: file.storage_path,
      encryptedKey: Buffer.from(file.encrypted_key).toString('base64'),
      encryptedKeyAlgorithm: file.encrypted_key_algorithm,
      fileHash: file.file_hash,
      shareCodes: codes,
    }
  });
});

// Multer error handling middleware (must be used on routes after upload.single)
function handleMulterError(err: any, _req: Request, res: Response, next: Function) {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File exceeds maximum allowed size' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  next(err);
}

// POST /api/files/upload - Upload encrypted file
filesRouter.post('/upload', authMiddleware, hasKeyMiddleware, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return handleMulterError(err, req, res, next);
    next();
  });
}, async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const encryptedData = req.file.buffer;
    const encryptedKey = req.body.encryptedKey;
    const encryptedKeyAlgorithm = req.body.encryptedKeyAlgorithm || 'rsa-4096';
    const description = req.body.description || '';
    const fileName = req.body.fileName || req.file.originalname;

    if (!encryptedKey) {
      return res.status(400).json({ error: 'Encrypted key is required' });
    }

    const encryptedKeyBuffer = Buffer.from(encryptedKey, 'base64');

    // Store the file
    const fileId = uuidv4();
    const storagePath = `${req.user!.id}/${fileId}_${fileName}`;

    const storage = getStorage();
    await storage.save(storagePath, encryptedData);

    const now = new Date().toISOString();

    dbRun(
      'INSERT INTO files (id, user_id, name, description, size, mime_type, storage_path, encrypted_key, encrypted_key_algorithm, file_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [fileId, req.user!.id, fileName, description, encryptedData.length, req.file.mimetype || 'application/octet-stream', storagePath, encryptedKeyBuffer, encryptedKeyAlgorithm, '', now, now]
    );

    res.json({ success: true, file: { id: fileId, name: fileName, size: encryptedData.length } });
  } catch (err: any) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/files/:id - Delete a file
filesRouter.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const file = dbGet('SELECT * FROM files WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
    if (!file) return res.status(404).json({ error: 'File not found' });

    const storage = getStorage();
    await storage.delete(file.storage_path);

    // Delete related share codes and file
    dbRun('DELETE FROM share_codes WHERE file_id = ?', [file.id]);
    dbRun('DELETE FROM files WHERE id = ?', [file.id]);

    res.json({ success: true });
  } catch (err) {
    console.error('Delete file error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/download/:id - Download a file
filesRouter.get('/download/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const file = dbGet('SELECT * FROM files WHERE id = ?', [req.params.id]);
    if (!file) return res.status(404).json({ error: 'File not found' });

    const storage = getStorage();
    const data = await storage.read(file.storage_path);

    res.json({
      file: {
        id: file.id,
        name: file.name,
        size: data.length,
        encryptedData: data.toString('base64'),
        encryptedKey: Buffer.from(file.encrypted_key).toString('base64'),
        encryptedKeyAlgorithm: file.encrypted_key_algorithm,
        mimeType: file.mime_type,
      },
    });
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
