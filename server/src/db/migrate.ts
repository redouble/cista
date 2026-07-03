import { initDb, saveDb } from './index.js';
import { config } from '../config.js';
import fs from 'fs';
import path from 'path';

export async function runMigrations() {
  const db = await initDb();

  // Ensure file storage directory exists
  if (!fs.existsSync(config.storage.localPath)) {
    fs.mkdirSync(config.storage.localPath, { recursive: true });
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
      is_active INTEGER NOT NULL DEFAULT 1,
      locale TEXT DEFAULT 'zh',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL,
      algorithm TEXT NOT NULL CHECK(algorithm IN ('rsa-4096', 'ecc-x25519')),
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      size INTEGER NOT NULL,
      mime_type TEXT DEFAULT 'application/octet-stream',
      storage_path TEXT NOT NULL,
      encrypted_key BLOB NOT NULL,
      encrypted_key_algorithm TEXT NOT NULL,
      file_hash TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS share_codes (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      share_type TEXT NOT NULL DEFAULT 'registered' CHECK(share_type IN ('registered', 'unregistered')),
      target_email TEXT DEFAULT '',
      encrypted_dek BLOB NOT NULL,
      temp_private_key_encrypted BLOB DEFAULT '',
      expires_at TEXT DEFAULT '',
      max_downloads INTEGER NOT NULL DEFAULT 5,
      download_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Insert default system config
  const insertConfig = db.prepare('INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)');
  insertConfig.run(['max_file_size', '1073741824']);
  insertConfig.run(['share_code_length', '8']);
  insertConfig.run(['share_code_expiry_days', '7']);
  insertConfig.run(['share_code_max_downloads', '5']);
  insertConfig.free();

  saveDb();

  console.log('✅ Database migrations completed successfully.');
}
