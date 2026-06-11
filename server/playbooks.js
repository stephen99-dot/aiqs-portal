// playbooks.js — Phase 10 client playbooks.
//
// Upgrades the flat dump of regex-learned client_insights + client_rate_library
// into a single structured, versioned playbook per user. The playbook renders
// into a fixed-format block (sorted keys -> byte-stable) that lives in the cached
// system prefix, so it holds in cache between jobs for the same user.
//
// Old tables still feed autoLearn; autoLearn now also writes learned rules into
// the playbook (a new version) instead of only loose insights.

let schemaReady = false;
function ensureSchema(db) {
  if (schemaReady) return;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS client_playbooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      playbook_json TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_playbooks_user ON client_playbooks(user_id, version)`);
    schemaReady = true;
  } catch (e) { console.error('[playbooks] schema error:', e.message); }
}

function defaultPlaybook() {
  return {
    rates: { day: null, hourly: null },
    materials_markup: null,
    ohp_treatment: 'visible',      // buried | visible | stripped
    ohp_pct: null,                 // overrides the global OH&P % when set
    contingency: null,
    contingency_pct: null,         // overrides the global contingency % when set
    vat_treatment: 'standard',
    currency: 'GBP',
    prelims_style: null,
    standing_prelims: [],
    default_exclusions: [],
    boq_format: { palette: null, totals_cascade: null, attribution: null },
    document_rules: [],
    special_rules: [],             // free-text directives
    rate_library: [],              // [{ item_key, display_name, value, unit }]
  };
}

// Recursively sort object keys so JSON.stringify is byte-stable across calls.
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

function getRawLatest(db, userId) {
  ensureSchema(db);
  return db.prepare('SELECT * FROM client_playbooks WHERE user_id=? ORDER BY version DESC LIMIT 1').get(userId);
}

function getPlaybook(db, userId) {
  const row = getRawLatest(db, userId);
  if (!row) return null;
  try { return JSON.parse(row.playbook_json); } catch (e) { return null; }
}

function savePlaybook(db, userId, playbook) {
  ensureSchema(db);
  const { v4: uuid } = require('uuid');
  const row = getRawLatest(db, userId);
  const version = row ? row.version + 1 : 1;
  const merged = { ...defaultPlaybook(), ...(playbook || {}) };
  db.prepare('INSERT INTO client_playbooks (id, user_id, version, playbook_json, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
    .run('pb_' + uuid().slice(0, 8), userId, version, JSON.stringify(sortKeys(merged)));
  return { version, playbook: merged };
}

// Build a playbook from the legacy tables (one-off, idempotent — creates v1 only
// if the user has no playbook yet).
function migrateFromLegacy(db, userId) {
  ensureSchema(db);
  if (getRawLatest(db, userId)) return { migrated: false, reason: 'already has playbook' };
  const pb = defaultPlaybook();
  try {
    const rates = db.prepare('SELECT item_key, display_name, value, unit FROM client_rate_library WHERE user_id=? AND is_active=1').all(userId);
    pb.rate_library = rates.map((r) => ({ item_key: r.item_key, display_name: r.display_name, value: r.value, unit: r.unit }));
  } catch (e) { /* table may not exist for this user */ }
  try {
    const insights = db.prepare('SELECT category, insight FROM client_insights WHERE user_id=?').all(userId);
    pb.special_rules = insights.map((i) => `[${i.category}] ${i.insight}`);
  } catch (e) { /* ignore */ }
  const saved = savePlaybook(db, userId, pb);
  return { migrated: true, version: saved.version };
}

// Best-effort: record a newly-learned insight as a new playbook version. Called
// from autoLearn so learning lands in the structured playbook, not just loose rows.
function recordInsight(db, userId, category, insight) {
  try {
    ensureSchema(db);
    const pb = getPlaybook(db, userId) || defaultPlaybook();
    const line = `[${category}] ${insight}`;
    if (!pb.special_rules) pb.special_rules = [];
    if (pb.special_rules.includes(line)) return; // dedupe — no new version
    pb.special_rules.push(line);
    savePlaybook(db, userId, pb);
  } catch (e) { /* best-effort */ }
}

// OH&P / contingency percentages for pricing, from the client's playbook.
// Default is ZERO: BOQ rates are all-in competitive prices and nothing is
// added on top automatically (front-end parity). Setting ohp_pct /
// contingency_pct in a playbook is the explicit opt-in for a margin stack.
function getPricingPrefs(db, userId) {
  let pb = null;
  try { pb = getPlaybook(db, userId); } catch (e) {}
  const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    ohp_pct: num(pb && pb.ohp_pct) != null ? num(pb.ohp_pct) : 0,
    contingency_pct: num(pb && pb.contingency_pct) != null ? num(pb.contingency_pct) : 0,
  };
}

// Set the user's BOQ margin stack — the per-user setting behind getPricingPrefs.
// null/'' clears a value back to the 0 default; numbers are clamped 0-100.
// Writes a new playbook version so the change is audit-trailed like any other
// playbook edit.
function setPricingPrefs(db, userId, { ohp_pct, contingency_pct } = {}) {
  const pb = getPlaybook(db, userId) || defaultPlaybook();
  const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Number(v))) : null);
  if (ohp_pct !== undefined) pb.ohp_pct = num(ohp_pct);
  if (contingency_pct !== undefined) pb.contingency_pct = num(contingency_pct);
  savePlaybook(db, userId, pb);
  return getPricingPrefs(db, userId);
}

// Render the playbook into the cached system prefix (stable, sorted serialisation).
function renderPlaybook(playbook) {
  if (!playbook) return '';
  const pb = sortKeys({ ...defaultPlaybook(), ...playbook });
  const isEmpty = !pb.rate_library.length && !pb.special_rules.length && pb.rates.day == null && pb.rates.hourly == null;
  if (isEmpty) return '';
  return `\n=== CLIENT PLAYBOOK (apply these as house rules) ===\n${JSON.stringify(pb, null, 2)}\n===\n`;
}

module.exports = { ensureSchema, defaultPlaybook, getPlaybook, savePlaybook, migrateFromLegacy, recordInsight, renderPlaybook, getPricingPrefs, setPricingPrefs };
