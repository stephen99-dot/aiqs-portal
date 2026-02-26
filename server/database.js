const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Use Render persistent disk if available, otherwise local data folder
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'aiqs.db');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

console.log(`[DB] Database path: ${DB_PATH}`);
console.log(`[DB] Uploads path: ${UPLOADS_DIR}`);

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
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
    monthly_quota INTEGER DEFAULT 0,
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
  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
  CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
`);

// Migration: add role column if it doesn't exist (for existing databases)
try {
  db.prepare("SELECT role FROM users LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'client'");
  console.log('Migration: added role column to users table');
}

// Migration: add plan column if it doesn't exist
try {
  db.prepare("SELECT plan FROM users LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'starter'");
  console.log('Migration: added plan column to users table');
}

// Migration: add monthly_quota column if it doesn't exist
try {
  db.prepare("SELECT monthly_quota FROM users LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE users ADD COLUMN monthly_quota INTEGER DEFAULT 0");
  console.log('Migration: added monthly_quota column to users table');
}

// Migration: add stripe_subscription_id column if it doesn't exist
try {
  db.prepare("SELECT stripe_subscription_id FROM users LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT");
  console.log('Migration: added stripe_subscription_id column to users table');
}

// Migration: ensure admin email has admin role
db.prepare("UPDATE users SET role = 'admin' WHERE email = 'hello@crmwizardai.com' AND (role IS NULL OR role != 'admin')").run();

module.exports = db;
