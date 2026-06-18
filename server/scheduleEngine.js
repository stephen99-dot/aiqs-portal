// ═══════════════════════════════════════════════════════════════════════════
// scheduleEngine.js — pure date-flow for build schedules. No DB, no I/O.
//
// A schedule is a list of tasks, each with a duration in WORKING days and a set
// of dependencies (task ids that must finish first). computeSchedule() walks the
// dependency graph and lays every task onto a working calendar, so changing one
// duration or the programme start re-flows everything downstream.
//
// Dates are ISO 'YYYY-MM-DD' strings throughout. All maths is done in UTC to
// avoid local-timezone off-by-one-day surprises. The working calendar is a set
// of weekday numbers (0=Sun .. 6=Sat); default is Mon–Fri.
// ═══════════════════════════════════════════════════════════════════════════

function parseISO(s) {
  if (!s) return null;
  const parts = String(s).slice(0, 10).split('-').map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toISO(date) {
  return date.toISOString().slice(0, 10);
}

function todayUTC() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

// Accepts an array, a JSON string, or nothing — always returns a Set of valid
// weekday numbers, falling back to Mon–Fri.
function normWorkingDays(wd) {
  let arr = wd;
  if (typeof wd === 'string') {
    try { arr = JSON.parse(wd); } catch (e) { arr = null; }
  }
  if (!Array.isArray(arr) || arr.length === 0) arr = [1, 2, 3, 4, 5];
  const set = new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6));
  return set.size ? set : new Set([1, 2, 3, 4, 5]);
}

function isWorkingDay(date, set) {
  return set.has(date.getUTCDay());
}

// First working day on or after `date`. The 14-iteration guard means a degenerate
// calendar (e.g. an empty set slipped through) can never loop forever.
function snapForward(date, set) {
  const d = new Date(date.getTime());
  let guard = 0;
  while (!isWorkingDay(d, set) && guard++ < 14) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// Add `n` working days to a working-day start. addWorkingDays(start, 0) === start
// (snapped forward). A duration of D days spans start .. addWorkingDays(start, D-1).
function addWorkingDays(date, n, set) {
  const d = snapForward(date, set);
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkingDay(d, set)) added++;
  }
  return d;
}

// First working day strictly after `date` — where a dependent task can start.
function nextWorkingDay(date, set) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + 1);
  return snapForward(d, set);
}

// Inclusive count of working days between two ISO dates (1 if same day).
function workingDaysBetween(startISO, endISO, workingDays) {
  const set = normWorkingDays(workingDays);
  const a = parseISO(startISO);
  const b = parseISO(endISO);
  if (!a || !b || b < a) return 0;
  let count = 0;
  const d = new Date(a.getTime());
  let guard = 0;
  while (d <= b && guard++ < 100000) {
    if (isWorkingDay(d, set)) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

// ── The core pass ──────────────────────────────────────────────────────────
// tasks: [{ id, duration_days, depends_on:[id], sort_order,
//           lag_days?, actual_start?, actual_end? }]
// Returns a NEW array (same objects, cloned) with planned_start / planned_end
// set as ISO strings, ordered by start then sort_order. Dependency cycles and
// dangling references are handled defensively so a bad graph never throws and
// never loses a task.
//
// Actuals and slip (Stage 2): a task with actual_start is pinned to it; a task
// with actual_end is pinned to it (downstream flows from the real finish);
// lag_days pushes a task's start back by that many working days beyond its
// dependencies, so a reported slip cascades through everything after it.
function computeSchedule(tasks, planStartISO, workingDays) {
  const set = normWorkingDays(workingDays);
  const anchor = snapForward(parseISO(planStartISO) || todayUTC(), set);

  const list = (Array.isArray(tasks) ? tasks : []).map((t, i) => ({
    ...t,
    duration_days: Math.max(1, parseInt(t.duration_days, 10) || 1),
    lag_days: Math.max(0, parseInt(t.lag_days, 10) || 0),
    sort_order: t.sort_order != null ? Number(t.sort_order) : i,
  }));

  const byId = new Map(list.map((t) => [t.id, t]));
  // Keep only dependency edges that point at a real task and aren't self-loops.
  const deps = new Map();
  for (const t of list) {
    let raw = t.depends_on;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = []; } }
    const clean = (Array.isArray(raw) ? raw : []).filter((d) => d !== t.id && byId.has(d));
    deps.set(t.id, Array.from(new Set(clean)));
  }

  // Kahn topological sort. Anything left over sits in a cycle.
  const indeg = new Map(list.map((t) => [t.id, 0]));
  for (const t of list) for (const d of deps.get(t.id)) indeg.set(t.id, indeg.get(t.id) + 1);
  const ready = list.filter((t) => indeg.get(t.id) === 0)
    .sort((a, b) => a.sort_order - b.sort_order);
  const order = [];
  const placed = new Set();
  while (ready.length) {
    const t = ready.shift();
    order.push(t);
    placed.add(t.id);
    // Reveal dependents whose prerequisites are now all placed.
    const freed = [];
    for (const o of list) {
      if (placed.has(o.id)) continue;
      const od = deps.get(o.id);
      if (od.includes(t.id) && od.every((d) => placed.has(d))) freed.push(o);
    }
    for (const f of freed.sort((a, b) => a.sort_order - b.sort_order)) {
      if (!ready.includes(f)) ready.push(f);
    }
    ready.sort((a, b) => a.sort_order - b.sort_order);
  }
  // Cycle survivors: append in sort order, treated as a sequential tail.
  for (const t of list.sort((a, b) => a.sort_order - b.sort_order)) {
    if (!placed.has(t.id)) { order.push(t); placed.add(t.id); }
  }

  const endById = new Map();

  for (const t of order) {
    const tDeps = deps.get(t.id).filter((d) => endById.has(d));
    let baseStart;
    if (tDeps.length) {
      let latest = null;
      for (const d of tDeps) {
        const e = endById.get(d);
        if (!latest || e > latest) latest = e;
      }
      baseStart = nextWorkingDay(latest, set);
    } else {
      baseStart = anchor;
    }

    // A recorded actual start pins the task; otherwise apply any slip (lag).
    const actualStart = parseISO(t.actual_start);
    const start = actualStart || addWorkingDays(baseStart, t.lag_days, set);

    // A recorded actual finish pins the end; otherwise run the duration out.
    const actualEnd = parseISO(t.actual_end);
    const end = (actualEnd && actualEnd >= start) ? actualEnd : addWorkingDays(start, t.duration_days - 1, set);

    endById.set(t.id, end);
    t.planned_start = toISO(start);
    t.planned_end = toISO(end);
  }

  return list.sort((a, b) => {
    if (a.planned_start !== b.planned_start) return a.planned_start < b.planned_start ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
}

// Overall programme window from a set of computed tasks.
function programmeWindow(tasks) {
  let start = null;
  let end = null;
  for (const t of tasks || []) {
    if (t.planned_start && (!start || t.planned_start < start)) start = t.planned_start;
    if (t.planned_end && (!end || t.planned_end > end)) end = t.planned_end;
  }
  return { start, end };
}

module.exports = {
  computeSchedule,
  programmeWindow,
  workingDaysBetween,
  normWorkingDays,
  parseISO,
  toISO,
  addWorkingDays,
};
