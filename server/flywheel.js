// flywheel.js — Phase 11 quality flywheel.
//
//  1. Log every admin/user correction before delivery as a structured diff.
//  2. A nightly job feeds the week's diffs to the model and proposes (a) playbook
//     rule updates per client and (b) candidate extraction MEASUREMENT RULES —
//     into an approval queue, never auto-applied to prompts.
//  3. Promote a delivered-and-accepted job to a golden eval fixture in one click.

const fs = require('fs');
const path = require('path');

let schemaReady = false;
function ensureSchema(db) {
  if (schemaReady) return;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS correction_diffs (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      user_id TEXT,
      item_key TEXT,
      field TEXT,
      model_value TEXT,
      corrected_value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_corr_created ON correction_diffs(created_at)`);
    db.exec(`CREATE TABLE IF NOT EXISTS flywheel_suggestions (
      id TEXT PRIMARY KEY,
      scope TEXT,              -- 'client' | 'prompt'
      user_id TEXT,            -- for client-scoped suggestions
      suggestion TEXT NOT NULL,
      status TEXT DEFAULT 'pending',  -- pending | approved | rejected
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    schemaReady = true;
  } catch (e) { console.error('[flywheel] schema error:', e.message); }
}

const uuid = () => require('uuid').v4().slice(0, 10);

// Diff edited items against the model's items and log each change.
function logCorrections(db, { jobId, userId, prevItems = [], newItems = [] }) {
  ensureSchema(db);
  const prevByKey = {};
  for (const it of prevItems) if (it && it.key) prevByKey[it.key] = it;
  const newByKey = {};
  for (const it of newItems) if (it && it.key) newByKey[it.key] = it;
  const ins = db.prepare('INSERT INTO correction_diffs (id, job_id, user_id, item_key, field, model_value, corrected_value) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    for (const key of Object.keys(newByKey)) {
      const prev = prevByKey[key];
      const next = newByKey[key];
      if (!prev) { ins.run('cd_' + uuid(), jobId, userId, key, 'item', null, 'added'); continue; }
      for (const field of ['qty', 'rate', 'unit', 'description']) {
        if (prev[field] !== undefined && next[field] !== undefined && String(prev[field]) !== String(next[field])) {
          ins.run('cd_' + uuid(), jobId, userId, key, field, String(prev[field]), String(next[field]));
        }
      }
    }
    for (const key of Object.keys(prevByKey)) {
      if (!newByKey[key]) ins.run('cd_' + uuid(), jobId, userId, key, 'item', 'present', 'removed');
    }
  });
  try { tx(); } catch (e) { console.error('[flywheel] logCorrections error:', e.message); }
}

// Promote a delivered job to a golden eval fixture (inputs meta + final items).
function promoteToFixture({ jobId, projectType, location, options, items, fixturesDir }) {
  const dir = fixturesDir || path.join(__dirname, 'evals', 'fixtures');
  const safe = String(jobId || ('job_' + uuid())).replace(/[^a-z0-9_-]/gi, '_');
  const jobDir = path.join(dir, safe);
  fs.mkdirSync(jobDir, { recursive: true });
  const expected = { project_type: projectType || '', location: location || '', options: options || {}, items: items || [] };
  fs.writeFileSync(path.join(jobDir, 'expected.json'), JSON.stringify(expected, null, 2));
  return { dir: jobDir, items: (items || []).length };
}

// Nightly: summarise the week's diffs and ask the model for playbook + prompt
// suggestions. Output goes to the approval queue (status 'pending') — never
// auto-applied. Uses the batch lane (Phase 6) when available.
async function generateSuggestions(db, { apiKey } = {}) {
  ensureSchema(db);
  const diffs = db.prepare(`SELECT user_id, item_key, field, model_value, corrected_value FROM correction_diffs WHERE created_at >= datetime('now','-7 days') ORDER BY user_id`).all();
  if (diffs.length === 0) return { suggestions: 0, note: 'no corrections this week' };

  const { callModel, MODELS } = require('./anthropicClient');
  const byUser = {};
  for (const d of diffs) (byUser[d.user_id] = byUser[d.user_id] || []).push(d);

  const TOOL = {
    name: 'propose_improvements',
    description: 'Propose improvements from observed QS corrections.',
    input_schema: {
      type: 'object',
      properties: {
        playbook_updates: { type: 'array', items: { type: 'string' }, description: 'Per-client house-rule updates to suggest.' },
        measurement_rules: { type: 'array', items: { type: 'string' }, description: 'Candidate additions to the extraction MEASUREMENT RULES.' },
      },
      required: ['playbook_updates', 'measurement_rules'],
      additionalProperties: true,
    },
  };

  let count = 0;
  const insS = db.prepare('INSERT INTO flywheel_suggestions (id, scope, user_id, suggestion, status) VALUES (?, ?, ?, ?, ?)');
  for (const userId of Object.keys(byUser)) {
    const summary = byUser[userId].map((d) => `${d.item_key}.${d.field}: ${d.model_value} -> ${d.corrected_value}`).join('\n');
    const res = await callModel({
      model: MODELS.STANDARD, apiKey, maxTokens: 1500,
      system: 'You improve a QS estimating system from observed human corrections. Be specific and conservative.',
      messages: [{ role: 'user', content: `Corrections observed for one client this week:\n${summary}\n\nPropose client playbook updates and candidate extraction measurement rules. Only suggest patterns that recur.` }],
      tools: [TOOL], toolChoice: { type: 'tool', name: 'propose_improvements' },
      action: 'flywheel_suggest',
    });
    const json = res.ok ? res.json : null;
    if (!json) continue;
    for (const s of (json.playbook_updates || [])) { insS.run('fs_' + uuid(), 'client', userId, s, 'pending'); count++; }
    for (const s of (json.measurement_rules || [])) { insS.run('fs_' + uuid(), 'prompt', userId, s, 'pending'); count++; }
  }
  return { suggestions: count, clients: Object.keys(byUser).length };
}

function listSuggestions(db, status = 'pending') {
  ensureSchema(db);
  return db.prepare('SELECT * FROM flywheel_suggestions WHERE status=? ORDER BY created_at DESC').all(status);
}
function setSuggestionStatus(db, id, status) {
  ensureSchema(db);
  db.prepare('UPDATE flywheel_suggestions SET status=? WHERE id=?').run(status, id);
}

module.exports = { ensureSchema, logCorrections, promoteToFixture, generateSuggestions, listSuggestions, setSuggestionStatus };
