/**
 * shadowLog.js — where rateResolver's disagreements with the live pricer are recorded.
 *
 * deterministicPricer returns a `shadow` block per job, but a block on one response is
 * only inspectable one job at a time and is gone the moment the response is discarded.
 * The useful question is aggregate: across every job priced this week, which item keys
 * does the resolver get wrong, and how much money do they represent? That needs storage.
 *
 * Two deliberate choices:
 *
 *   - Only mismatches are written. A matching resolution is the expected case and
 *     logging ~100 rows per job would bury the signal in confirmations. Counts of what
 *     matched live on the per-job shadow block instead.
 *   - Ranking is by value_at_risk, not frequency. A 2% divergence on a £40k steel package
 *     is worth more attention than a 50% divergence on a £30 line, and a frequency
 *     ranking inverts that.
 *
 * Every function is failure-tolerant: this is diagnostic plumbing that runs on the
 * pricing path by default, so it must never be able to break a quote. Failures are
 * logged rather than thrown.
 */

const crypto = require('crypto');

// Shadow mode is ON unless explicitly disabled. Following ENABLE_WEB_SEARCH's
// opt-out convention rather than STRICT_RECALC's opt-in, because the comparison is
// read-only, exception-wrapped and cannot alter a total — and because the divergences
// worth catching (the unit-ceiling clip, the client-rate sanity ratio) only appear on
// real jobs, never on the single synthetic eval fixture.
function isEnabled() {
  return process.env.RATE_RESOLVER_SHADOW !== '0';
}

function initShadowTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS resolver_shadow_log (
      id TEXT PRIMARY KEY,
      job_ref TEXT,
      user_id TEXT,
      item_key TEXT,
      unit TEXT,
      qty REAL,
      pricer_rate REAL,
      resolver_rate REAL,
      pricer_source TEXT,
      resolver_basis TEXT,
      delta_pct REAL,
      value_at_risk REAL,
      region TEXT,
      project_type TEXT,
      seen_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_shadow_log_key ON resolver_shadow_log (item_key);
    CREATE INDEX IF NOT EXISTS idx_shadow_log_seen ON resolver_shadow_log (seen_at);
  `);
}

/**
 * Persist the mismatches from one priced job.
 *
 * @param {object} db
 * @param {object} shadow      the `shadow` block from priceLockedQuantities
 * @param {object} ctx         { jobRef, userId, region, projectType }
 * @returns {number} rows written
 */
function recordMismatches(db, shadow, ctx = {}) {
  if (!shadow || !Array.isArray(shadow.mismatches) || shadow.mismatches.length === 0) return 0;
  try {
    initShadowTables(db);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO resolver_shadow_log
        (id, job_ref, user_id, item_key, unit, qty, pricer_rate, resolver_rate,
         pricer_source, resolver_basis, delta_pct, value_at_risk, region, project_type)
      VALUES
        (@id, @job_ref, @user_id, @item_key, @unit, @qty, @pricer_rate, @resolver_rate,
         @pricer_source, @resolver_basis, @delta_pct, @value_at_risk, @region, @project_type)
    `);

    const rows = shadow.mismatches.map((m) => {
      const row = {
        job_ref: ctx.jobRef || null,
        user_id: ctx.userId || null,
        item_key: m.key || null,
        unit: m.unit || null,
        qty: Number(m.qty) || 0,
        pricer_rate: Number(m.pricer_rate),
        resolver_rate: Number.isFinite(Number(m.resolver_rate)) ? Number(m.resolver_rate) : null,
        pricer_source: m.pricer_source || null,
        resolver_basis: m.resolver_basis || null,
        delta_pct: Number.isFinite(Number(m.delta_pct)) ? Number(m.delta_pct) : null,
        value_at_risk: Number.isFinite(Number(m.value_at_risk)) ? Number(m.value_at_risk) : 0,
        region: ctx.region || null,
        project_type: ctx.projectType || null,
      };
      // Content-addressed on the job + item + both rates, so re-pricing the same job
      // (which the portal does on every recalc) records the divergence once rather than
      // once per recalc. A genuinely different divergence still lands as a new row.
      row.id = 'sl_' + crypto.createHash('sha1').update([
        row.job_ref || '', row.item_key || '', row.pricer_rate, row.resolver_rate,
        row.pricer_source || '', row.resolver_basis || '',
      ].join('|')).digest('hex').slice(0, 24);
      return row;
    });

    db.transaction(() => { for (const r of rows) insert.run(r); })();
    return rows.length;
  } catch (e) {
    console.error('[ShadowLog] could not record mismatches:', e.message);
    return 0;
  }
}

/**
 * Worst offenders first — grouped by item key, ordered by the money at stake.
 *
 * This is the report that answers "is the resolver safe to switch on yet?". An empty
 * result after a week of real jobs is the green light.
 */
function report(db, { limit = 50, sinceDays = null } = {}) {
  try {
    initShadowTables(db);
    const where = sinceDays
      ? `WHERE seen_at >= datetime('now', '-${Number(sinceDays)} days')`
      : '';
    const byKey = db.prepare(`
      SELECT item_key,
             COUNT(*)                AS occurrences,
             SUM(value_at_risk)      AS total_value_at_risk,
             AVG(delta_pct)          AS avg_delta_pct,
             MIN(delta_pct)          AS min_delta_pct,
             MAX(delta_pct)          AS max_delta_pct,
             GROUP_CONCAT(DISTINCT pricer_source)   AS pricer_sources,
             GROUP_CONCAT(DISTINCT resolver_basis)  AS resolver_bases,
             MAX(seen_at)            AS last_seen
      FROM resolver_shadow_log
      ${where}
      GROUP BY item_key
      ORDER BY total_value_at_risk DESC
      LIMIT ?
    `).all(limit);

    const totals = db.prepare(`
      SELECT COUNT(*) AS mismatches,
             COUNT(DISTINCT item_key) AS keys_affected,
             COUNT(DISTINCT job_ref)  AS jobs_affected,
             COALESCE(SUM(value_at_risk), 0) AS total_value_at_risk
      FROM resolver_shadow_log ${where}
    `).get();

    return { enabled: isEnabled(), totals, by_key: byKey };
  } catch (e) {
    console.error('[ShadowLog] report failed:', e.message);
    return { enabled: isEnabled(), totals: null, by_key: [], error: e.message };
  }
}

/** Clear the log — for use once a divergence has been fixed and the history is noise. */
function clear(db) {
  try {
    initShadowTables(db);
    return db.prepare('DELETE FROM resolver_shadow_log').run().changes;
  } catch (e) {
    console.error('[ShadowLog] clear failed:', e.message);
    return 0;
  }
}

module.exports = { isEnabled, initShadowTables, recordMismatches, report, clear };
