import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { initDb, saveDb, dbRun, dbGet, dbAll } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { config } from '../src/config.js';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

// Override config to use test DB and storage
const testDbPath = path.join(process.cwd(), 'data', 'integration-test.db');
const testStoragePath = path.join(process.cwd(), 'data', 'integration-test-files');

let app: any;

// Shared state
let aliceCookies: string[] = [];
let bobCookies: string[] = [];
let adminCookies: string[] = [];
let aliceUserId: string = '';
let fileId: string = '';
let shareCode: string = '';
let shareId: string = '';
let unregShareCode: string = '';

beforeAll(async () => {
  // Reset rate limit for tests silently
  process.env.NODE_ENV = 'test';

  // Clean previous test data
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(testStoragePath)) fs.rmSync(testStoragePath, { recursive: true, force: true });
  fs.mkdirSync(testStoragePath, { recursive: true });

  (config.database as any).url = testDbPath;
  (config.storage as any).localPath = testStoragePath;
  (config.rateLimit as any).max = 1000; // disable rate limiting for tests

  await initDb();
  await runMigrations();

  // ⚠️ DEV-ONLY: Seed admin user for local development/testing.
  // Default credentials: admin@cista.local / Admin123!
  // CHANGE these via ADMIN_EMAIL / ADMIN_PASSWORD env vars in production.
  const existingAdmin = dbGet('SELECT id FROM users WHERE email = ?', ['admin@cista.local']);
  if (!existingAdmin) {
    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash('Admin123!', config.password.bcryptRounds);
    dbRun(
      'INSERT INTO users (id, email, password_hash, display_name, role, is_active, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), 'admin@cista.local', passwordHash, 'Admin', 'admin', 1, 'zh', now, now]
    );
  }

  // Import app once (module is cached on subsequent imports)
  const mod = await import('../src/index.js');
  app = mod.default;
});

afterAll(() => {
  saveDb();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  if (fs.existsSync(testStoragePath)) fs.rmSync(testStoragePath, { recursive: true, force: true });
});

// ─── Auth API ───────────────────────────────────────────────────────────

describe('Auth API', () => {
  it('should register alice', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'alice@test.com', password: 'AlicePass123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe('alice@test.com');
    aliceUserId = res.body.user.id;
  });

  it('should register bob', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bob@test.com', password: 'BobPass123' });
    expect(res.status).toBe(200);
  });

  it('should reject duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'alice@test.com', password: 'Another123' });
    expect(res.status).toBe(400);
  });

  it('should reject invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'notanemail', password: 'TestPass123' });
    expect(res.status).toBe(400);
  });

  it('should reject short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'short@test.com', password: 'Ab1' });
    expect(res.status).toBe(400);
  });

  it('should login alice', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@test.com', password: 'AlicePass123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    aliceCookies = res.headers['set-cookie'] || [];
    expect(aliceCookies.length).toBeGreaterThan(0);
  });

  it('should login bob', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bob@test.com', password: 'BobPass123' });
    expect(res.status).toBe(200);
    bobCookies = res.headers['set-cookie'] || [];
  });

  it('should login admin (dev-only credentials)', async () => {
    // ⚠️ admin@cista.local / Admin123! is for development/testing only.
    // Override via ADMIN_EMAIL / ADMIN_PASSWORD environment variables.
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@cista.local', password: 'Admin123!' });
    expect(res.status).toBe(200);
    adminCookies = res.headers['set-cookie'] || [];
  });

  it('should reject wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@test.com', password: 'WrongPass123' });
    expect(res.status).toBe(401);
  });

  it('should reject non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.com', password: 'SomePass123' });
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me should return current user', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('alice@test.com');
  });

  it('GET /api/auth/me should reject unauthenticated', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('should change password and login with new one', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', aliceCookies)
      .send({ currentPassword: 'AlicePass123', newPassword: 'NewAlice456' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Login with new password
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@test.com', password: 'NewAlice456' });
    expect(loginRes.status).toBe(200);
    aliceCookies = loginRes.headers['set-cookie'] || [];
  });

  it('should create reset token on forgot-password', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'alice@test.com' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /api/auth/reset-password should handle missing token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'nonexistent-token', password: 'ResetPass789' });
    expect(res.status).toBe(400);
  });
});

// ─── Keys API ──────────────────────────────────────────────────────────

describe('Keys API', () => {
  const validPem = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwLkNRvETL4bR6oKSEd5R\nz0EoRg8V3HG9sJ8mFn3FJ42aDv1rT5Zx7QIDAQAB\n-----END PUBLIC KEY-----`;

  it('should upload public key', async () => {
    const res = await request(app)
      .post('/api/keys/upload')
      .set('Cookie', aliceCookies)
      .send({ publicKey: validPem, algorithm: 'rsa-4096' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.fingerprint).toBeTruthy();
    expect(res.body.replaced).toBe(false);
  });

  it('should replace existing key on re-upload', async () => {
    const res = await request(app)
      .post('/api/keys/upload')
      .set('Cookie', aliceCookies)
      .send({ publicKey: validPem, algorithm: 'rsa-4096' });
    expect(res.status).toBe(200);
    expect(res.body.replaced).toBe(true);
  });

  it('should reject invalid PEM format', async () => {
    const res = await request(app)
      .post('/api/keys/upload')
      .set('Cookie', aliceCookies)
      .send({ publicKey: 'not-a-pem', algorithm: 'rsa-4096' });
    expect(res.status).toBe(400);
  });

  it('GET /api/keys/mine should return my key', async () => {
    const res = await request(app)
      .get('/api/keys/mine')
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe(validPem);
    expect(res.body.algorithm).toBe('rsa-4096');
  });

  it('GET /api/keys/mine should 404 if no key', async () => {
    const res = await request(app)
      .get('/api/keys/mine')
      .set('Cookie', bobCookies);
    expect(res.status).toBe(404);
  });

  it('GET /api/keys/by-email should find key', async () => {
    const res = await request(app)
      .get('/api/keys/by-email/alice@test.com')
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.publicKey).toBe(validPem);
  });

  it('GET /api/keys/by-email should 404 for missing user', async () => {
    const res = await request(app)
      .get('/api/keys/by-email/nonexistent@test.com')
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(404);
  });

  it('GET /api/keys/by-email should return found=false when user has no key', async () => {
    const res = await request(app)
      .get('/api/keys/by-email/bob@test.com')
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  it('POST /api/keys/verify-fingerprint should verify matching fingerprint', async () => {
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256').update(validPem).digest('hex').toUpperCase();
    const chars = hash.split('');
    const formatted: string[] = [];
    for (let i = 0; i < chars.length; i += 4) formatted.push(chars.slice(i, i + 4).join(''));
    const fingerprint = formatted.join(':');

    const res = await request(app)
      .post('/api/keys/verify-fingerprint')
      .set('Cookie', aliceCookies)
      .send({ publicKey: validPem, fingerprint });
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(true);
  });

  it('POST /api/keys/verify-fingerprint should detect non-matching', async () => {
    const res = await request(app)
      .post('/api/keys/verify-fingerprint')
      .set('Cookie', aliceCookies)
      .send({ publicKey: validPem, fingerprint: 'DEAD:BEAF:0000:1111' });
    expect(res.status).toBe(200);
    expect(res.body.match).toBe(false);
  });

  it('should require auth to upload key', async () => {
    const res = await request(app)
      .post('/api/keys/upload')
      .send({ publicKey: validPem, algorithm: 'rsa-4096' });
    expect(res.status).toBe(401);
  });

  it('should upload public key with ecc-x25519 algorithm', async () => {
    const eccPem = `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwLkNRvETL4bR6oKSEd5R\nz0EoRg8V3HG9sJ8mFn3FJ42aDv1rT5Zx7QIDAQAB\n-----END PUBLIC KEY-----`;
    const res = await request(app)
      .post('/api/keys/upload')
      .set('Cookie', bobCookies)
      .send({ publicKey: eccPem, algorithm: 'ecc-x25519' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.fingerprint).toBeTruthy();
    expect(res.body.replaced).toBe(false);

    // Verify it was stored with the right algorithm
    const mineRes = await request(app)
      .get('/api/keys/mine')
      .set('Cookie', bobCookies);
    expect(mineRes.body.algorithm).toBe('ecc-x25519');
    expect(mineRes.body.publicKey).toBe(eccPem);
  });
});

// ─── Files API ──────────────────────────────────────────────────────────

describe('Files API', () => {
  const testFileName = 'test-document.pdf';

  it('GET /api/files should return empty list initially', async () => {
    const res = await request(app)
      .get('/api/files')
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([]);
  });

  it('should upload an encrypted file', async () => {
    const encryptedContent = Buffer.from('encrypted-file-data-here-for-testing');
    const encryptedKey = Buffer.from('encrypted-dek-data-here').toString('base64');

    const res = await request(app)
      .post('/api/files/upload')
      .set('Cookie', aliceCookies)
      .field('encryptedKey', encryptedKey)
      .field('encryptedKeyAlgorithm', 'rsa-4096')
      .field('description', 'A test file')
      .field('fileName', testFileName)
      .attach('file', encryptedContent, testFileName);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.file).toBeDefined();
    expect(res.body.file.name).toBe(testFileName);
    fileId = res.body.file.id;
  });

  it('should reject upload without encrypted key', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .set('Cookie', aliceCookies)
      .attach('file', Buffer.from('some-data'), 'test.txt');
    expect(res.status).toBe(400);
  });

  it('should reject upload without auth', async () => {
    const res = await request(app)
      .post('/api/files/upload')
      .attach('file', Buffer.from('data'), 'test.txt')
      .field('encryptedKey', Buffer.from('key').toString('base64'));
    expect(res.status).toBe(401);
  });

  it('GET /api/files should list uploaded files', async () => {
    const res = await request(app)
      .get('/api/files')
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(200);
    expect(res.body.files.length).toBeGreaterThan(0);
    expect(res.body.files[0].name).toBe(testFileName);
    expect(res.body.files[0].shareCodes).toBeDefined();
  });

  it('GET /api/files/:id should get file details', async () => {
    const res = await request(app)
      .get(`/api/files/${fileId}`)
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(200);
    expect(res.body.file).toBeDefined();
    expect(res.body.file.name).toBe(testFileName);
    expect(res.body.file.encryptedKey).toBeDefined();
    expect(typeof res.body.file.encryptedKey).toBe('string');
    // Verify it's valid base64
    expect(() => Buffer.from(res.body.file.encryptedKey, 'base64').toString()).not.toThrow();
    expect(res.body.file.storagePath).toBeTruthy();
  });

  it('GET /api/files/:id should 404 for non-existent', async () => {
    const res = await request(app)
      .get('/api/files/non-existent-id')
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(404);
  });

  it('GET /api/files/download/:id should download encrypted file', async () => {
    const res = await request(app)
      .get(`/api/files/download/${fileId}`)
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(200);
    expect(res.body.file).toBeDefined();
    expect(res.body.file.encryptedData).toBeTruthy();
    expect(res.body.file.encryptedKey).toBeTruthy();
    expect(res.body.file.name).toBe(testFileName);
  });
});

// ─── Shares API ─────────────────────────────────────────────────────────

describe('Shares API', () => {
  it('should upload key for bob', async () => {
    const bobPem = `-----BEGIN PUBLIC KEY-----\nMIIBCgKCAQEAwLkNRvETL4bR6oKSEd5Rz0EoRg8V3HG9sJ8mFn3FJ42aDv1r\nT5Zx7QIDAQAB\n-----END PUBLIC KEY-----`;
    const res = await request(app)
      .post('/api/keys/upload')
      .set('Cookie', bobCookies)
      .send({ publicKey: bobPem, algorithm: 'rsa-4096' });
    expect(res.status).toBe(200);
  });

  it('should generate a share code (registered)', async () => {
    const res = await request(app)
      .post('/api/shares/generate')
      .set('Cookie', aliceCookies)
      .send({
        fileId,
        shareType: 'registered',
        encryptedDek: Buffer.from('test-encrypted-dek').toString('base64'),
        targetEmail: 'bob@test.com',
        maxDownloads: 3,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.code).toBeTruthy();
    expect(res.body.code.length).toBeGreaterThanOrEqual(6);
    shareCode = res.body.code;
  });

  it('share code uses only valid charset (A-Z, 2-9, excludes I O 0 1)', async () => {
    expect(shareCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
  });

  it('should reject share generate with missing fields', async () => {
    const res = await request(app)
      .post('/api/shares/generate')
      .set('Cookie', aliceCookies)
      .send({ fileId });
    expect(res.status).toBe(400);
  });

  it('should reject share generate for non-existent file', async () => {
    const res = await request(app)
      .post('/api/shares/generate')
      .set('Cookie', aliceCookies)
      .send({
        fileId: 'non-existent',
        shareType: 'registered',
        encryptedDek: Buffer.from('key').toString('base64'),
      });
    expect(res.status).toBe(404);
  });

  it('should generate an unregistered share code', async () => {
    const res = await request(app)
      .post('/api/shares/generate')
      .set('Cookie', aliceCookies)
      .send({
        fileId,
        shareType: 'unregistered',
        encryptedDek: Buffer.from('temp-dek-encrypted').toString('base64'),
        tempPrivateKeyEncrypted: Buffer.from('encrypted-temp-key').toString('base64'),
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    unregShareCode = res.body.code;
  });

  it('GET /api/shares/mine should list share codes', async () => {
    const res = await request(app)
      .get('/api/shares/mine')
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(200);
    expect(res.body.codes.length).toBeGreaterThan(0);
    expect(res.body.codes[0].code).toBeTruthy();
    // Find the registered share code we generated
    const ourShare = res.body.codes.find((c: any) => c.code === shareCode);
    expect(ourShare).toBeDefined();
    shareId = ourShare.id;
  });

  it('GET /api/shares/verify/:code should verify valid code', async () => {
    const res = await request(app)
      .get(`/api/shares/verify/${shareCode}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.fileName).toBeTruthy();
    expect(res.body.shareType).toBe('registered');
  });

  it('GET /api/shares/verify/:code should reject invalid code', async () => {
    const res = await request(app)
      .get('/api/shares/verify/ZZZZZZZZ');
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  it('POST /api/shares/redeem should redeem a valid code', async () => {
    const res = await request(app)
      .post('/api/shares/redeem')
      .set('Cookie', aliceCookies)
      .send({ code: shareCode });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.file).toBeDefined();
    expect(res.body.file.encryptedData).toBeTruthy();
    expect(res.body.file.name).toBeTruthy();
  });

  it('POST /api/shares/redeem should reject invalid code', async () => {
    const res = await request(app)
      .post('/api/shares/redeem')
      .set('Cookie', aliceCookies)
      .send({ code: 'ZZZZZZZZ' });
    expect(res.status).toBe(404);
  });

  it('POST /api/shares/redeem should allow unauthenticated redeem for unregistered share', async () => {
    const res = await request(app)
      .post('/api/shares/redeem')
      .send({ code: unregShareCode });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.file).toBeDefined();
    expect(res.body.file.shareType).toBe('unregistered');
    expect(res.body.file.tempPrivateKeyEncrypted).toBeTruthy();
  });

  it('POST /api/shares/redeem should reject registered share without auth', async () => {
    const res = await request(app)
      .post('/api/shares/redeem')
      .send({ code: shareCode });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/shares/:id should revoke share code', async () => {
    const res = await request(app)
      .delete(`/api/shares/${shareId}`)
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify it's revoked
    const verifyRes = await request(app)
      .get(`/api/shares/verify/${shareCode}`);
    expect(verifyRes.body.valid).toBe(false);
    expect(verifyRes.body.reason).toContain('revoked');
  });

  it('POST /api/shares/redeem should reject revoked code', async () => {
    const res = await request(app)
      .post('/api/shares/redeem')
      .set('Cookie', aliceCookies)
      .send({ code: shareCode });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('revoked');
  });
});

// ─── Admin API ──────────────────────────────────────────────────────────

describe('Admin API', () => {
  it('GET /api/admin/users should list all users for admin', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', adminCookies);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThanOrEqual(3);
    expect(res.body.users.some((u: any) => u.email === 'alice@test.com')).toBe(true);
  });

  it('GET /api/admin/users should reject non-admin', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/stats should return system stats', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', adminCookies);
    expect(res.status).toBe(200);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats.totalUsers).toBeGreaterThanOrEqual(3);
    expect(res.body.stats.totalFiles).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/admin/config should return system config', async () => {
    const res = await request(app)
      .get('/api/admin/config')
      .set('Cookie', adminCookies);
    expect(res.status).toBe(200);
    expect(res.body.config).toBeDefined();
    expect(res.body.config.max_file_size).toBeTruthy();
  });

  it('PUT /api/admin/config should update system config', async () => {
    const res = await request(app)
      .put('/api/admin/config')
      .set('Cookie', adminCookies)
      .send({ max_file_size: '524288000', share_code_length: '6' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify
    const configRes = await request(app)
      .get('/api/admin/config')
      .set('Cookie', adminCookies);
    expect(configRes.body.config.max_file_size).toBe('524288000');
    expect(configRes.body.config.share_code_length).toBe('6');
  });

  it('should toggle user active status', async () => {
    const usersRes = await request(app)
      .get('/api/admin/users')
      .set('Cookie', adminCookies);
    const bob = usersRes.body.users.find((u: any) => u.email === 'bob@test.com');
    expect(bob).toBeDefined();

    const res = await request(app)
      .post(`/api/admin/users/${bob.id}/toggle`)
      .set('Cookie', adminCookies);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Toggle back
    await request(app)
      .post(`/api/admin/users/${bob.id}/toggle`)
      .set('Cookie', adminCookies);
  });

  it('should not disable admin account', async () => {
    const usersRes = await request(app)
      .get('/api/admin/users')
      .set('Cookie', adminCookies);
    const adminUser = usersRes.body.users.find((u: any) => u.role === 'admin');
    expect(adminUser).toBeDefined();

    const res = await request(app)
      .post(`/api/admin/users/${adminUser.id}/toggle`)
      .set('Cookie', adminCookies);
    expect(res.status).toBe(400);
  });
});

// ─── Locale API ─────────────────────────────────────────────────────────

describe('Locale API', () => {
  it('should set locale cookie to zh', async () => {
    const res = await request(app)
      .post('/api/locale')
      .send({ locale: 'zh' });
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] || [];
    expect(setCookie.some((c: string) => c.includes('locale=zh'))).toBe(true);
  });

  it('should set locale cookie to en', async () => {
    const res = await request(app)
      .post('/api/locale')
      .send({ locale: 'en' });
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] || [];
    expect(setCookie.some((c: string) => c.includes('locale=en'))).toBe(true);
  });
});

// ─── File & Account Cleanup ────────────────────────────────────────────

describe('Cleanup', () => {
  it('DELETE /api/files/:id should delete a file', async () => {
    const res = await request(app)
      .delete(`/api/files/${fileId}`)
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify deleted
    const getRes = await request(app)
      .get(`/api/files/${fileId}`)
      .set('Cookie', aliceCookies);
    expect(getRes.status).toBe(404);
  });

  it('should handle delete non-existent file', async () => {
    const res = await request(app)
      .delete('/api/files/non-existent')
      .set('Cookie', aliceCookies);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/auth/account should delete user account', async () => {
    // Get fresh cookies for deleteme user
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'deleteme@test.com', password: 'DeleteMe123' });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'deleteme@test.com', password: 'DeleteMe123' });
    const delCookies = loginRes.headers['set-cookie'] || [];

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', delCookies)
      .send({ password: 'DeleteMe123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify login fails after deletion
    const failRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'deleteme@test.com', password: 'DeleteMe123' });
    expect(failRes.status).toBe(401);
  });
});
