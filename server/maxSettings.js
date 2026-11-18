// ═══════════════════════════════════════════════════════════════════════════════
// MAX — server/maxSettings.js
//
// The numbers an admin tunes without a redeploy, read from app_settings with an
// env-var fallback and a hard default:
//
//   max_small_job_notice_gbp   from this value up, an estimate carries a note
//                              that a full take-off would be wise     (80,000)
//   max_small_job_limit_gbp    at or above this, MAX does NOT price the job —
//                              it shows the warning and sends the builder to
//                              the AI QS team                        (100,000)
//   max_daily_turns            MAX turns one client may run in 24 hours (300)
//
// The thresholds compare the estimate's price EX VAT (construction total plus
// contingency and overheads & profit — what the builder would actually quote),
// because VAT changes with the customer and the work, not with the size of the
// job. verdictFor() is the one place that rule lives.
// ═══════════════════════════════════════════════════════════════════════════════

const db = require('./database');

const DEFAULTS = {
  max_small_job_notice_gbp: { env: 'MAX_SMALL_JOB_NOTICE_GBP', value: 80000, min: 0, max: 10000000 },
  max_small_job_limit_gbp: { env: 'MAX_SMALL_JOB_LIMIT_GBP', value: 100000, min: 1000, max: 10000000 },
  max_daily_turns: { env: 'MAX_DAILY_TURNS', value: 300, min: 1, max: 100000 },
};

function readNumber(key) {
  const spec = DEFAULTS[key];
  try {
    const r = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    if (r && r.value != null && r.value !== '') {
      const n = Number(r.value);
      if (Number.isFinite(n)) return n;
    }
  } catch (e) { /* fall through to env/default */ }
  const fromEnv = Number(process.env[spec.env]);
  if (Number.isFinite(fromEnv) && process.env[spec.env] !== undefined && process.env[spec.env] !== '') return fromEnv;
  return spec.value;
}

function writeNumber(key, value, actorId) {
  const spec = DEFAULTS[key];
  if (!spec) throw new Error('Unknown setting ' + key);
  let n = Number(value);
  if (!Number.isFinite(n)) throw new Error(key + ' must be a number');
  n = Math.max(spec.min, Math.min(spec.max, Math.round(n)));
  db.prepare(
    'INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) '
    + 'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP'
  ).run(key, String(n), actorId || null);
  return n;
}

// { notice_gbp, limit_gbp } — the limit is never allowed below the notice.
function limits() {
  let notice = readNumber('max_small_job_notice_gbp');
  const limit = readNumber('max_small_job_limit_gbp');
  if (notice > limit) notice = limit;
  return { notice_gbp: notice, limit_gbp: limit };
}

function dailyTurns() { return readNumber('max_daily_turns'); }

// What to do with a priced small job.
//   ok          price it, draft the estimate
//   notice      price it, but flag that a full take-off is advisable
//   over_limit  do not draft an estimate — hand the job to the AI QS team
function verdictFor(priceExVat, lim) {
  const l = lim || limits();
  const v = Number(priceExVat) || 0;
  let status = 'ok';
  if (v >= l.limit_gbp) status = 'over_limit';
  else if (v >= l.notice_gbp) status = 'notice';
  return { status, price_ex_vat: Math.round(v * 100) / 100, notice_gbp: l.notice_gbp, limit_gbp: l.limit_gbp, basis: 'price ex VAT (construction total + contingency + overheads & profit)' };
}

// Everything the admin screen shows, in one shape.
function snapshot() {
  const l = limits();
  return { ...l, daily_turns: dailyTurns() };
}

function update(changes, actorId) {
  const c = changes || {};
  if (c.notice_gbp !== undefined) writeNumber('max_small_job_notice_gbp', c.notice_gbp, actorId);
  if (c.limit_gbp !== undefined) writeNumber('max_small_job_limit_gbp', c.limit_gbp, actorId);
  if (c.daily_turns !== undefined) writeNumber('max_daily_turns', c.daily_turns, actorId);
  return snapshot();
}

module.exports = { DEFAULTS, limits, dailyTurns, verdictFor, snapshot, update, readNumber, writeNumber };
