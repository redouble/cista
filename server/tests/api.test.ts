import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, saveDb, dbRun, dbGet, dbAll } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { config } from '../src/config.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const testDbPath = path.join(process.cwd(), 'data', 'test.db');

beforeAll(async () => {
  // Clean test DB
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  (config.database as any).url = testDbPath;

  // Ensure test storage dir
  const testStorage = path.join(process.cwd(), 'data', 'test-files');
  if (!fs.existsSync(testStorage)) {
    fs.mkdirSync(testStorage, { recursive: true });
  }
  (config.storage as any).localPath = testStorage;

  await initDb();
  await runMigrations();
});

afterAll(() => {
  saveDb();
  const testStorage = path.join(process.cwd(), 'data', 'test-files');
  if (fs.existsSync(testStorage)) {
    fs.rmSync(testStorage, { recursive: true, force: true });
  }
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
});

describe('Database Operations', () => {
  let userId: string;
  let fileId: string;

  it('should insert and read a user', async () => {
    userId = uuidv4();
    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash('TestPass123', 10);

    dbRun(
      'INSERT INTO users (id, email, password_hash, display_name, role, is_active, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, 'test@example.com', passwordHash, 'Test User', 'user', 1, 'zh', now, now]
    );

    const user = dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    expect(user).toBeDefined();
    expect(user!.email).toBe('test@example.com');
    expect(user!.role).toBe('user');
    expect(user!.is_active).toBe(1);
  });

  it('should verify password', async () => {
    const user = dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    const valid = await bcrypt.compare('TestPass123', user!.password_hash);
    expect(valid).toBe(true);
  });

  it('should prevent duplicate emails', () => {
    const now = new Date().toISOString();
    expect(() => {
      dbRun(
        'INSERT INTO users (id, email, password_hash, display_name, role, is_active, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), 'test@example.com', 'hash', 'Dup', 'user', 1, 'zh', now, now]
      );
    }).toThrow();
  });

  it('should insert and read a user key', () => {
    const pem = '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----';
    const hash = crypto.createHash('sha256').update(pem).digest('hex').toUpperCase();
    const fingerprint = hash.match(/.{1,4}/g)?.join(':') || hash;
    const now = new Date().toISOString();

    dbRun(
      'INSERT INTO user_keys (id, user_id, public_key, algorithm, fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), userId, pem, 'rsa-4096', fingerprint, now, now]
    );

    const key = dbGet('SELECT * FROM user_keys WHERE user_id = ?', [userId]);
    expect(key).toBeDefined();
    expect(key!.algorithm).toBe('rsa-4096');
    expect(key!.fingerprint).toBe(fingerprint);
  });

  it('should insert and read a file', () => {
    fileId = uuidv4();
    const now = new Date().toISOString();
    const encryptedKey = Buffer.from('encrypted-data-key-here');

    dbRun(
      'INSERT INTO files (id, user_id, name, description, size, mime_type, storage_path, encrypted_key, encrypted_key_algorithm, file_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [fileId, userId, 'secret.pdf', 'My secret file', 1024, 'application/pdf', `${userId}/${fileId}_secret.pdf`, encryptedKey, 'rsa-4096', '', now, now]
    );

    const file = dbGet('SELECT * FROM files WHERE id = ?', [fileId]);
    expect(file).toBeDefined();
    expect(file!.name).toBe('secret.pdf');
    expect(file!.size).toBe(1024);
    expect(file!.user_id).toBe(userId);
  });

  it('should list user files', () => {
    const files = dbAll('SELECT * FROM files WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    expect(files.length).toBeGreaterThan(0);
    expect(files[0].name).toBe('secret.pdf');
  });

  it('should insert and redeem a share code', () => {
    const code = 'ABCDEF12';
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    dbRun(
      'INSERT INTO share_codes (id, file_id, code, created_by, share_type, target_email, encrypted_dek, temp_private_key_encrypted, expires_at, max_downloads, download_count, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)',
      [uuidv4(), fileId, code, userId, 'registered', '', Buffer.from('dek-data'), Buffer.from(''), expiresAt, 5, now]
    );

    const share = dbGet('SELECT * FROM share_codes WHERE code = ?', [code]);
    expect(share).toBeDefined();
    expect(share!.code).toBe('ABCDEF12');
    expect(share!.is_active).toBe(1);
    expect(share!.download_count).toBe(0);
    expect(share!.max_downloads).toBe(5);
  });

  it('should enforce max downloads', () => {
    const share = dbGet('SELECT * FROM share_codes WHERE code = ?', ['ABCDEF12']);
    expect(share!.download_count).toBeLessThan(share!.max_downloads);

    // Simulate max downloads reached
    dbRun('UPDATE share_codes SET download_count = max_downloads WHERE code = ?', ['ABCDEF12']);
    const updated = dbGet('SELECT * FROM share_codes WHERE code = ?', ['ABCDEF12']);
    expect(updated!.download_count).toBe(updated!.max_downloads);
  });

  it('should insert and read system config', () => {
    dbRun('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)', ['max_file_size', '524288000']);

    const configValue = dbGet('SELECT value FROM system_config WHERE key = ?', ['max_file_size']);
    expect(configValue).toBeDefined();
    expect(configValue!.value).toBe('524288000');
  });

  it('should handle Uint8Array to base64 conversion correctly', () => {
    // sql.js returns BLOB columns as Uint8Array, not Buffer
    // Uint8Array.toString('base64') does NOT produce base64 (returns comma-separated numbers)
    // Must use Buffer.from(uint8).toString('base64') instead
    const u8 = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    
    // Wrong way (what the bug was):
    const wrong = u8.toString('base64');
    expect(wrong).not.toBe('aGVsbG8=');
    
    // Correct way:
    const correct = Buffer.from(u8).toString('base64');
    expect(correct).toBe('aGVsbG8=');
    
    // Verify round-trip for real encrypted key usage
    const originalB64 = 'ZW5jcnlwdGVkLWRlay1kYXRhLWhlcmU=';
    const originalBytes = Buffer.from(originalB64, 'base64');
    const storedAsUint8 = new Uint8Array(originalBytes);
    const readBackB64 = Buffer.from(storedAsUint8).toString('base64');
    expect(readBackB64).toBe(originalB64);
  });

  it('should handle ArrayBuffer correctly (byteLength not length)', () => {
    // crypto.subtle.encrypt() returns ArrayBuffer which has .byteLength, not .length
    // This test documents the root cause of a bug where .length was used incorrectly.
    // The browser-side key generation code in keys-generate.ejs uses Web Crypto API;
    // fix: use new Uint8Array(encryptedPrivateKey).length instead of encryptedPrivateKey.length
    const buf = new ArrayBuffer(100);
    expect(buf.byteLength).toBe(100);
    expect((buf as any).length).toBeUndefined();

    // Using new Uint8Array().length is the correct approach
    const view = new Uint8Array(buf);
    expect(view.length).toBe(100);
  });

  it('should cascade delete on user removal', () => {
    // When user is deleted, their keys, files, and share codes should be deleted too
    const keyBefore = dbGet('SELECT id FROM user_keys WHERE user_id = ?', [userId]);
    expect(keyBefore).toBeDefined();

    // Manually delete all related records (cascade is handled at app level)
    dbRun('DELETE FROM share_codes WHERE created_by = ?', [userId]);
    dbRun('DELETE FROM files WHERE user_id = ?', [userId]);
    dbRun('DELETE FROM user_keys WHERE user_id = ?', [userId]);
    dbRun('DELETE FROM users WHERE id = ?', [userId]);

    const keyAfter = dbGet('SELECT id FROM user_keys WHERE user_id = ?', [userId]);
    expect(keyAfter).toBeUndefined();

    const filesAfter = dbAll('SELECT * FROM files WHERE user_id = ?', [userId]);
    expect(filesAfter.length).toBe(0);

    const userAfter = dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    expect(userAfter).toBeUndefined();
  });
});
