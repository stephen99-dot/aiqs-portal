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


// ─── Day sheet ───────────────────────────────────────────────────────────────

// The office is in the UK, so a day runs midnight-to-midnight London time, not
// UTC. Through BST those differ by an hour: a job delivered at half past eleven
// on Monday night is Tuesday in UTC, and would be counted against the wrong
// day — and against the wrong week at a weekend. Overridable for anyone
// running the office from another timezone.
const OFFICE_TZ = process.env.OFFICE_TIMEZONE || 'Europe/London';

// 'YYYY-MM-DD' for a timestamp, in office time. en-CA formats as ISO, which is
// why it is used here rather than en-GB.
function dayKey(value, tz = OFFICE_TZ) {
  const d = parseTs(value);
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d);
  } catch (err) {
    // An unknown timezone must not take the report down — fall back to UTC.
    return d.toISOString().slice(0, 10);
  }
}

function blankTally() {
  return { logged: 0, moved: 0, delivered: 0, notes: 0 };
}

/**
 * What the office actually got done on one day, and who did it.
 *
 * Answers the two questions a day sheet is for: how much work went out, and
 * how much of it was each person's. Jobs typed in by hand from an email or a
 * phone call count as work — they are somebody's ten minutes — so they are
 * attributed to whoever logged them, while portal submissions are counted as
 * arrivals and credited to nobody, because the customer did that typing.
 *
 * Pure, so the arithmetic is testable without a database or waiting for a day
 * to pass. The caller supplies the rows.
 *
 * @param {object}   input
 * @param {Array}    input.jobs   drawing_submissions rows
 * @param {Array}    input.events submission_events rows
 * @param {string}   input.day    'YYYY-MM-DD' in office time
 * @param {string}   [input.tz]   IANA timezone the day is measured in
 */
function daySheet({ jobs = [], events = [], day, tz = OFFICE_TZ }) {
  const people = new Map();
  const tally = (actor) => {
    const key = (actor || '').trim() || '(unattributed)';
    if (!people.has(key)) people.set(key, { actor: key, ...blankTally() });
    return people.get(key);
  };

  // Who logged each hand-added job: the 'created' event carries the actor.
  const loggedBy = new Map();
  for (const e of events) {
    if (e.event_type === 'created') loggedBy.set(e.submission_id, e.actor);
  }

  let arrived = 0;      // came in through the portal — nobody typed these
  let loggedTotal = 0;  // typed in by somebody from an email or a phone call
  const bySource = {};

  for (const job of jobs) {
    if (dayKey(job.created_at, tz) === day) {
      const source = job.source || 'portal';
      bySource[source] = (bySource[source] || 0) + 1;
      if (source === 'portal') {
        arrived += 1;
      } else {
        loggedTotal += 1;
        tally(loggedBy.get(job.id) || job.owner).logged += 1;
      }
    }
    // Delivery is read from the stamp on the row, not from event wording.
    if (job.delivered_at && dayKey(job.delivered_at, tz) === day) {
      tally(job.delivered_by || job.owner).delivered += 1;
    }
  }

  for (const e of events) {
    if (dayKey(e.created_at, tz) !== day) continue;
    if (e.event_type === 'stage') tally(e.actor).moved += 1;
    else if (e.event_type === 'note') tally(e.actor).notes += 1;
  }

  const rows = [...people.values()]
    .filter(p => p.logged || p.moved || p.delivered || p.notes)
    .sort((a, b) => (b.delivered - a.delivered) || (b.logged - a.logged) || (b.moved - a.moved)
      || a.actor.localeCompare(b.actor));

  return {
    date: day,
    arrived,                       // portal submissions that landed
    logged: loggedTotal,           // email/phone jobs somebody typed in
    in_total: arrived + loggedTotal,
    delivered: rows.reduce((n, p) => n + p.delivered, 0),
    moved: rows.reduce((n, p) => n + p.moved, 0),
    notes: rows.reduce((n, p) => n + p.notes, 0),
    by_source: bySource,
    people: rows,
  };
}

/**
 * The last `days` day sheets, oldest first — the trend behind today's figure.
 * One pass over the same rows per day; the volumes here are small enough that
 * this is cheaper than a query each.
 */
function daySeries({ jobs = [], events = [], endDay, days = 7, tz = OFFICE_TZ }) {
  const end = new Date(endDay + 'T12:00:00Z');
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * MS_PER_DAY);
    out.push(daySheet({ jobs, events, day: dayKey(d, tz), tz }));
  }
  return out;
}

module.exports = {
  logEvent, listEvents, decorate, summarise, daysBetween, parseTs,
  dayKey, daySheet, daySeries, OFFICE_TZ,
};
