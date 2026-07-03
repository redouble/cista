import { initDb, saveDb, dbRun, dbGet } from './index.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';

async function seed() {
  await initDb();

  // Create admin user if not exists
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@cista.local';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';

  const existing = dbGet('SELECT id FROM users WHERE email = ?', [adminEmail.toLowerCase()]);
  if (existing) {
    console.log(`Admin user ${adminEmail} already exists.`);
  } else {
    const now = new Date().toISOString();
    const passwordHash = await bcrypt.hash(adminPassword, config.password.bcryptRounds);
    dbRun(
      'INSERT INTO users (id, email, password_hash, display_name, role, is_active, locale, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), adminEmail.toLowerCase(), passwordHash, 'Admin', 'admin', 1, 'zh', now, now]
    );
    console.log(`✅ Admin user created: ${adminEmail} / ${adminPassword}`);
  }

  saveDb();
  console.log('✅ Seed completed.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
