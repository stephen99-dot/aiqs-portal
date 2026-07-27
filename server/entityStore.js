/**
 * entityStore.js — the *who* half of the pricing brain.
 *
 * Phase 1 built evidence about things: what a square metre of facing brick costs. This is
 * evidence about people. Which end client, which subbie, which architect, which gang. The
 * same job priced for two different builders, drawn by two different architects and built
 * by two different gangs is genuinely two different prices, and today nothing in the
 * portal can tell them apart.
 *
 * Person-shaped data already exists in four disconnected places and nothing learns from
 * any of it: memory_client_profile (keyed on the portal user, knows nobody else),
 * estimator_clients (name/email/phone, entirely inert), schedule_time_entries.worker
 * (free text, written on every site update, never read) and suppliers (global, not
 * per-builder). There is no record at all for subcontractors, architects or engineers.
 *
 * ── The governance constraints are not optional ──────────────────────────────────
 *
 * This table holds personal data about named individuals, and some of it amounts to a
 * performance judgement about a named subcontractor. So:
 *
 *   1. HARD TENANT SCOPE. Every row carries user_id and every read filters on it. Not by
 *      convention — every exported reader takes userId and throws without one, because a
 *      convention is something you can forget at 2am. Anonymised *rates* crossing tenants
 *      is defensible; *entity* data crossing tenants is not.
 *   2. FACTS EXPIRE. valid_from / valid_to exist so a two-year-old judgement about a gang
 *      stops quietly colouring today's job.
 *   3. VISIBLE AND CORRECTABLE. Everything here is exposed on the AI Memory page. If the
 *      system believes something about a named person, the builder can see it, disagree
 *      and overrule it.
 *   4. NOTHING HERE MOVES A PRICE. Not in this phase. Deriving priced adjustments from
 *      these records is Phase 5, deliberately separate so a wrong prior cannot skew a
 *      quote before anyone has looked at the data.
 *
 * No entity_priors table yet: it belongs with the Phase 5 logic that fills it, and an
 * empty table nothing writes is dead schema.
 */

const crypto = require('crypto');

const KINDS = [
  'customer', 'end_client', 'subcontractor', 'supplier', 'architect',
  'engineer', 'building_control', 'crew_member', 'site_manager',
];

// Suffixes stripped when normalising a name for matching, so "Mullan Groundworks Ltd"
// and "Mullan Groundworks" collide. Kept deliberately short — over-stripping merges
// genuinely different firms.
const COMPANY_SUFFIXES = /\b(ltd|limited|llp|plc|inc|co|company|holdings|group|services|contractors|construction|builders|building)\b/g;

function initEntityTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      display_name TEXT NOT NULL,
      normalised_name TEXT NOT NULL,
      external_refs TEXT,
      embedding BLOB,
      embedding_model TEXT,
      merged_into TEXT,
      source TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entity_facts (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      category TEXT,
      content TEXT NOT NULL,
      confidence REAL DEFAULT 0.7,
      source TEXT,
      source_ref TEXT,
      valid_from TEXT DEFAULT CURRENT_TIMESTAMP,
      valid_to TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entity_events (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      job_id TEXT,
      event_type TEXT NOT NULL,
      payload TEXT,
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entity_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      from_entity_id TEXT NOT NULL,
      to_entity_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      strength REAL DEFAULT 1,
      first_seen TEXT DEFAULT CURRENT_TIMESTAMP,
      last_seen TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- A name the builder was asked about and declined. Without this the same passing
    -- mention gets re-proposed every single turn, which is the annoyance that kills
    -- this kind of feature.
    CREATE TABLE IF NOT EXISTS entity_declines (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      normalised_name TEXT NOT NULL,
      declined_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_entities_user      ON entities (user_id, kind);
    CREATE INDEX IF NOT EXISTS idx_entities_norm      ON entities (user_id, normalised_name);
    CREATE INDEX IF NOT EXISTS idx_entity_facts_ent   ON entity_facts (entity_id);
    CREATE INDEX IF NOT EXISTS idx_entity_events_ent  ON entity_events (entity_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_entity_links_from  ON entity_links (from_entity_id);
    CREATE INDEX IF NOT EXISTS idx_entity_declines    ON entity_declines (user_id, normalised_name);
  `);
}

/**
 * Fold a messy human-entered name to a matching key.
 *
 * "Mullan Groundworks Ltd.", "MULLAN GROUNDWORKS" and "mullan  groundworks" all have to
 * land on the same string, without folding so hard that two real firms collide.
 */
function normaliseName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,'"()]/g, '')
    // 'and' is a stopword, not a word. Two reasons: it makes "Kerr & Co Architects Ltd"
    // and "Kerr Architects" land on the same key, which is nearly always the same
    // practice; and without it a bare "&" expands to " and " and would otherwise be
    // stored as an entity literally named "and".
    .replace(/\b(the|a|and)\b/g, ' ')
    .replace(COMPANY_SUFFIXES, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Every reader goes through this. A missing userId is a programming error, not an empty
// result — returning [] would hide the bug until it leaked another builder's data.
function requireUser(userId, fn) {
  if (!userId) throw new Error(`entityStore.${fn}: userId is required`);
  return userId;
}

function newId(prefix, parts) {
  return prefix + '_' + crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 20);
}

// ── entities ──────────────────────────────────────────────────────────────────

/**
 * Create an entity, or return the existing one for this builder with the same
 * normalised name and kind. Idempotent by construction, so a backfill can re-run.
 */
function upsertEntity(db, { userId, kind, displayName, externalRefs, source }) {
  requireUser(userId, 'upsertEntity');
  if (!displayName || !String(displayName).trim()) throw new Error('entityStore.upsertEntity: displayName is required');
  if (!KINDS.includes(kind)) throw new Error(`entityStore.upsertEntity: unknown kind "${kind}"`);

  const normalised = normaliseName(displayName);
  if (!normalised) throw new Error('entityStore.upsertEntity: name normalises to nothing');

  const existing = db.prepare(
    'SELECT * FROM entities WHERE user_id = ? AND normalised_name = ? AND kind = ? AND merged_into IS NULL'
  ).get(userId, normalised, kind);
  if (existing) return { entity: existing, created: false };

  const id = newId('ent', [userId, kind, normalised]);
  db.prepare(`
    INSERT OR IGNORE INTO entities (id, user_id, kind, display_name, normalised_name, external_refs, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, kind, String(displayName).trim(), normalised,
         externalRefs ? JSON.stringify(externalRefs) : null, source || 'manual');

  return { entity: db.prepare('SELECT * FROM entities WHERE id = ?').get(id), created: true };
}

function getEntity(db, { userId, id }) {
  requireUser(userId, 'getEntity');
  return db.prepare('SELECT * FROM entities WHERE id = ? AND user_id = ?').get(id, userId) || null;
}

function listEntities(db, { userId, kind = null, includeMerged = false } = {}) {
  requireUser(userId, 'listEntities');
  return db.prepare(`
    SELECT * FROM entities
    WHERE user_id = ?
      AND (? IS NULL OR kind = ?)
      AND (? = 1 OR merged_into IS NULL)
    ORDER BY kind ASC, display_name ASC
  `).all(userId, kind, kind, includeMerged ? 1 : 0);
}

/** Rename, recomputing the match key so the new name is findable. */
function renameEntity(db, { userId, id, displayName }) {
  requireUser(userId, 'renameEntity');
  const normalised = normaliseName(displayName);
  if (!normalised) throw new Error('entityStore.renameEntity: name normalises to nothing');
  const r = db.prepare(`
    UPDATE entities SET display_name = ?, normalised_name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(String(displayName).trim(), normalised, id, userId);
  return r.changes > 0;
}

/**
 * Soft-merge duplicates: point the loser at the winner and move its facts and events
 * across. Soft rather than destructive because merges are a judgement call and get made
 * wrong — the loser row survives so the decision is auditable.
 */
function mergeEntities(db, { userId, fromId, intoId }) {
  requireUser(userId, 'mergeEntities');
  if (fromId === intoId) throw new Error('entityStore.mergeEntities: cannot merge an entity into itself');
  const from = getEntity(db, { userId, id: fromId });
  const into = getEntity(db, { userId, id: intoId });
  if (!from || !into) return false;

  db.transaction(() => {
    db.prepare('UPDATE entity_facts  SET entity_id = ? WHERE entity_id = ? AND user_id = ?').run(intoId, fromId, userId);
    db.prepare('UPDATE entity_events SET entity_id = ? WHERE entity_id = ? AND user_id = ?').run(intoId, fromId, userId);
    db.prepare('UPDATE entity_links  SET from_entity_id = ? WHERE from_entity_id = ? AND user_id = ?').run(intoId, fromId, userId);
    db.prepare('UPDATE entity_links  SET to_entity_id   = ? WHERE to_entity_id   = ? AND user_id = ?').run(intoId, fromId, userId);
    db.prepare('UPDATE entities SET merged_into = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(intoId, fromId, userId);
  })();
  return true;
}

/** Hard delete, with everything hanging off it. This is the GDPR erase path. */
function deleteEntity(db, { userId, id }) {
  requireUser(userId, 'deleteEntity');
  const found = getEntity(db, { userId, id });
  if (!found) return false;
  db.transaction(() => {
    db.prepare('DELETE FROM entity_facts  WHERE entity_id = ? AND user_id = ?').run(id, userId);
    db.prepare('DELETE FROM entity_events WHERE entity_id = ? AND user_id = ?').run(id, userId);
    db.prepare('DELETE FROM entity_links  WHERE (from_entity_id = ? OR to_entity_id = ?) AND user_id = ?').run(id, id, userId);
    db.prepare('UPDATE entities SET merged_into = NULL WHERE merged_into = ? AND user_id = ?').run(id, userId);
    db.prepare('DELETE FROM entities WHERE id = ? AND user_id = ?').run(id, userId);
  })();
  return true;
}

// ── facts ─────────────────────────────────────────────────────────────────────

function addFact(db, { userId, entityId, content, category, confidence, source, sourceRef }) {
  requireUser(userId, 'addFact');
  if (!getEntity(db, { userId, id: entityId })) throw new Error('entityStore.addFact: unknown entity for this user');
  if (!content || !String(content).trim()) throw new Error('entityStore.addFact: content is required');
  const id = newId('efact', [userId, entityId, String(content).trim().toLowerCase()]);
  db.prepare(`
    INSERT OR IGNORE INTO entity_facts (id, entity_id, user_id, category, content, confidence, source, source_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, entityId, userId, category || 'general', String(content).trim(),
         confidence == null ? 0.7 : confidence, source || 'manual', sourceRef || null);
  return db.prepare('SELECT * FROM entity_facts WHERE id = ?').get(id);
}

/** Live facts only — anything with valid_to in the past has expired and stays quiet. */
function listFacts(db, { userId, entityId, includeExpired = false } = {}) {
  requireUser(userId, 'listFacts');
  return db.prepare(`
    SELECT * FROM entity_facts
    WHERE user_id = ? AND entity_id = ?
      AND (? = 1 OR valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP)
    ORDER BY confidence DESC, created_at DESC
  `).all(userId, entityId, includeExpired ? 1 : 0);
}

/** Expire rather than delete: that a thing was once believed is itself worth keeping. */
function expireFact(db, { userId, id }) {
  requireUser(userId, 'expireFact');
  return db.prepare(
    'UPDATE entity_facts SET valid_to = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND valid_to IS NULL'
  ).run(id, userId).changes > 0;
}

function deleteFact(db, { userId, id }) {
  requireUser(userId, 'deleteFact');
  return db.prepare('DELETE FROM entity_facts WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

// ── events ────────────────────────────────────────────────────────────────────

function addEvent(db, { userId, entityId, eventType, jobId, payload, occurredAt }) {
  requireUser(userId, 'addEvent');
  if (!getEntity(db, { userId, id: entityId })) throw new Error('entityStore.addEvent: unknown entity for this user');
  const when = occurredAt || new Date().toISOString();
  const body = payload ? JSON.stringify(payload) : null;
  // Content-addressed so replaying the same job's history does not multiply its events.
  // The payload is part of the key, for the same reason price_evidence hashes its value:
  // an identical event collides and is ignored, while the same event carrying genuinely
  // different detail is a new record rather than a silent overwrite of the old one.
  const id = newId('eevt', [userId, entityId, eventType, jobId || '', when, body || '']);
  db.prepare(`
    INSERT OR IGNORE INTO entity_events (id, entity_id, user_id, job_id, event_type, payload, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, entityId, userId, jobId || null, eventType, body, when);
  return db.prepare('SELECT * FROM entity_events WHERE id = ?').get(id);
}

function listEvents(db, { userId, entityId, limit = 50 } = {}) {
  requireUser(userId, 'listEvents');
  return db.prepare(
    'SELECT * FROM entity_events WHERE user_id = ? AND entity_id = ? ORDER BY occurred_at DESC LIMIT ?'
  ).all(userId, entityId, limit);
}

// ── declines ──────────────────────────────────────────────────────────────────

function recordDecline(db, { userId, name }) {
  requireUser(userId, 'recordDecline');
  const normalised = normaliseName(name);
  if (!normalised) return false;
  db.prepare('INSERT OR IGNORE INTO entity_declines (id, user_id, normalised_name) VALUES (?, ?, ?)')
    .run(newId('edec', [userId, normalised]), userId, normalised);
  return true;
}

function isDeclined(db, { userId, name }) {
  requireUser(userId, 'isDeclined');
  const normalised = normaliseName(name);
  if (!normalised) return false;
  return Boolean(db.prepare(
    'SELECT 1 FROM entity_declines WHERE user_id = ? AND normalised_name = ?'
  ).get(userId, normalised));
}

// ── backfill ──────────────────────────────────────────────────────────────────

/**
 * Seed end_client entities from estimator_clients — a real record the builder already
 * created, so it needs no confirmation. Idempotent via upsertEntity.
 *
 * schedule_time_entries.worker is deliberately NOT backfilled here: it is 120 chars of
 * free text and turning it into named crew_member records is a judgement the builder
 * should make once, on screen, rather than something that happens to them on boot.
 */
function backfillFromClients(db, { userId = null } = {}) {
  initEntityTables(db);
  const stats = { created: 0, existing: 0, skipped: 0 };
  try {
    const rows = userId
      ? db.prepare('SELECT * FROM estimator_clients WHERE user_id = ?').all(userId)
      : db.prepare('SELECT * FROM estimator_clients').all();
    for (const r of rows) {
      if (!r.user_id || !r.name || !normaliseName(r.name)) { stats.skipped++; continue; }
      const refs = {};
      if (r.email) refs.email = r.email;
      if (r.phone) refs.phone = r.phone;
      if (r.address) refs.address = r.address;
      const { created } = upsertEntity(db, {
        userId: r.user_id,
        kind: 'end_client',
        displayName: r.name,
        externalRefs: Object.keys(refs).length ? refs : null,
        source: 'estimator_clients',
      });
      created ? stats.created++ : stats.existing++;
    }
  } catch (e) {
    console.error('[Entities] backfillFromClients failed:', e.message);
    stats.error = e.message;
  }
  return stats;
}

function summary(db, { userId } = {}) {
  requireUser(userId, 'summary');
  try {
    return {
      total: db.prepare('SELECT COUNT(*) c FROM entities WHERE user_id = ? AND merged_into IS NULL').get(userId).c,
      by_kind: db.prepare(`
        SELECT kind, COUNT(*) AS n FROM entities
        WHERE user_id = ? AND merged_into IS NULL GROUP BY kind ORDER BY n DESC
      `).all(userId),
      facts: db.prepare('SELECT COUNT(*) c FROM entity_facts WHERE user_id = ?').get(userId).c,
    };
  } catch (e) {
    console.error('[Entities] summary failed:', e.message);
    return { total: 0, by_kind: [], facts: 0, error: e.message };
  }
}

module.exports = {
  KINDS,
  initEntityTables,
  normaliseName,
  upsertEntity,
  getEntity,
  listEntities,
  renameEntity,
  mergeEntities,
  deleteEntity,
  addFact,
  listFacts,
  expireFact,
  deleteFact,
  addEvent,
  listEvents,
  recordDecline,
  isDeclined,
  backfillFromClients,
  summary,
};
