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

  CREATE TABLE IF NOT EXISTS usage_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    model_used TEXT,
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    cost_estimate REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS chat_projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    total_value REAL,
    currency TEXT DEFAULT 'GBP',
    boq_filename TEXT,
    findings_filename TEXT,
    summary TEXT,
    item_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
  CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
  CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token);
  CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_chat_projects_user ON chat_projects(user_id);

  CREATE TABLE IF NOT EXISTS client_rate_library (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    item_key TEXT NOT NULL,
    display_name TEXT,
    value REAL,
    unit TEXT,
    confidence REAL DEFAULT 0.75,
    original_value REAL,
    client_note TEXT,
    times_applied INTEGER DEFAULT 0,
    times_confirmed INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS rate_corrections_log (
    id TEXT PRIMARY KEY,
    rate_id TEXT,
    user_id TEXT NOT NULL,
    old_value REAL,
    new_value REAL,
    correction_source TEXT,
    raw_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS client_insights (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    insight TEXT NOT NULL,
    source_project TEXT,
    times_reinforced INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_rate_library_user ON client_rate_library(user_id);
  CREATE INDEX IF NOT EXISTS idx_rate_library_active ON client_rate_library(user_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_rate_corrections_user ON rate_corrections_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_insights_user ON client_insights(user_id);
  CREATE INDEX IF NOT EXISTS idx_insights_category ON client_insights(category);

  CREATE TABLE IF NOT EXISTS variations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    vo_number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    additions REAL DEFAULT 0,
    omissions REAL DEFAULT 0,
    net_change REAL DEFAULT 0,
    currency TEXT DEFAULT 'GBP',
    status TEXT DEFAULT 'draft',
    approved_at DATETIME,
    rejected_at DATETIME,
    rejection_reason TEXT,
    original_boq_filename TEXT,
    revised_boq_filename TEXT,
    vo_doc_filename TEXT,
    raw_analysis TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_variations_project ON variations(project_id);
  CREATE INDEX IF NOT EXISTS idx_variations_user ON variations(user_id);
`);

// Migrations for existing databases
const migrations = [
  { column: 'role', table: 'users', sql: "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'client'" },
  { column: 'plan', table: 'users', sql: "ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'starter'" },
  { column: 'monthly_quota', table: 'users', sql: "ALTER TABLE users ADD COLUMN monthly_quota INTEGER DEFAULT 2" },
  { column: 'source', table: 'projects', sql: "ALTER TABLE projects ADD COLUMN source TEXT DEFAULT 'portal'" },
  { column: 'suspended', table: 'users', sql: "ALTER TABLE users ADD COLUMN suspended INTEGER DEFAULT 0" },
  { column: 'suspended_reason', table: 'users', sql: "ALTER TABLE users ADD COLUMN suspended_reason TEXT" },
  { column: 'total_value', table: 'projects', sql: "ALTER TABLE projects ADD COLUMN total_value REAL" },
  { column: 'currency', table: 'projects', sql: "ALTER TABLE projects ADD COLUMN currency TEXT DEFAULT 'GBP'" },
  { column: 'item_count', table: 'projects', sql: "ALTER TABLE projects ADD COLUMN item_count INTEGER DEFAULT 0" },
  { column: 'bonus_messages', table: 'users', sql: "ALTER TABLE users ADD COLUMN bonus_messages INTEGER DEFAULT 0" },
  { column: 'bonus_docs', table: 'users', sql: "ALTER TABLE users ADD COLUMN bonus_docs INTEGER DEFAULT 0" },
  { column: 'force_password_change', table: 'users', sql: "ALTER TABLE users ADD COLUMN force_password_change INTEGER DEFAULT 0" },
  { column: 'billing_cycle_start', table: 'users', sql: "ALTER TABLE users ADD COLUMN billing_cycle_start TEXT" },
  { column: 'stripe_subscription_id', table: 'users', sql: "ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT" },
];

for (const { column, table, sql } of migrations) {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(col => col.name === column)) {
      db.exec(sql);
      console.log(`Added ${column} column to ${table} table`);
    }
  } catch (err) {
    console.log(`Migration ${column}:`, err.message);
  }
}

module.exports = db;
