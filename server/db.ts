import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const databasePath = resolve(process.env.DATA_DIR ?? 'data', 'webos.db')
mkdirSync(dirname(databasePath), { recursive: true })

export const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT 'text/plain',
    encoding TEXT NOT NULL DEFAULT 'utf8',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    wallpaper TEXT NOT NULL DEFAULT 'aurora',
    accent TEXT NOT NULL DEFAULT '#6c5ce7'
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
`)

const fileColumns = new Set(
  (db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>).map(({ name }) => name),
)
if (!fileColumns.has('encoding')) {
  db.exec("ALTER TABLE files ADD COLUMN encoding TEXT NOT NULL DEFAULT 'utf8'")
}
if (!fileColumns.has('size_bytes')) {
  db.exec('ALTER TABLE files ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0')
}
db.exec(`
  UPDATE files
  SET size_bytes = length(CAST(content AS BLOB))
  WHERE encoding = 'utf8' AND size_bytes = 0 AND content <> ''
`)

db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())

export function closeDatabase() {
  if (db.open) db.close()
}
