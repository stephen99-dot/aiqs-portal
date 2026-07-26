/**
 * priceEvidence.js — the append-only log every rate observation writes into.
 *
 * The portal's rate data currently lives in four places that disagree: BASE_RATES in
 * deterministicPricer, the seeded `rates` table, per-builder `client_rate_library`, and
 * the learned `memory_rates`. Nothing can reconcile them because there is no common
 * shape to reconcile them INTO. This is that shape.
 *
 * The design intent is that rates become DERIVED rather than stored: every source
 * appends its observations here with a weight and a provenance ref, and a resolver reads
 * across them. Phase 1 builds the store and backfills it from all four existing sources.
 * It does not yet price from it — rung 3 (own-history median) needs the historic-job
 * importer to have anything worth reading, and that is a later phase. What this phase
 * proves is that the store is populated, queryable and idempotent.
 *
 * Schema notes where this departs from the original sketch:
 *
 *   - `user_id` is present and nullable. The sketch omitted it, but client-library and
 *     own-history observations are specific to one builder, and rung 3 has to be able to
 *     ask "MY median for this key". NULL means the observation is not builder-specific
 *     (the base library, a published rate book). Anonymised rates crossing tenants is
 *     defensible; silently losing whose rate it was is not.
 *   - no `embedding` column yet. Nothing does semantic lookup until the analogue rung
 *     lands, and an unused BLOB per row is just weight.
 *   - `cost_indices`, `labour_gang_rates` and `rate_recipes` are deliberately NOT created
 *     here. They belong to the phases that read them. `CREATE TABLE IF NOT EXISTS` runs
 *     every boot, so adding them later is identical work to adding them now, and three
 *     empty tables nothing queries is just dead schema.
 */

const crypto = require('crypto');

// Weight per source class — how much this kind of observation should count when several
// disagree. Deliberately in ONE place so the weighting is tunable and auditable rather
// than scattered through query code.
//
// The ordering is the argument: what a job actually cost beats what someone quoted,
// which beats a generic library figure, which beats a model's guess. Nothing here can
// promote on its own — that rule lives with the promotion logic in a later phase, and
// model_estimate is capped low precisely so the system cannot start learning from its
// own output.
const SOURCE_WEIGHTS = {
  final_account:   1.00,   // what the job actually cost
  invoice_paid:    0.95,   // actually paid
  subbie_quote:    0.85,   // a committed price
  qs_correction:   0.85,   // a human expert, in-app
  own_history:     0.75,   // learned from confirmed work
  client_library:  0.55,   // this builder's stated rate
  base_library:    0.40,   // the shipped rate library
  rate_book_local: 0.40,   // the seeded `rates` table
  model_estimate:  0.25,   // never authoritative alone
};

function initEvidenceTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS price_evidence (
      id TEXT PRIMARY KEY,
      user_id TEXT,                       -- NULL = not builder-specific
      item_key TEXT,                      -- NULL = unmapped evidence, still useful
      canonical_desc TEXT NOT NULL,
      unit TEXT NOT NULL,
      value REAL NOT NULL,
      value_type TEXT NOT NULL,           -- composite | labour | material | plant
      source_type TEXT NOT NULL,
      source_ref TEXT,
      region TEXT,
      project_type TEXT,
      observed_at TEXT NOT NULL,
      sample_weight REAL DEFAULT 1,
      redistributable INTEGER DEFAULT 1,  -- 0 for licensed rate-book rows
      raw_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_price_evidence_lookup
      ON price_evidence (item_key, region, project_type);
    CREATE INDEX IF NOT EXISTS idx_price_evidence_source
      ON price_evidence (source_type);
    CREATE INDEX IF NOT EXISTS idx_price_evidence_user
      ON price_evidence (user_id, item_key);
  `);
}

/**
 * Content-addressed id. This is what makes the store append-only AND the backfill
 * idempotent — two requirements that pull against each other.
 *
 * `value` IS part of the hash, and that is what lets both hold at once: re-running a
 * backfill over unchanged data collides with the existing rows and inserts nothing, while
 * a rate that has genuinely CHANGED hashes differently and lands as a new observation.
 * An id that deduped on source_ref alone would silently swallow the change, and the
 * history of what a rate used to be is precisely the data this table exists to keep.
 *
 * `observed_at` is deliberately NOT hashed: BASE_RATES carries no timestamp of its own,
 * so including one would make every boot insert a fresh copy of all 324 library rates.
 *
 * The cost of that, stated plainly: a value going 95 → 100 → 95 records the return to 95
 * as a collision, so the date it came back is lost. Two of the three observations
 * survive, which is enough for a median and acceptable here. A source that needs true
 * event history should pass a distinct source_ref per event.
 */
function evidenceId(parts) {
  const key = [
    parts.source_type, parts.source_ref, parts.user_id || '',
    parts.item_key || '', parts.canonical_desc, parts.unit, parts.value_type,
    // Hashed so a changed rate becomes a new observation rather than a dropped one.
    String(parts.value), parts.region || '', parts.project_type || '',
  ].join('|');
  return 'pe_' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 24);
}

function insertStatement(db) {
  return db.prepare(`
    INSERT OR IGNORE INTO price_evidence
      (id, user_id, item_key, canonical_desc, unit, value, value_type,
       source_type, source_ref, region, project_type, observed_at,
       sample_weight, redistributable, raw_json)
    VALUES
      (@id, @user_id, @item_key, @canonical_desc, @unit, @value, @value_type,
       @source_type, @source_ref, @region, @project_type, @observed_at,
       @sample_weight, @redistributable, @raw_json)
  `);
}

function record(db, obs) {
  const row = {
    user_id: obs.user_id || null,
    item_key: obs.item_key || null,
    canonical_desc: obs.canonical_desc || obs.item_key || '',
    unit: obs.unit || 'Item',
    value: obs.value,
    value_type: obs.value_type || 'composite',
    source_type: obs.source_type,
    source_ref: obs.source_ref || null,
    region: obs.region || null,
    project_type: obs.project_type || null,
    observed_at: obs.observed_at || new Date().toISOString(),
    sample_weight: obs.sample_weight != null
      ? obs.sample_weight
      : (SOURCE_WEIGHTS[obs.source_type] ?? 0.25),
    redistributable: obs.redistributable != null ? obs.redistributable : 1,
    raw_json: obs.raw_json ? JSON.stringify(obs.raw_json) : null,
  };
  row.id = evidenceId(row);
  const result = insertStatement(db).run(row);
  return { id: row.id, inserted: result.changes > 0 };
}

/**
 * Populate the store from the four sources that exist today. Idempotent: safe to call on
 * every boot, and safe to call twice in a row.
 *
 * Each source is wrapped independently — a missing table (e.g. `rates` on a database
 * where rateRoutes never ran) must not abort the rest of the backfill.
 */
function backfill(db, { baseRates } = {}) {
  initEvidenceTables(db);
  const stats = {};
  const insert = insertStatement(db);

  const runSource = (name, fn) => {
    try {
      const before = db.prepare('SELECT COUNT(*) c FROM price_evidence').get().c;
      db.transaction(fn)();
      const after = db.prepare('SELECT COUNT(*) c FROM price_evidence').get().c;
      stats[name] = after - before;
    } catch (e) {
      stats[name] = `error: ${e.message}`;
    }
  };

  const push = (obs) => {
    const row = {
      user_id: null, item_key: null, region: null, project_type: null,
      value_type: 'composite', redistributable: 1, raw_json: null,
      ...obs,
    };
    row.sample_weight = row.sample_weight != null
      ? row.sample_weight
      : (SOURCE_WEIGHTS[row.source_type] ?? 0.25);
    row.raw_json = row.raw_json ? JSON.stringify(row.raw_json) : null;
    row.id = evidenceId(row);
    insert.run(row);
  };

  // ── 1. The shipped rate library. The anchor every other source is judged against.
  //    No region: these are UK-average figures, pre-location-factor.
  runSource('base_library', () => {
    const rates = baseRates || require('./deterministicPricer').BASE_RATES;
    const now = new Date().toISOString();
    for (const [key, r] of Object.entries(rates)) {
      push({
        item_key: key,
        canonical_desc: r.description || key,
        unit: r.unit || 'Item',
        value: r.rate,
        source_type: 'base_library',
        source_ref: `BASE_RATES:${key}`,
        observed_at: now,
        raw_json: { labour: r.labour, materials: r.materials },
      });
    }
  });

  // ── 2. Per-builder confirmed rates.
  runSource('client_library', () => {
    const rows = db.prepare(`
      SELECT id, user_id, item_key, display_name, value, unit, confidence,
             times_confirmed, times_applied, updated_at
      FROM client_rate_library WHERE is_active = 1 AND value IS NOT NULL
    `).all();
    for (const r of rows) {
      push({
        user_id: r.user_id,
        item_key: r.item_key,
        canonical_desc: r.display_name || r.item_key,
        unit: r.unit || 'Item',
        value: r.value,
        source_type: 'client_library',
        source_ref: `client_rate_library:${r.id}`,
        observed_at: r.updated_at || new Date().toISOString(),
        raw_json: {
          confidence: r.confidence,
          times_confirmed: r.times_confirmed,
          times_applied: r.times_applied,
        },
      });
    }
  });

  // ── 3. Rates learned from confirmed jobs. These already carry region and project
  //    type, which is what makes them the seed for the own-history rung later.
  runSource('own_history', () => {
    const rows = db.prepare(`
      SELECT id, scope, user_id, item_key, region, project_type, rate,
             sample_count, stddev, confidence, last_seen
      FROM memory_rates WHERE rate IS NOT NULL
    `).all();
    for (const r of rows) {
      push({
        // scope='global' rows are anonymised aggregates, not one builder's data.
        user_id: r.scope === 'global' ? null : (r.user_id || null),
        item_key: r.item_key,
        canonical_desc: r.item_key,
        unit: 'Item',   // memory_rates does not record a unit
        value: r.rate,
        source_type: 'own_history',
        source_ref: `memory_rates:${r.id}`,
        region: r.region || null,
        project_type: r.project_type || null,
        observed_at: r.last_seen || new Date().toISOString(),
        raw_json: {
          scope: r.scope,
          sample_count: r.sample_count,
          stddev: r.stddev,
          confidence: r.confidence,
        },
      });
    }
  });

  // ── 4. The seeded `rates` table. Keyed on code/trade, not canonical item_key, so it
  //    lands unmapped: item_key NULL with the description preserved. Mapping free text
  //    to canonical keys is an LLM job that belongs with the historic-job importer, and
  //    the schema allows unmapped evidence precisely so this is not blocked on it.
  runSource('rate_book_local', () => {
    const rows = db.prepare(`
      SELECT id, code, trade, description, unit, labour_rate, material_rate, total_rate, updated_at
      FROM rates WHERE total_rate IS NOT NULL AND total_rate > 0
    `).all();
    for (const r of rows) {
      push({
        item_key: null,
        canonical_desc: r.description,
        unit: r.unit || 'Item',
        value: r.total_rate,
        source_type: 'rate_book_local',
        source_ref: `rates:${r.id}`,
        observed_at: r.updated_at || new Date().toISOString(),
        raw_json: {
          code: r.code, trade: r.trade,
          labour_rate: r.labour_rate, material_rate: r.material_rate,
        },
      });
    }
  });

  return stats;
}

/** Counts by source_type — the cheapest way to confirm a backfill did what it claimed. */
function summary(db) {
  try {
    const rows = db.prepare(`
      SELECT source_type, COUNT(*) AS rows, MIN(value) AS min_value,
             MAX(value) AS max_value, COUNT(DISTINCT item_key) AS mapped_keys
      FROM price_evidence GROUP BY source_type ORDER BY source_type
    `).all();
    const total = db.prepare('SELECT COUNT(*) c FROM price_evidence').get().c;
    return { total, by_source: rows };
  } catch (e) {
    console.error('[PriceEvidence] summary failed:', e.message);
    return { total: 0, by_source: [], error: e.message };
  }
}

/**
 * Evidence for one key, best-weighted first. Not yet wired into pricing — this is the
 * read path the own-history rung will use once there is history to read, and having it
 * now is what makes the store verifiable rather than write-only.
 *
 * Builder-specific rows are returned only for that builder; NULL-user rows are shared.
 */
function forKey(db, { itemKey, region = null, projectType = null, userId = null } = {}) {
  try {
    return db.prepare(`
      SELECT * FROM price_evidence
      WHERE item_key = ?
        AND (user_id IS NULL OR user_id = ?)
        AND (? IS NULL OR region IS NULL OR region = ?)
        AND (? IS NULL OR project_type IS NULL OR project_type = ?)
      ORDER BY sample_weight DESC, observed_at DESC
    `).all(itemKey, userId, region, region, projectType, projectType);
  } catch (e) {
    // Degrade to "no evidence" rather than breaking a caller, but say so. Once this
    // feeds pricing, a silently-empty result would read as "nothing known about this
    // key" and quietly drop the whole path to a fallback rate.
    console.error(`[PriceEvidence] forKey(${itemKey}) failed:`, e.message);
    return [];
  }
}

module.exports = {
  initEvidenceTables,
  backfill,
  record,
  summary,
  forKey,
  evidenceId,
  SOURCE_WEIGHTS,
};
