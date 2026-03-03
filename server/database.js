const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Use persistent disk if available, otherwise fall back to local
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'aiqs.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    company TEXT,
    phone TEXT,
    role TEXT DEFAULT 'client',
    plan TEXT DEFAULT 'starter',
    monthly_quota INTEGER DEFAULT 2,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    project_type TEXT NOT NULL,
    description TEXT,
    location TEXT,
    status TEXT DEFAULT 'submitted',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_type TEXT,
    file_size INTEGER,
    upload_type TEXT DEFAULT 'drawing',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS magic_links (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    project_id TEXT,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS project_data (
    project_id TEXT NOT NULL,
    data_type TEXT NOT NULL,
    data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, data_type),
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
  CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
  CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token);
`);

// ─── Migrations for existing databases ──────────────────────────────────────
const migrations = [
  { column: 'role', table: 'users', sql: "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'client'" },
  { column: 'plan', table: 'users', sql: "ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'starter'" },
  { column: 'monthly_quota', table: 'users', sql: "ALTER TABLE users ADD COLUMN monthly_quota INTEGER DEFAULT 2" },
  { column: 'source', table: 'projects', sql: "ALTER TABLE projects ADD COLUMN source TEXT DEFAULT 'portal'" },
];

for (const { column, table, sql } of migrations) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(col => col.name === column)) {
      db.exec(sql);
      console.log(`✅ Added ${column} column to ${table} table`);
    }
  } catch (err) {
    console.log(`Migration ${column}:`, err.message);
  }
}

// ─── Client Rate Training Tables ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS client_rate_library (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    item_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    original_value REAL,
    source_project_id TEXT,
    client_note TEXT,
    confidence REAL DEFAULT 0.5,
    times_applied INTEGER DEFAULT 0,
    times_confirmed INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, category, item_key)
  );

  CREATE TABLE IF NOT EXISTS rate_corrections_log (
    id TEXT PRIMARY KEY,
    rate_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT,
    old_value REAL,
    new_value REAL NOT NULL,
    correction_source TEXT DEFAULT 'chat',
    raw_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (rate_id) REFERENCES client_rate_library(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_client_rates_user ON client_rate_library(user_id);
  CREATE INDEX IF NOT EXISTS idx_client_rates_active ON client_rate_library(user_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_corrections_user ON rate_corrections_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_corrections_rate ON rate_corrections_log(rate_id);
`);

module.exports = db;
