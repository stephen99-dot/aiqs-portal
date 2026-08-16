/**
 * superBrain.js — the Super Brain.
 *
 * One module that looks across every knowledge layer this app has grown —
 * the six memory layers in memoryEngine, user memories, playbooks, the
 * flywheel, entities and price evidence — and answers two questions:
 *
 *   1. "What does this brain know?"  → snapshot(db) — one structured picture
 *      of every layer, with counts, confidence and freshness, for the admin
 *      Super Brain dashboard.
 *   2. "What can it share?"          → exportPack(db) / importPack(db, pack) —
 *      an anonymised knowledge pack (learned rates, quantity benchmarks,
 *      co-occurrence patterns) exchanged with the sibling app, so AI QS and
 *      AI Trades Pilot learn from each other's confirmed jobs.
 *
 * Sharing rules, non-negotiable:
 *   - Aggregates only. Rates are weighted averages across users; no user_id,
 *     client name, entity, memory text or project identifier ever leaves.
 *   - Imported knowledge is stored in its own brain_shared_* tables, marked
 *     with the source app. It never writes into memory_rates or any table an
 *     existing pricing path reads, so no live price changes until a resolver
 *     explicitly opts in (that wiring is a later phase, gated by the evals).
 */

const crypto = require('crypto');

// Which app this brain lives in. The sibling's pack carries its own id, so the
// dashboard can say "learned from AI Trades Pilot" rather than "from a peer".
const APP_ID = process.env.SUPER_BRAIN_APP_ID || 'aiqs-portal';
const APP_LABELS = {
  'aiqs-portal': 'AI QS Portal',
  'aitradespilot': 'AI Trades Pilot',
};
const PACK_VERSION = 1;

// ─── SCHEMA ──────────────────────────────────────────────────────────────────

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_shared_rates (
      id TEXT PRIMARY KEY,
      source_app TEXT NOT NULL,
      item_key TEXT NOT NULL,
      region TEXT DEFAULT 'uk_average',
      project_type TEXT DEFAULT 'any',
      rate REAL NOT NULL,
      sample_count INTEGER DEFAULT 1,
      confidence REAL DEFAULT 0.5,
      imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_app, item_key, region, project_type)
    );
    CREATE INDEX IF NOT EXISTS idx_brain_shared_rates_key
      ON brain_shared_rates(item_key, region, project_type);

    CREATE TABLE IF NOT EXISTS brain_shared_quantities (
      id TEXT PRIMARY KEY,
      source_app TEXT NOT NULL,
      project_type TEXT NOT NULL,
      item_key TEXT NOT NULL,
      unit TEXT,
      avg_qty_per_m2 REAL,
      sample_count INTEGER DEFAULT 1,
      imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_app, project_type, item_key)
    );

    CREATE TABLE IF NOT EXISTS brain_shared_patterns (
      id TEXT PRIMARY KEY,
      source_app TEXT NOT NULL,
      item_key_a TEXT NOT NULL,
      item_key_b TEXT NOT NULL,
      project_type TEXT DEFAULT 'any',
      co_occurrence_count INTEGER DEFAULT 1,
      imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_app, item_key_a, item_key_b, project_type)
    );

    CREATE TABLE IF NOT EXISTS brain_sync_log (
      id TEXT PRIMARY KEY,
      direction TEXT NOT NULL,            -- 'in' (imported a pack) or 'out' (served our pack)
      peer_app TEXT,
      rates_count INTEGER DEFAULT 0,
      quantities_count INTEGER DEFAULT 0,
      patterns_count INTEGER DEFAULT 0,
      via TEXT,                           -- 'pull', 'manual', 'served'
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Every layer read is wrapped: a missing table (the Trades Pilot has no
// entities or price_evidence yet) reports as absent, not as a crash.
function safe(fn, fallback = null) {
  try { return fn(); } catch (e) { return fallback; }
}

// ─── SNAPSHOT — what does this brain know? ───────────────────────────────────

function snapshot(db) {
  const layers = [];
  const layer = (key, label, description, row) => {
    if (row) layers.push({ key, label, description, ...row });
  };

  layer('rates', 'Learned Rates', 'Unit rates learned from confirmed BOQs and corrections, per region and project type.',
    safe(() => db.prepare(`
      SELECT COUNT(*) AS count, SUM(sample_count) AS samples,
             ROUND(AVG(confidence),3) AS avg_confidence, MAX(last_seen) AS last_activity
      FROM memory_rates`).get()));

  layer('quantities', 'Quantity Benchmarks', 'Typical quantities per m² for each element, from confirmed take-offs.',
    safe(() => db.prepare(`
      SELECT COUNT(*) AS count, COUNT(DISTINCT project_type) AS project_types,
             COUNT(DISTINCT item_key) AS distinct_items, MAX(created_at) AS last_activity
      FROM memory_quantities WHERE confirmed = 1`).get()));

  layer('projects', 'Project Benchmarks', 'Whole-project cost benchmarks (£/m², sections, contingency) from confirmed jobs.',
    safe(() => db.prepare(`
      SELECT COUNT(*) AS count, COUNT(DISTINCT project_type) AS project_types,
             MAX(created_at) AS last_activity
      FROM memory_projects WHERE confirmed = 1`).get()));

  layer('corrections', 'Corrections', 'Explicit human corrections with reasons — the strongest learning signal.',
    safe(() => db.prepare(`
      SELECT COUNT(*) AS count, MAX(created_at) AS last_activity FROM memory_corrections`).get()));

  layer('patterns', 'Scope Patterns', 'Co-occurrence patterns: if a job has X, it usually needs Y.',
    safe(() => db.prepare(`
      SELECT COUNT(*) AS count, MAX(created_at) AS last_activity FROM memory_patterns`).get()));

  layer('client_profiles', 'Client Profiles', 'Per-account preferences: spec level, regions, contingency and OH&P habits.',
    safe(() => db.prepare(`
      SELECT COUNT(*) AS count, MAX(updated_at) AS last_activity FROM memory_client_profile`).get()));

  layer('user_memories', 'User Memories', 'Facts users have told the AI, or it inferred, about how they work.',
    safe(() => db.prepare(`
      SELECT COUNT(*) AS count, COUNT(DISTINCT user_id) AS users, MAX(updated_at) AS last_activity
      FROM user_memories WHERE is_active = 1`).get()));

  layer('playbooks', 'Playbooks', 'Per-client working playbooks the chat consults before drafting.',
    safe(() => db.prepare(`
      SELECT COUNT(*) AS count, MAX(updated_at) AS last_activity FROM client_playbooks`).get()));

  layer('flywheel', 'Correction Flywheel', 'Diffs between AI drafts and human-fixed versions, promoted into eval fixtures.',
    safe(() => db.prepare(`
      SELECT COUNT(*) AS count, MAX(created_at) AS last_activity FROM correction_diffs`).get()));

  layer('entities', 'People & Firms', 'Builders, clients, architects and subbies the system has met, with facts and history.',
    safe(() => db.prepare(`
      SELECT (SELECT COUNT(*) FROM entities) AS count,
             (SELECT COUNT(*) FROM entity_facts) AS facts,
             (SELECT MAX(created_at) FROM entities) AS last_activity`).get()));

  layer('price_evidence', 'Price Evidence', 'Append-only log of every price observation, with provenance.',
    safe(() => db.prepare(`
      SELECT COUNT(*) AS count, COUNT(DISTINCT source) AS sources, MAX(observed_at) AS last_activity
      FROM price_evidence`).get()));

  // The shared layer — what the sibling app has taught this one.
  const shared = safe(() => db.prepare(`
    SELECT s.source_app,
           (SELECT COUNT(*) FROM brain_shared_rates WHERE source_app = s.source_app) AS rates,
           (SELECT COUNT(*) FROM brain_shared_quantities WHERE source_app = s.source_app) AS quantities,
           (SELECT COUNT(*) FROM brain_shared_patterns WHERE source_app = s.source_app) AS patterns,
           (SELECT MAX(imported_at) FROM brain_shared_rates WHERE source_app = s.source_app) AS imported_at
    FROM (SELECT source_app FROM brain_shared_rates
          UNION SELECT source_app FROM brain_shared_quantities
          UNION SELECT source_app FROM brain_shared_patterns) s`).all(), []) || [];

  const lastSync = safe(() => db.prepare(`
    SELECT direction, peer_app, rates_count, quantities_count, patterns_count, via, created_at
    FROM brain_sync_log ORDER BY created_at DESC LIMIT 1`).get());

  const syncHistory = safe(() => db.prepare(`
    SELECT direction, peer_app, rates_count, quantities_count, patterns_count, via, created_at
    FROM brain_sync_log ORDER BY created_at DESC LIMIT 10`).all(), []) || [];

  // A feed of the freshest learnings, so the dashboard shows the brain moving.
  const recent = [];
  for (const r of safe(() => db.prepare(`
    SELECT item_key, region, rate, sample_count, last_seen FROM memory_rates
    ORDER BY last_seen DESC LIMIT 6`).all(), []) || []) {
    recent.push({
      kind: 'rate',
      at: r.last_seen,
      text: `Learned ${r.item_key.replace(/_/g, ' ')} at £${Number(r.rate).toFixed(2)} (${r.region.replace(/_/g, ' ')}, ${r.sample_count} sample${r.sample_count === 1 ? '' : 's'})`,
    });
  }
  for (const c of safe(() => db.prepare(`
    SELECT item_key, field, old_value, new_value, reason, created_at FROM memory_corrections
    ORDER BY created_at DESC LIMIT 6`).all(), []) || []) {
    recent.push({
      kind: 'correction',
      at: c.created_at,
      text: `Correction on ${(c.item_key || 'item').replace(/_/g, ' ')}: ${c.field} ${c.old_value ?? '?'} → ${c.new_value ?? '?'}${c.reason ? ` (${c.reason})` : ''}`,
    });
  }
  recent.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  const totalKnowledge = layers.reduce((s, l) => s + (l.count || 0), 0)
    + shared.reduce((s, r) => s + (r.rates || 0) + (r.quantities || 0) + (r.patterns || 0), 0);

  return {
    app: APP_ID,
    appLabel: APP_LABELS[APP_ID] || APP_ID,
    generatedAt: new Date().toISOString(),
    totalKnowledge,
    layers,
    shared,
    lastSync,
    syncHistory,
    recentLearnings: recent.slice(0, 10),
    peerConfigured: !!process.env.SUPER_BRAIN_PEER_URL,
  };
}

// ─── EXPORT — the anonymised knowledge pack ──────────────────────────────────

function exportPack(db) {
  // Weighted average across every account's learned rates. Grouping without
  // user_id is the anonymisation: what leaves is "brick walls run ~£247/m²
  // in the south east across 14 samples", never whose jobs taught us that.
  const rates = safe(() => db.prepare(`
    SELECT item_key, region, project_type,
           ROUND(SUM(rate * sample_count) / SUM(sample_count), 2) AS rate,
           SUM(sample_count) AS sample_count,
           ROUND(AVG(confidence), 3) AS confidence
    FROM memory_rates
    WHERE rate > 0 AND sample_count > 0
    GROUP BY item_key, region, project_type`).all(), []) || [];

  const quantities = safe(() => db.prepare(`
    SELECT project_type, item_key, unit,
           ROUND(AVG(qty_per_m2), 4) AS avg_qty_per_m2,
           COUNT(*) AS sample_count
    FROM memory_quantities
    WHERE confirmed = 1 AND qty_per_m2 IS NOT NULL AND qty_per_m2 > 0
    GROUP BY project_type, item_key, unit`).all(), []) || [];

  const patterns = safe(() => db.prepare(`
    SELECT item_key_a, item_key_b, project_type, SUM(co_occurrence_count) AS co_occurrence_count
    FROM memory_patterns
    GROUP BY item_key_a, item_key_b, project_type`).all(), []) || [];

  return {
    version: PACK_VERSION,
    source: APP_ID,
    sourceLabel: APP_LABELS[APP_ID] || APP_ID,
    generatedAt: new Date().toISOString(),
    counts: { rates: rates.length, quantities: quantities.length, patterns: patterns.length },
    rates,
    quantities,
    patterns,
  };
}

// ─── IMPORT — merge a sibling's pack into the shared layer ───────────────────

function importPack(db, pack, { via = 'manual' } = {}) {
  if (!pack || typeof pack !== 'object') throw new Error('Not a knowledge pack');
  if (pack.version !== PACK_VERSION) throw new Error(`Unsupported pack version: ${pack.version}`);
  const source = String(pack.source || '').trim();
  if (!source) throw new Error('Pack has no source app');
  if (source === APP_ID) {
    throw new Error(
      'Refusing to import a pack from this same app — the peer returned ' + APP_ID + "'s own knowledge. " +
      "SUPER_BRAIN_PEER_URL is almost certainly pointing at this app itself; set it to the sibling app's URL."
    );
  }

  ensureSchema(db);

  const rates = Array.isArray(pack.rates) ? pack.rates : [];
  const quantities = Array.isArray(pack.quantities) ? pack.quantities : [];
  const patterns = Array.isArray(pack.patterns) ? pack.patterns : [];

  const importAll = db.transaction(() => {
    // Replace, don't accumulate: each sync is a fresh photograph of the
    // peer's aggregate knowledge, so stale rows must not linger.
    db.prepare('DELETE FROM brain_shared_rates WHERE source_app = ?').run(source);
    db.prepare('DELETE FROM brain_shared_quantities WHERE source_app = ?').run(source);
    db.prepare('DELETE FROM brain_shared_patterns WHERE source_app = ?').run(source);

    const insRate = db.prepare(`
      INSERT OR REPLACE INTO brain_shared_rates
        (id, source_app, item_key, region, project_type, rate, sample_count, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    let nRates = 0;
    for (const r of rates) {
      const rate = Number(r.rate);
      if (!r.item_key || !Number.isFinite(rate) || rate <= 0) continue;
      insRate.run(crypto.randomUUID(), source, String(r.item_key), String(r.region || 'uk_average'),
        String(r.project_type || 'any'), rate, Number(r.sample_count) || 1,
        Math.min(1, Math.max(0, Number(r.confidence) || 0.5)));
      nRates++;
    }

    const insQty = db.prepare(`
      INSERT OR REPLACE INTO brain_shared_quantities
        (id, source_app, project_type, item_key, unit, avg_qty_per_m2, sample_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    let nQty = 0;
    for (const q of quantities) {
      const v = Number(q.avg_qty_per_m2);
      if (!q.item_key || !q.project_type || !Number.isFinite(v) || v <= 0) continue;
      insQty.run(crypto.randomUUID(), source, String(q.project_type), String(q.item_key),
        q.unit ? String(q.unit) : null, v, Number(q.sample_count) || 1);
      nQty++;
    }

    const insPat = db.prepare(`
      INSERT OR REPLACE INTO brain_shared_patterns
        (id, source_app, item_key_a, item_key_b, project_type, co_occurrence_count)
      VALUES (?, ?, ?, ?, ?, ?)`);
    let nPat = 0;
    for (const p of patterns) {
      if (!p.item_key_a || !p.item_key_b) continue;
      insPat.run(crypto.randomUUID(), source, String(p.item_key_a), String(p.item_key_b),
        String(p.project_type || 'any'), Number(p.co_occurrence_count) || 1);
      nPat++;
    }

    db.prepare(`
      INSERT INTO brain_sync_log (id, direction, peer_app, rates_count, quantities_count, patterns_count, via)
      VALUES (?, 'in', ?, ?, ?, ?, ?)`)
      .run(crypto.randomUUID(), source, nRates, nQty, nPat, via);

    return { rates: nRates, quantities: nQty, patterns: nPat };
  });

  return { source, imported: importAll() };
}

function logServed(db, { peerApp } = {}) {
  safe(() => db.prepare(`
    INSERT INTO brain_sync_log (id, direction, peer_app, via) VALUES (?, 'out', ?, 'served')`)
    .run(crypto.randomUUID(), peerApp || null));
}

// ─── RECALL — advisory lookup into the shared layer ──────────────────────────
//
// Deliberately advisory: consumers (chat tools, resolvers) may cite what the
// sibling app has seen, but nothing prices off this without its own gate.

function recallSharedRate(db, { itemKey, region = 'uk_average', projectType = 'any' } = {}) {
  if (!itemKey) return [];
  return safe(() => db.prepare(`
    SELECT source_app, item_key, region, project_type, rate, sample_count, confidence
    FROM brain_shared_rates
    WHERE item_key = ?
    ORDER BY
      (region = ?) DESC,
      (project_type = ?) DESC,
      sample_count DESC
    LIMIT 5`).all(String(itemKey), String(region), String(projectType)), []) || [];
}

// Prompt block for the chat/agent: what the sibling app has seen that is
// relevant to this job. Advisory by construction — the wording instructs the
// model to cite and sanity-check with it, never to price from it, so local
// learned rates and the pricer's fixed rates keep precedence.
function formatSharedKnowledgeForPrompt(db, { region = 'uk_average', projectType = 'any', limit = 18 } = {}) {
  const rates = safe(() => db.prepare(`
    SELECT source_app, item_key, region, project_type, rate, sample_count, confidence
    FROM brain_shared_rates
    WHERE region IN (?, 'uk_average') AND project_type IN (?, 'any')
    ORDER BY (region = ?) DESC, (project_type = ?) DESC, sample_count DESC
    LIMIT ?`).all(String(region), String(projectType), String(region), String(projectType), limit), []) || [];
  if (rates.length === 0) return '';

  const patterns = safe(() => db.prepare(`
    SELECT item_key_a, item_key_b, co_occurrence_count
    FROM brain_shared_patterns
    WHERE project_type IN (?, 'any')
    ORDER BY co_occurrence_count DESC LIMIT 5`).all(String(projectType)), []) || [];

  const sources = [...new Set(rates.map(r => APP_LABELS[r.source_app] || r.source_app))].join(', ');
  const lines = rates.map(r =>
    `  ${r.item_key}: ~£${Number(r.rate).toFixed(2)} (${r.region}, ${r.project_type}, n=${r.sample_count}, conf ${Math.round((r.confidence || 0) * 100)}%)`
  ).join('\n');
  const patternLines = patterns.length > 0
    ? '\nScope patterns the sibling app has seen (jobs with A usually also need B):\n'
      + patterns.map(p => `  ${p.item_key_a} → ${p.item_key_b} (${p.co_occurrence_count}×)`).join('\n')
    : '';

  return `=== CROSS-APP ADVISORY — learned by ${sources} (cite only, NEVER price from this) ===
Anonymised aggregates from the sibling app's confirmed jobs. Use them to
sanity-check your figures or to cite ("the ${sources} side has seen this at
~£X"). If one of these disagrees with a local learned rate or a fixed rate,
the local rate ALWAYS wins — mention the difference, do not adopt it.
${lines}${patternLines}
===`;
}

module.exports = {
  APP_ID,
  APP_LABELS,
  PACK_VERSION,
  ensureSchema,
  snapshot,
  exportPack,
  importPack,
  logServed,
  recallSharedRate,
  formatSharedKnowledgeForPrompt,
};
