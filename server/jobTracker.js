// ═══════════════════════════════════════════════════════════════════════════════
// JOB TRACKER — server/jobTracker.js
//
// The reporting layer over drawing_submissions: the append-only event trail,
// the derived "how long has this been sitting" figures, and the queue summary
// the inbox shows at the top.
//
// Kept out of submissionRoutes.js so the maths is testable without standing up
// Express, and so the same figures are used everywhere rather than each caller
// re-deriving "is this late?" slightly differently.
// ═══════════════════════════════════════════════════════════════════════════════

const db = require('./database');
const { STAGES, isOpen, isParked, stageLabel } = require('./jobStages');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// SQLite writes CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS" with no zone, and it
// is UTC. Date.parse treats that shape as LOCAL time, which silently shifts
// every age by the server's offset. Normalise to ISO before parsing.
function parseTs(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const str = String(value).trim();
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str);
  const d = new Date(sqlite ? str.replace(' ', 'T') + 'Z' : str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(from, to) {
  const a = parseTs(from);
  const b = parseTs(to) || new Date();
  if (!a) return null;
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
}

// ─── Event trail ─────────────────────────────────────────────────────────────

// Append one event. Never throws: a failed audit write must not take down the
// update the office was actually trying to make.
function logEvent({ submission_id, event_type, detail, actor }) {
  try {
    db.prepare(
      'INSERT INTO submission_events (submission_id, event_type, detail, actor) VALUES (?, ?, ?, ?)'
    ).run(submission_id, event_type, detail || null, actor || null);
  } catch (err) {
    console.error('[JobTracker] Failed to log event:', err.message);
  }
}

function listEvents(submissionId, limit = 200) {
  try {
    return db.prepare(`
      SELECT id, event_type, detail, actor, created_at
      FROM submission_events
      WHERE submission_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(submissionId, Math.min(limit, 500));
  } catch (err) {
    console.error('[JobTracker] Failed to list events:', err.message);
    return [];
  }
}

// ─── Derived figures ─────────────────────────────────────────────────────────

/**
 * Add the tracking figures a row cannot carry itself. Pure — takes a row and
 * `now` so the ageing maths is testable without waiting for time to pass.
 *
 * waiting_days — days since the ENQUIRY arrived, which is what the customer
 *   feels. Measured from received_at, so a job typed in by hand a week after
 *   the email landed reports the week, not the minute since it was typed.
 * overdue      — past its target date and still ours. On-hold jobs are never
 *   late: the delay belongs to the customer we are waiting on.
 */
function decorate(row, now = new Date()) {
  if (!row) return row;
  const stage = row.stage || 'new';
  const dueAt = parseTs(row.due_at);
  const open = isOpen(stage);
  const parked = isParked(stage);
  return {
    ...row,
    stage,
    stage_label: stageLabel(stage),
    is_open: open,
    waiting_days: daysBetween(row.received_at || row.created_at, now),
    overdue: !!(dueAt && open && !parked && dueAt.getTime() < now.getTime()),
    days_until_due: dueAt ? Math.ceil((dueAt.getTime() - now.getTime()) / MS_PER_DAY) : null,
  };
}

/**
 * The owner's view: what is outstanding, where it is stuck, and what is late.
 * Built from the decorated rows so the summary can never disagree with the
 * list it sits above.
 */
function summarise(rows, now = new Date()) {
  const decorated = rows.map(r => decorate(r, now));
  const open = decorated.filter(r => r.is_open);

  const byStage = {};
  for (const stage of STAGES) byStage[stage.key] = 0;
  for (const r of decorated) {
    if (byStage[r.stage] === undefined) byStage[r.stage] = 0;
    byStage[r.stage] += 1;
  }

  const byOwner = {};
  for (const r of open) {
    const key = r.owner || '(unassigned)';
    byOwner[key] = (byOwner[key] || 0) + 1;
  }

  const waits = open
    .map(r => r.waiting_days)
    .filter(d => typeof d === 'number');

  return {
    total: decorated.length,
    open: open.length,
    unstarted: decorated.filter(r => r.stage === 'new').length,
    in_progress: open.filter(r => r.stage !== 'new' && r.stage !== 'on_hold').length,
    on_hold: decorated.filter(r => r.stage === 'on_hold').length,
    delivered: decorated.filter(r => r.stage === 'delivered').length,
    overdue: decorated.filter(r => r.overdue).length,
    unassigned: open.filter(r => !r.owner).length,
    oldest_waiting_days: waits.length ? Math.max(...waits) : 0,
    by_stage: byStage,
    by_owner: byOwner,
  };
}

module.exports = { logEvent, listEvents, decorate, summarise, daysBetween, parseTs };
