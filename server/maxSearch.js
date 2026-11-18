// ═══════════════════════════════════════════════════════════════════════════════
// MAX — server/maxSearch.js
//
// "Find the Anderson drawings", "the patio estimate", "the Oak Lane BOQ": one
// search across everything a builder has stored in the portal — their drawings
// jobs, the drawings they uploaded, the documents the AI QS team sent back, and
// their estimates. Every query is scoped to ONE user_id; nothing here can see
// another builder's rows. Ranking is a plain word-hit score — the stores are
// small per builder and the words are what people actually remember.
//
// Each result is a card the panel can show: a type, a title, where it opens,
// and (for files) where its bytes can be fetched with the builder's token.
// ═══════════════════════════════════════════════════════════════════════════════

const db = require('./database');
const { PROJECT_STATUS_LABEL } = require('./maxHelpers');

const TYPES = ['job', 'drawing', 'deliverable', 'boq', 'estimate'];
const WORD_TYPES = {
  drawing: ['drawing', 'drawings', 'plan', 'plans', 'dwg', 'dxf', 'elevation', 'section'],
  boq: ['boq', 'bill', 'bills', 'quantities', 'priced'],
  deliverable: ['document', 'documents', 'report', 'findings', 'file', 'files', 'pack'],
  estimate: ['estimate', 'estimates', 'quote', 'quotes', 'price', 'priced'],
  job: ['job', 'jobs', 'project', 'projects'],
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9£.\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const ext = (name) => String(name || '').split('.').pop().toLowerCase();

function words(q) { return norm(q).split(' ').filter((w) => w.length >= 2); }

// Words that name a type narrow the search instead of being matched literally.
function splitQuery(q) {
  const ws = words(q);
  const types = new Set();
  const terms = [];
  for (const w of ws) {
    let hit = null;
    for (const [t, list] of Object.entries(WORD_TYPES)) if (list.includes(w)) hit = t;
    if (hit) types.add(hit); else terms.push(w);
  }
  return { terms, impliedTypes: [...types] };
}

function score(fields, terms) {
  if (!terms.length) return 1; // a type-only query lists everything of that type
  const hay = fields.map(norm).join(' ');
  let s = 0;
  for (const t of terms) {
    if (hay.includes(t)) s += t.length >= 4 ? 3 : 2;
    if (new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(hay)) s += 1;
  }
  return s;
}

function search(userId, query, { types = [], limit = 12 } = {}) {
  const { terms, impliedTypes } = splitQuery(query);
  let want = types.filter((t) => TYPES.includes(t));
  if (!want.length) want = impliedTypes.length ? impliedTypes : TYPES.slice();
  const wantSet = new Set(want);
  const out = [];

  let projects = [];
  try {
    projects = db.prepare(
      'SELECT p.id, p.title, p.project_type, p.location, p.status, p.total_value, p.currency, p.created_at, p.updated_at, '
      + '(SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count, '
      + '(SELECT COUNT(*) FROM project_deliverables d WHERE d.project_id = p.id AND d.is_latest = 1) AS deliverable_count '
      + 'FROM projects p WHERE p.user_id = ? ORDER BY COALESCE(p.updated_at, p.created_at) DESC LIMIT 400'
    ).all(userId);
  } catch (e) { projects = []; }
  const projectById = Object.fromEntries(projects.map((p) => [p.id, p]));

  if (wantSet.has('job')) {
    for (const p of projects) {
      const s = score([p.title, p.location, p.project_type, p.status], terms);
      if (s > 0) out.push({ type: 'job', id: p.id, title: p.title, subtitle: [p.project_type, p.location, PROJECT_STATUS_LABEL[p.status] || p.status].filter(Boolean).join(' · '), job: p.title, date: p.updated_at || p.created_at, status: p.status, amount: p.total_value != null ? Number(p.total_value) : undefined, open_path: '/project/' + p.id, score: s });
    }
  }
  if (wantSet.has('drawing') && projects.length) {
    try {
      const rows = db.prepare(
        'SELECT f.id, f.project_id, f.filename, f.original_name, f.file_type, f.created_at FROM files f '
        + 'JOIN projects p ON p.id = f.project_id WHERE p.user_id = ? ORDER BY f.created_at DESC LIMIT 1500'
      ).all(userId);
      for (const f of rows) {
        const p = projectById[f.project_id];
        const s = score([f.original_name, p && p.title, p && p.location], terms);
        if (s > 0) out.push({ type: 'drawing', id: f.id, title: f.original_name, subtitle: p ? p.title : null, job: p ? p.title : null, date: f.created_at, open_path: '/project/' + f.project_id, ext: ext(f.original_name), file: { url: '/api/files/download/' + encodeURIComponent(f.filename), filename: f.filename, original_name: f.original_name, mime: f.file_type || null }, score: s });
      }
    } catch (e) { /* no files table yet */ }
  }
  if ((wantSet.has('deliverable') || wantSet.has('boq')) && projects.length) {
    try {
      const rows = db.prepare(
        'SELECT d.id, d.project_id, d.kind, d.filename, d.original_name, d.mime_type, d.version, d.created_at FROM project_deliverables d '
        + 'JOIN projects p ON p.id = d.project_id WHERE p.user_id = ? AND d.is_latest = 1 ORDER BY d.created_at DESC LIMIT 800'
      ).all(userId);
      for (const d of rows) {
        const isBoq = d.kind === 'boq';
        const type = isBoq ? 'boq' : 'deliverable';
        if (!wantSet.has(type)) continue;
        const p = projectById[d.project_id];
        const s = score([d.original_name, d.kind, p && p.title, p && p.location], terms);
        if (s > 0) out.push({ type, id: d.id, title: d.original_name, subtitle: [p && p.title, d.kind ? d.kind.replace(/_/g, ' ') : null, d.version > 1 ? 'v' + d.version : null].filter(Boolean).join(' · '), job: p ? p.title : null, date: d.created_at, open_path: '/project/' + d.project_id, ext: ext(d.original_name), file: { url: '/api/downloads/' + encodeURIComponent(d.filename), filename: d.filename, original_name: d.original_name, mime: d.mime_type || null }, score: s });
      }
    } catch (e) { /* none */ }
  }
  if (wantSet.has('estimate')) {
    try {
      const rows = db.prepare(
        'SELECT id, quote_number, project_name, client_name, status, grand_total, net_total, location, source, created_at, updated_at FROM quotes WHERE user_id = ? ORDER BY created_at DESC LIMIT 500'
      ).all(userId);
      for (const q of rows) {
        const s = score([q.quote_number, q.project_name, q.client_name, q.location, q.status], terms);
        if (s > 0) out.push({ type: 'estimate', id: q.id, title: q.project_name || q.quote_number, subtitle: [q.quote_number, q.client_name, q.status].filter(Boolean).join(' · '), job: q.project_name, date: q.updated_at || q.created_at, status: q.status, amount: Number(q.grand_total) || 0, open_path: '/estimates/' + q.id, score: s });
      }
    } catch (e) { /* none */ }
  }

  out.sort((a, b) => (b.score - a.score) || String(b.date || '').localeCompare(String(a.date || '')));
  const lim = Math.min(Math.max(1, Number(limit) || 12), 40);
  return { query, terms, types: want, total: out.length, results: out.slice(0, lim) };
}

module.exports = { search, TYPES, splitQuery, score };
