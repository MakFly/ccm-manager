import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';

const STATE_DIR = join(homedir(), '.ccs');
const STATE_DB = join(STATE_DIR, 'state.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }

    db = new Database(STATE_DB);
    db.pragma('journal_mode = WAL');

    // Create tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS provider_state (
        provider_key TEXT PRIMARY KEY,
        last_memory_reset INTEGER NOT NULL DEFAULT 0
      )
    `);
  }
  return db;
}

export function getLastMemoryReset(providerKey: string): number {
  const db = getDb();
  const row = db.prepare('SELECT last_memory_reset FROM provider_state WHERE provider_key = ?').get(providerKey) as { last_memory_reset: number } | undefined;
  return row?.last_memory_reset ?? 0;
}

export function setLastMemoryReset(providerKey: string, timestamp: number = Date.now()): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO provider_state (provider_key, last_memory_reset)
    VALUES (?, ?)
    ON CONFLICT(provider_key) DO UPDATE SET last_memory_reset = excluded.last_memory_reset
  `).run(providerKey, timestamp);
}

export function shouldResetMemory(providerKey: string, maxAgeMs: number = 24 * 60 * 60 * 1000): boolean {
  const lastReset = getLastMemoryReset(providerKey);
  const now = Date.now();
  return (now - lastReset) > maxAgeMs;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
