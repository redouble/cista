import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

let db: SqlJsDatabase | null = null;

export async function initDb(): Promise<SqlJsDatabase> {
  if (db) return db;

  const dbPath = config.database.url;
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const SQL = await initSqlJs();

  // Load existing database if it exists, otherwise create new one
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

  return db;
}

export function getDb(): SqlJsDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function saveDb() {
  if (!db) return;
  const dbPath = config.database.url;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Helper to run a query and return all rows
export function dbAll(sql: string, params?: any[]): any[] {
  const stmt = getDb().prepare(sql);
  if (params) {
    stmt.bind(params);
  }
  const results: any[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper to run a query and return first row
export function dbGet(sql: string, params?: any[]): any | undefined {
  const stmt = getDb().prepare(sql);
  if (params) {
    stmt.bind(params);
  }
  let result: any | undefined;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

// Helper to run a statement (INSERT/UPDATE/DELETE)
export function dbRun(sql: string, params?: any[]): void {
  getDb().run(sql, params);
  saveDb();
}

// Helper to get last insert ID
export function dbLastInsertId(): number {
  const result = dbGet('SELECT last_insert_rowid() as id');
  return result?.id || 0;
}
