// User-facing, free-form memory store.
// Stores memories seeded from onboarding, captured from chats (via [MEMORY|...] tags),
// and edited/deleted by the user from /ai-memory.
// Retrieval combines semantic (Voyage embeddings) + FTS5 keyword + category boosts.

const { v4: uuidv4 } = require('uuid');
const embeddings = require('./embeddings');

const VALID_CATEGORIES = new Set([
  'profile', 'project_type', 'region', 'method_of_measurement',
  'spec_preference', 'markup', 'contingency', 'supplier', 'exclusion',
  'team', 'commercial', 'workflow', 'tooling', 'rate_note', 'general',
]);

function normaliseCategory(cat) {
  if (!cat) return 'general';
  const c = String(cat).toLowerCase().trim();
  return VALID_CATEGORIES.has(c) ? c : 'general';
}

async function createMemory(db, { userId, content, category, source, confidence, sessionId }) {
  if (!userId || !content) throw new Error('userId and content required');
  const trimmed = String(content).trim();
  if (trimmed.length < 3 || trimmed.length > 800) {
    throw new Error('content must be 3-800 chars');
  }
  const cat = normaliseCategory(category);
  const id = 'mem_' + uuidv4().slice(0, 10);

  // Compute embedding (may return null if Voyage key missing or call fails)
  let blob = null, modelUsed = null;
  try {
    const vec = await embeddings.embed(trimmed, { inputType: 'document' });
    if (vec) { blob = embeddings.vectorToBlob(vec); modelUsed = embeddings.VOYAGE_MODEL; }
  } catch (e) { /* swallow — fall back to FTS only */ }

  db.prepare(`INSERT INTO user_memories
    (id, user_id, content, category, source, confidence, embedding, embedding_model, source_session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, userId, trimmed, cat, source || 'chat',
    Number.isFinite(confidence) ? confidence : 0.8,
    blob, modelUsed, sessionId || null
  );
  try {
    db.prepare(`INSERT INTO user_memories_fts (content, category, user_id, memory_id) VALUES (?, ?, ?, ?)`)
      .run(trimmed, cat, userId, id);
  } catch (e) { /* FTS insert failed — not fatal, retrieval will skip */ }
  return { id, user_id: userId, content: trimmed, category: cat, source: source || 'chat' };
}

async function updateMemory(db, { id, userId, content, category, isActive }) {
  const existing = db.prepare('SELECT * FROM user_memories WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) return null;
  const newContent = content != null ? String(content).trim() : existing.content;
  const newCat = category != null ? normaliseCategory(category) : existing.category;
  const newActive = isActive == null ? existing.is_active : (isActive ? 1 : 0);
  let blob = existing.embedding, modelUsed = existing.embedding_model;
  if (content != null && newContent !== existing.content) {
    try {
      const vec = await embeddings.embed(newContent, { inputType: 'document' });
      if (vec) { blob = embeddings.vectorToBlob(vec); modelUsed = embeddings.VOYAGE_MODEL; }
    } catch (e) {}
  }
  db.prepare(`UPDATE user_memories SET content = ?, category = ?, is_active = ?, embedding = ?, embedding_model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(newContent, newCat, newActive, blob, modelUsed, id);
  try {
    db.prepare('DELETE FROM user_memories_fts WHERE memory_id = ?').run(id);
    if (newActive === 1) {
      db.prepare(`INSERT INTO user_memories_fts (content, category, user_id, memory_id) VALUES (?, ?, ?, ?)`)
        .run(newContent, newCat, userId, id);
    }
  } catch (e) {}
  return db.prepare('SELECT id, user_id, content, category, source, confidence, is_active, created_at, updated_at FROM user_memories WHERE id = ?').get(id);
}

function deleteMemory(db, { id, userId }) {
  const res = db.prepare('DELETE FROM user_memories WHERE id = ? AND user_id = ?').run(id, userId);
  try { db.prepare('DELETE FROM user_memories_fts WHERE memory_id = ?').run(id); } catch (e) {}
  return res.changes > 0;
}

function listMemories(db, { userId, includeInactive = false } = {}) {
  const rows = db.prepare(
    `SELECT id, content, category, source, confidence, is_active, use_count, last_used_at, created_at, updated_at
     FROM user_memories
     WHERE user_id = ? ${includeInactive ? '' : 'AND is_active = 1'}
     ORDER BY updated_at DESC`
  ).all(userId);
  return rows;
}

function isDuplicate(db, { userId, content }) {
  if (!content) return false;
  const normalized = String(content).trim().toLowerCase();
  const rows = db.prepare('SELECT content FROM user_memories WHERE user_id = ? AND is_active = 1').all(userId);
  for (const r of rows) {
    const existing = String(r.content || '').trim().toLowerCase();
    if (!existing) continue;
    if (existing === normalized) return true;
    // Word-overlap heuristic — same approach used for client_insights
    const a = existing.split(/\s+/).filter(w => w.length > 2);
    const b = normalized.split(/\s+/).filter(w => w.length > 2);
    if (a.length === 0 || b.length === 0) continue;
    const common = a.filter(w => b.includes(w)).length;
    if (common / Math.max(a.length, b.length) > 0.75) return true;
  }
  return false;
}

// Words that carry no signal about WHICH job is being discussed. Kept short and
// generic — the trade vocabulary ("drawings", "extension") is handled by asking for
// two terms in common rather than by listing every construction word in English.
const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'been', 'before', 'could', 'does', 'from', 'have',
  'here', 'into', 'just', 'like', 'make', 'more', 'much', 'need', 'only', 'over',
  'please', 'should', 'some', 'such', 'than', 'that', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'very', 'want', 'what', 'when', 'where', 'which', 'will',
  'with', 'would', 'your',
]);

// Crude plural fold, so "drawings" and "drawing" count as the same term. FTS5's
// porter tokenizer already stems on its side; this is for the check we do on ours.
function stem(w) {
  return w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w;
}

/** The words in a query worth searching on, at most six of them. */
function searchTerms(q) {
  return String(q || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 4 && !STOPWORDS.has(w))
    .slice(0, 6);
}

/** How many of those terms actually appear in a candidate memory. */
function sharedTermCount(content, terms) {
  const words = new Set(String(content || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem));
  return terms.filter(t => words.has(stem(t))).length;
}

// Retrieve top-K memories most relevant to the query.
// Uses embeddings when available, FTS5 as fallback, always capped at topK.
async function retrieveRelevant(db, { userId, query, topK = 8 }) {
  if (!userId) return [];
  const q = (query || '').trim();
  const all = db.prepare(
    `SELECT id, content, category, source, confidence, embedding
     FROM user_memories
     WHERE user_id = ? AND is_active = 1`
  ).all(userId);
  if (all.length === 0) return [];
  if (!q) {
    // No query — return most recent high-confidence memories
    return all.slice(0, topK).map(r => ({
      id: r.id, content: r.content, category: r.category,
      source: r.source, confidence: r.confidence, score: 0,
    }));
  }

  // Try semantic retrieval
  let queryVec = null;
  try { queryVec = await embeddings.embed(q, { inputType: 'query' }); } catch (e) {}

  if (queryVec) {
    const scored = all.map(r => {
      const vec = embeddings.blobToVector(r.embedding);
      const score = vec ? embeddings.cosineSimilarity(queryVec, vec) : 0;
      return { id: r.id, content: r.content, category: r.category, source: r.source, confidence: r.confidence, score };
    });
    scored.sort((a, b) => b.score - a.score);
    // Keep memories with some signal (>0.25) to avoid injecting noise. When
    // nothing clears the bar, inject NOTHING: formatForPrompt heads this block
    // "treat them as authoritative", so an unrelated job's details handed over
    // as the best of a bad set are read as facts about the job in hand.
    return scored.filter(s => s.score > 0.25).slice(0, topK);
  }

  // Fallback: FTS5 keyword search
  try {
    const terms = searchTerms(q);
    if (terms.length > 0) {
      const rows = db.prepare(
        `SELECT m.id, m.content, m.category, m.source, m.confidence, bm25(user_memories_fts) AS score
         FROM user_memories_fts
         JOIN user_memories m ON m.id = user_memories_fts.memory_id
         WHERE user_memories_fts MATCH ? AND m.user_id = ? AND m.is_active = 1
         ORDER BY score LIMIT ?`
      ).all(terms.join(' OR '), userId, topK);
      // The MATCH is an OR, so one word in common is a hit — and across a
      // builder's jobs the word in common is "drawings". Ask for half the terms
      // the turn gave us, up to two: a short pointed question ("what's my
      // overheads figure") still lands, a long one has to agree on more than a
      // single word of trade vocabulary.
      const needed = Math.min(2, Math.ceil(terms.length / 2));
      const relevant = rows.filter(r => sharedTermCount(r.content, terms) >= needed);
      if (relevant.length > 0) {
        // bm25 returns negative scores (smaller = better); flip so higher is better
        return relevant.map(r => ({ ...r, score: -r.score }));
      }
    }
  } catch (e) { /* FTS may not be set up; fall through */ }

  // A query was asked and nothing matched it, semantically or by keyword: there is
  // no evidence any memory bears on this turn. Recency is not relevance, and the
  // most recent memories are the previous job's — returning them here is exactly
  // how one job's client and site end up asserted on the next one's bill.
  return [];
}

function markUsed(db, ids) {
  if (!ids || ids.length === 0) return;
  const stmt = db.prepare('UPDATE user_memories SET use_count = use_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?');
  for (const id of ids) { try { stmt.run(id); } catch (e) {} }
}

// Format a set of memories as a system-prompt block
function formatForPrompt(memories) {
  if (!memories || memories.length === 0) return '';
  const grouped = {};
  for (const m of memories) {
    const cat = m.category || 'general';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(m.content);
  }
  const lines = [];
  for (const [cat, items] of Object.entries(grouped)) {
    lines.push(`[${cat.toUpperCase()}]`);
    for (const it of items) lines.push(`  - ${it}`);
  }
  return `\n=== USER-VERIFIED MEMORY ===\nThese are facts and preferences the user has confirmed. Treat them as authoritative. If anything below contradicts a generic default, use the user's preference.\n\n${lines.join('\n')}\n===\n`;
}

// ── Project intake helpers ──────────────────────────────────────────────

function saveProjectIntake(db, { userId, sessionId, data }) {
  if (!userId) throw new Error('userId required');
  const payload = data || {};
  const existing = sessionId
    ? db.prepare('SELECT id FROM project_intake WHERE user_id = ? AND session_id = ? ORDER BY updated_at DESC LIMIT 1').get(userId, sessionId)
    : null;

  const extraJson = (() => {
    const known = new Set(['scope', 'floor_area_m2', 'project_type', 'location', 'spec_level', 'budget_range', 'timeline', 'notes']);
    const extras = {};
    for (const [k, v] of Object.entries(payload)) {
      if (!known.has(k) && v != null && v !== '') extras[k] = v;
    }
    return Object.keys(extras).length > 0 ? JSON.stringify(extras) : null;
  })();

  if (existing) {
    db.prepare(`UPDATE project_intake SET
      scope = ?, floor_area_m2 = ?, project_type = ?, location = ?, spec_level = ?,
      budget_range = ?, timeline = ?, notes = ?, extra_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(
      payload.scope || null,
      Number.isFinite(parseFloat(payload.floor_area_m2)) ? parseFloat(payload.floor_area_m2) : null,
      payload.project_type || null,
      payload.location || null,
      payload.spec_level || null,
      payload.budget_range || null,
      payload.timeline || null,
      payload.notes || null,
      extraJson,
      existing.id
    );
    return existing.id;
  }

  const id = 'pi_' + uuidv4().slice(0, 10);
  db.prepare(`INSERT INTO project_intake
    (id, user_id, session_id, scope, floor_area_m2, project_type, location, spec_level, budget_range, timeline, notes, extra_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, userId, sessionId || null,
    payload.scope || null,
    Number.isFinite(parseFloat(payload.floor_area_m2)) ? parseFloat(payload.floor_area_m2) : null,
    payload.project_type || null,
    payload.location || null,
    payload.spec_level || null,
    payload.budget_range || null,
    payload.timeline || null,
    payload.notes || null,
    extraJson
  );
  return id;
}

function getProjectIntake(db, { userId, sessionId }) {
  if (!sessionId) return null;
  return db.prepare('SELECT * FROM project_intake WHERE user_id = ? AND session_id = ? ORDER BY updated_at DESC LIMIT 1')
    .get(userId, sessionId);
}

function formatIntakeForPrompt(intake) {
  if (!intake) return '';
  const lines = [];
  if (intake.scope) lines.push(`Scope: ${intake.scope}`);
  if (intake.floor_area_m2) lines.push(`Floor area: ${intake.floor_area_m2} m²`);
  if (intake.project_type) lines.push(`Project type: ${intake.project_type}`);
  if (intake.location) lines.push(`Location: ${intake.location}`);
  if (intake.spec_level) lines.push(`Spec level: ${intake.spec_level}`);
  if (intake.budget_range) lines.push(`Budget range: ${intake.budget_range}`);
  if (intake.timeline) lines.push(`Timeline: ${intake.timeline}`);
  if (intake.notes) lines.push(`Additional notes: ${intake.notes}`);
  if (intake.extra_json) {
    try {
      const extras = JSON.parse(intake.extra_json);
      for (const [k, v] of Object.entries(extras)) lines.push(`${k.replace(/_/g, ' ')}: ${v}`);
    } catch (e) {}
  }
  if (lines.length === 0) return '';
  return `\n=== PROJECT INTAKE (user-confirmed at upload) ===\nThe user answered these fundamentals before uploading drawings. Use them as ground truth — do not second-guess the floor area, scope, or project type when these are present.\n\n${lines.join('\n')}\n===\n`;
}

module.exports = {
  VALID_CATEGORIES: Array.from(VALID_CATEGORIES),
  normaliseCategory,
  createMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  isDuplicate,
  retrieveRelevant,
  markUsed,
  formatForPrompt,
  saveProjectIntake,
  getProjectIntake,
  formatIntakeForPrompt,
};
