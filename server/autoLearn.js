// Always-on learning for the chat assistant.
//
// Two jobs, both designed to make the bot remember and learn like the
// claude.ai front-end:
//   1. extractAndStore()         — after every chat turn, pull durable facts /
//                                  preferences about the user and save them to
//                                  user_memories (semantic + FTS retrievable).
//                                  This replaces relying on the model to emit
//                                  [MEMORY|...] tags, which it does unreliably.
//   2. maybeSummariseConversation() + retrieveRelevantSummaries()
//                                — keep a rolling summary of each conversation
//                                  so earlier chats can be recalled in a brand
//                                  new session (cross-session memory).
//
// All model calls use Haiku (cheap/fast) and are best-effort: any failure is
// swallowed so the main chat flow is never affected.

const { v4: uuidv4 } = require('uuid');
const embeddings = require('./embeddings');
let memoryStore;
try { memoryStore = require('./memoryStore'); } catch (e) { memoryStore = null; }

const { callModel: callAnthropic, batchOne, MODELS } = require('./anthropicClient');
const MODEL = MODELS.FAST;

// ── schema (lazy, runs once) ────────────────────────────────────────────
let schemaReady = false;
function ensureSchema(db) {
  if (schemaReady) return;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT,
      title TEXT,
      summary TEXT NOT NULL,
      msg_count INTEGER DEFAULT 0,
      embedding BLOB,
      embedding_model TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_sum_user ON conversation_summaries(user_id)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_sum_session ON conversation_summaries(user_id, session_id)`);
    schemaReady = true;
  } catch (e) { console.error('[autoLearn] schema error:', e.message); }
}

// ── shared LLM helper ───────────────────────────────────────────────────
async function callModel(apiKey, system, userText, maxTokens = 600) {
  const req = {
    model: MODEL, apiKey, system, maxTokens,
    messages: [{ role: 'user', content: userText }],
    action: 'memory_learn',
  };
  // Background learning is not latency-sensitive — route through the 50%-cheaper
  // Batch API when USE_BATCH_API=1 (it polls, so off the interactive path only).
  const result = process.env.USE_BATCH_API === '1' ? await batchOne(req) : await callAnthropic(req);
  if (!result.ok) {
    const msg = result.error?.error?.message || result.error?.message || result.status;
    throw new Error(`LLM ${msg}`);
  }
  return (result.text || '').trim();
}

function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const firstArr = t.indexOf('['), firstObj = t.indexOf('{');
  const start = (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) ? firstArr : firstObj;
  if (start === -1) return null;
  const end = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
  if (end <= start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch (e) { return null; }
}

// ── 1. durable fact extraction ──────────────────────────────────────────
const EXTRACT_SYSTEM = `You extract durable, long-term memories about a user of a quantity-surveying / construction-estimating app, so the assistant can remember them in future conversations (a personal-assistant style memory).

From the conversation turn provided, extract ONLY facts that are:
- About the user, their company, their preferences, their standard ways of working, suppliers, rates, regions, project types, team, software/tooling, or recurring constraints.
- Durable and likely still useful weeks from now.

Do NOT extract:
- One-off questions, the specifics of a single drawing/project, transient numbers, or anything generic.
- Anything you are not confident is a stable preference or fact about the user.

Return a STRICT JSON array and nothing else. Each element:
{"category": <one of: profile, project_type, region, method_of_measurement, spec_preference, markup, contingency, supplier, exclusion, team, commercial, workflow, tooling, rate_note, general>, "content": "<concise third-person fact, max 160 chars>"}

If there is nothing worth remembering, return [].`;

async function extractAndStore(db, { userId, userMessage, assistantReply, sessionId, apiKey }) {
  if (!db || !userId || !apiKey || !memoryStore) return [];
  const msg = (userMessage || '').trim();
  if (msg.length < 12) return []; // skip trivial messages ("ok", "thanks")
  ensureSchema(db);

  const turn = `USER MESSAGE:\n${msg.slice(0, 4000)}\n\nASSISTANT REPLY (context only):\n${(assistantReply || '').slice(0, 1500)}`;
  const raw = await callModel(apiKey, EXTRACT_SYSTEM, turn, 600);
  const arr = parseJsonLoose(raw);
  if (!Array.isArray(arr) || arr.length === 0) return [];

  const created = [];
  for (const item of arr.slice(0, 6)) {
    const content = (item && item.content ? String(item.content) : '').trim();
    const category = item && item.category ? String(item.category) : 'general';
    if (content.length < 5 || content.length > 240) continue;
    try {
      if (memoryStore.isDuplicate(db, { userId, content })) continue;
      const rec = await memoryStore.createMemory(db, {
        userId, content, category, source: 'auto', confidence: 0.7, sessionId: sessionId || null,
      });
      created.push(rec);
    } catch (e) { /* skip this one, keep going */ }
  }
  return created;
}

// ── 2. rolling conversation summaries (cross-session recall) ─────────────
const SUMMARY_SYSTEM = `You write a concise memory note summarising a conversation between a user and a quantity-surveying assistant, so it can be recalled in FUTURE conversations.

Write 2-5 sentences, third person, focusing on: what the user was working on, key decisions or figures agreed, the user's stated preferences, and any open follow-ups. Be specific (project type, location, totals) but concise. Output plain text only — no preamble, no markdown.`;

function messagesToText(messages, limit = 24) {
  const recent = (messages || []).filter(m => m && m.content).slice(-limit);
  return recent.map(m => {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    let c = typeof m.content === 'string'
      ? m.content
      : (Array.isArray(m.content) ? m.content.map(x => (x && x.text) || '').join(' ') : '');
    return `${role}: ${String(c).slice(0, 1200)}`;
  }).join('\n');
}

async function maybeSummariseConversation(db, { userId, sessionId, title, messages, apiKey }) {
  if (!db || !userId || !sessionId || !apiKey) return null;
  ensureSchema(db);
  const count = (messages || []).filter(m => m && m.content).length;
  if (count < 4) return null;

  const existing = db.prepare('SELECT id, msg_count FROM conversation_summaries WHERE user_id = ? AND session_id = ?').get(userId, sessionId);
  // Throttle: only (re)summarise when at least 4 new messages since last time.
  if (existing && (count - (existing.msg_count || 0)) < 4) return null;

  const summary = await callModel(apiKey, SUMMARY_SYSTEM, messagesToText(messages), 400);
  if (!summary || summary.length < 10) return null;

  let blob = null, model = null;
  try {
    const vec = await embeddings.embed(summary, { inputType: 'document' });
    if (vec) { blob = embeddings.vectorToBlob(vec); model = embeddings.VOYAGE_MODEL; }
  } catch (e) { /* embeddings optional */ }

  const now = new Date().toISOString();
  if (existing) {
    db.prepare('UPDATE conversation_summaries SET title=?, summary=?, msg_count=?, embedding=?, embedding_model=?, updated_at=? WHERE id=?')
      .run(title || null, summary, count, blob, model, now, existing.id);
    return existing.id;
  }
  const id = 'conv_' + uuidv4().slice(0, 10);
  db.prepare('INSERT INTO conversation_summaries (id, user_id, session_id, title, summary, msg_count, embedding, embedding_model) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, userId, sessionId, title || null, summary, count, blob, model);
  return id;
}

// ── concise conversation title (like a chat app naming a thread) ─────────
const TITLE_SYSTEM = `Generate a very short, specific title for this conversation — 3 to 7 words, Title Case, no quotes, no surrounding punctuation. It should capture the actual subject (e.g. "Two-storey extension BOQ, Manchester" or "Hand-dig foundation pricing"). Output ONLY the title, nothing else.`;

async function generateTitle(messages, apiKey) {
  if (!apiKey || !messages || messages.length === 0) return null;
  let raw;
  try { raw = await callModel(apiKey, TITLE_SYSTEM, messagesToText(messages, 8), 30); }
  catch (e) { return null; }
  let t = (raw || '').split('\n')[0].trim().replace(/^["'#*\s-]+/, '').replace(/["'.\s]+$/, '');
  if (t.length < 2 || t.length > 70) return null;
  return t;
}

async function retrieveRelevantSummaries(db, { userId, query, excludeSessionId, topK = 3 }) {
  if (!db || !userId) return [];
  ensureSchema(db);
  let rows;
  try {
    rows = excludeSessionId
      ? db.prepare('SELECT id, session_id, title, summary, embedding, updated_at FROM conversation_summaries WHERE user_id = ? AND session_id != ?').all(userId, excludeSessionId)
      : db.prepare('SELECT id, session_id, title, summary, embedding, updated_at FROM conversation_summaries WHERE user_id = ?').all(userId);
  } catch (e) { return []; }
  if (!rows || rows.length === 0) return [];

  const q = (query || '').trim();
  let queryVec = null;
  if (q) { try { queryVec = await embeddings.embed(q, { inputType: 'query' }); } catch (e) {} }

  if (queryVec) {
    const scored = rows.map(r => {
      const vec = embeddings.blobToVector(r.embedding);
      const score = vec ? embeddings.cosineSimilarity(queryVec, vec) : 0;
      return { id: r.id, session_id: r.session_id, title: r.title, summary: r.summary, updated_at: r.updated_at, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const useful = scored.filter(s => s.score > 0.22);
    return (useful.length ? useful : scored).slice(0, topK);
  }
  // Fallback: most recent conversations.
  rows.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return rows.slice(0, topK).map(r => ({ id: r.id, session_id: r.session_id, title: r.title, summary: r.summary, updated_at: r.updated_at, score: 0 }));
}

function formatSummariesForPrompt(summaries) {
  if (!summaries || summaries.length === 0) return '';
  const lines = summaries.map(s => `- ${s.title ? '(' + String(s.title).slice(0, 50) + ') ' : ''}${s.summary}`);
  return `\n=== RELEVANT PAST CONVERSATIONS ===\nThese summarise earlier conversations with this user. Use them for continuity — refer back naturally when relevant, but do not assume details that are not stated here.\n\n${lines.join('\n')}\n===\n`;
}

function deleteForSession(db, { userId, sessionId }) {
  if (!db || !userId || !sessionId) return;
  try { db.prepare('DELETE FROM conversation_summaries WHERE user_id = ? AND session_id = ?').run(userId, sessionId); } catch (e) {}
}

module.exports = {
  ensureSchema,
  extractAndStore,
  maybeSummariseConversation,
  generateTitle,
  retrieveRelevantSummaries,
  formatSummariesForPrompt,
  deleteForSession,
};
