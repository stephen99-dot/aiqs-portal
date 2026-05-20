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

  CREATE TABLE IF NOT EXISTS user_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    dismissed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_user_messages_user ON user_messages(user_id);

  -- Free-form system memories: seeded from onboarding, captured from chats, edited by user.
  -- Distinct from client_insights (regex-extracted). Each memory can carry an embedding
  -- for semantic retrieval.
  CREATE TABLE IF NOT EXISTS user_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT,
    source TEXT DEFAULT 'chat',
    confidence REAL DEFAULT 0.8,
    embedding BLOB,
    embedding_model TEXT,
    is_active INTEGER DEFAULT 1,
    use_count INTEGER DEFAULT 0,
    last_used_at DATETIME,
    source_session_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_user_memories_user ON user_memories(user_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_user_memories_category ON user_memories(user_id, category);

  -- FTS5 fallback index for keyword retrieval when embeddings aren't available
  CREATE VIRTUAL TABLE IF NOT EXISTS user_memories_fts USING fts5(
    content, category, user_id UNINDEXED, memory_id UNINDEXED,
    tokenize = 'porter unicode61'
  );

  -- Per-project intake answers captured when files are uploaded (scope, floor area, etc.)
  -- Injected into the system prompt for that session so the BOQ output is grounded.
  CREATE TABLE IF NOT EXISTS project_intake (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_id TEXT,
    scope TEXT,
    floor_area_m2 REAL,
    project_type TEXT,
    location TEXT,
    spec_level TEXT,
    budget_range TEXT,
    timeline TEXT,
    notes TEXT,
    extra_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_project_intake_user ON project_intake(user_id);
  CREATE INDEX IF NOT EXISTS idx_project_intake_session ON project_intake(session_id);

  -- Drawings submitted via the in-portal "Submit Drawings" form. These mirror the
  -- public theaiqs.co.uk form's Pipedream flow but are tied to a portal user and
  -- consume one free_credit each.
  CREATE TABLE IF NOT EXISTS drawing_submissions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    submission_id TEXT UNIQUE NOT NULL,
    project_type TEXT,
    message TEXT,
    file_count INTEGER DEFAULT 0,
    file_names TEXT,
    pipedream_status TEXT,
    credits_remaining_after INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_drawing_submissions_user ON drawing_submissions(user_id);
  CREATE INDEX IF NOT EXISTS idx_drawing_submissions_created ON drawing_submissions(created_at);

  -- Files the QS sends back into the customer's portal: priced BOQs,
  -- marked-up drawings, findings reports, supplier quotes, etc.
  -- Versioned per (project_id, kind) so revisions are kept, not overwritten.
  CREATE TABLE IF NOT EXISTS project_deliverables (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    submission_id TEXT,
    kind TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    version INTEGER DEFAULT 1,
    notes TEXT,
    uploaded_by TEXT,
    is_latest INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  CREATE INDEX IF NOT EXISTS idx_deliverables_project ON project_deliverables(project_id);
  CREATE INDEX IF NOT EXISTS idx_deliverables_latest ON project_deliverables(project_id, is_latest);

  -- Per-customer branding applied to every generated Client Copy / Findings
  -- doc, plus the on-screen preview. Logo is stored on disk and referenced
  -- by filename. Template values must match the keys in PORTAL_SPEC.md
  -- ("modern" | "professional" | "heritage" | "minimalist").
  -- Estimator add-on: lightweight quote generator (separate from the BOQ pipeline).
  -- Builder describes a job, gets a sectioned itemised quote, edits, exports PDF/XLSX.
  -- Gated behind users.has_estimator (added in the migrations array below).
  CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_name TEXT,
    project_name TEXT,
    project_type TEXT,
    currency TEXT DEFAULT 'GBP',
    input_text TEXT,
    net_total REAL DEFAULT 0,
    ohp_pct REAL DEFAULT 0,
    ohp_amount REAL DEFAULT 0,
    contingency_pct REAL DEFAULT 0,
    contingency_amount REAL DEFAULT 0,
    vat_pct REAL DEFAULT 0,
    vat_amount REAL DEFAULT 0,
    grand_total REAL DEFAULT 0,
    target_margin_pct REAL DEFAULT 0,
    margin_pct REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',
    notes TEXT,
    quote_number TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS quote_lines (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL,
    section TEXT,
    item TEXT,
    description TEXT,
    unit TEXT,
    qty REAL DEFAULT 0,
    rate REAL DEFAULT 0,
    labour REAL DEFAULT 0,
    materials REAL DEFAULT 0,
    line_total REAL DEFAULT 0,
    est_rate INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (quote_id) REFERENCES quotes(id)
  );

  CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);
  CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_lines(quote_id);

  CREATE TABLE IF NOT EXISTS user_branding (
    user_id          TEXT PRIMARY KEY,
    logo_filename    TEXT,
    logo_mime        TEXT,
    primary_colour   TEXT DEFAULT '#1B2A4A',
    accent_colour    TEXT DEFAULT '#F59E0B',
    company_name     TEXT,
    company_address  TEXT,
    footer_text      TEXT,
    template         TEXT DEFAULT 'modern',
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
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
  { column: 'onboarding_completed_at', table: 'users', sql: "ALTER TABLE users ADD COLUMN onboarding_completed_at DATETIME" },
  { column: 'onboarding_skipped', table: 'users', sql: "ALTER TABLE users ADD COLUMN onboarding_skipped INTEGER DEFAULT 0" },
  { column: 'free_credits', table: 'users', sql: "ALTER TABLE users ADD COLUMN free_credits INTEGER DEFAULT 0" },
  { column: 'total_projects', table: 'users', sql: "ALTER TABLE users ADD COLUMN total_projects INTEGER DEFAULT 0" },
  // Admin submissions inbox — actioned state + private notes
  { column: 'actioned_at', table: 'drawing_submissions', sql: "ALTER TABLE drawing_submissions ADD COLUMN actioned_at DATETIME" },
  { column: 'actioned_by', table: 'drawing_submissions', sql: "ALTER TABLE drawing_submissions ADD COLUMN actioned_by TEXT" },
  { column: 'admin_notes', table: 'drawing_submissions', sql: "ALTER TABLE drawing_submissions ADD COLUMN admin_notes TEXT" },
  { column: 'project_id',  table: 'drawing_submissions', sql: "ALTER TABLE drawing_submissions ADD COLUMN project_id TEXT" },
  // Builders' source files are uploaded to Google Drive (via Pipedream), not
  // stored locally — so we keep a per-submission Drive URL the admin can paste
  // once, and the inbox surfaces "Open in Drive" links.
  { column: 'drive_link',  table: 'drawing_submissions', sql: "ALTER TABLE drawing_submissions ADD COLUMN drive_link TEXT" },
  // Estimator add-on capability flag
  { column: 'has_estimator', table: 'users', sql: "ALTER TABLE users ADD COLUMN has_estimator INTEGER DEFAULT 0" },
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
