const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSchedule, programmeWindow, workingDaysBetween, addWorkingDays, normWorkingDays, parseISO, toISO } = require('./scheduleEngine');

const WD = [1, 2, 3, 4, 5]; // Mon–Fri
const byId = (rows) => Object.fromEntries(rows.map((t) => [t.id, t]));

test('a dependency chain flows across the weekend', () => {
  const r = computeSchedule([
    { id: 't1', duration_days: 5, depends_on: [], sort_order: 0 },
    { id: 't2', duration_days: 1, depends_on: ['t1'], sort_order: 1 },
  ], '2026-06-19', WD); // Fri
  const m = byId(r);
  assert.equal(m.t1.planned_start, '2026-06-19');
  assert.equal(m.t1.planned_end, '2026-06-25');   // 5 wd: Fri, Mon–Thu
  assert.equal(m.t2.planned_start, '2026-06-26'); // next working day
});

test('parallel trades share a start; a join waits for the later one', () => {
  const r = computeSchedule([
    { id: 'a', duration_days: 1, depends_on: [], sort_order: 0 },
    { id: 'b', duration_days: 3, depends_on: ['a'], sort_order: 1 },
    { id: 'c', duration_days: 1, depends_on: ['a'], sort_order: 2 },
    { id: 'd', duration_days: 1, depends_on: ['b', 'c'], sort_order: 3 },
  ], '2026-06-22', WD); // Mon
  const m = byId(r);
  assert.equal(m.b.planned_start, m.c.planned_start, 'b and c run in parallel');
  assert.ok(m.d.planned_start > m.b.planned_end, 'd starts after the later of b/c');
});

test('a dependency cycle never hangs and never drops a task', () => {
  const r = computeSchedule([
    { id: 'x', duration_days: 1, depends_on: ['y'], sort_order: 0 },
    { id: 'y', duration_days: 1, depends_on: ['x'], sort_order: 1 },
  ], '2026-06-22', WD);
  assert.equal(r.length, 2);
  assert.ok(r.every((t) => t.planned_start && t.planned_end));
});

test('self and ghost dependencies are ignored; a weekend start snaps forward', () => {
  const r = computeSchedule([
    { id: 's', duration_days: 1, depends_on: ['s', 'ghost'], sort_order: 0 },
  ], '2026-06-20', WD); // Sat
  assert.equal(r[0].planned_start, '2026-06-22'); // Mon
});

test('lag_days pushes a task and everything after it', () => {
  const base = [
    { id: 't1', duration_days: 5, depends_on: [], sort_order: 0 },
    { id: 't2', duration_days: 4, depends_on: ['t1'], sort_order: 1 },
    { id: 't3', duration_days: 2, depends_on: ['t2'], sort_order: 2 },
  ];
  const before = byId(computeSchedule(JSON.parse(JSON.stringify(base)), '2026-07-01', WD));
  const v = JSON.parse(JSON.stringify(base));
  v[1].lag_days = 5;
  const after = byId(computeSchedule(v, '2026-07-01', WD));
  assert.equal(after.t1.planned_end, before.t1.planned_end, 't1 unaffected');
  assert.ok(after.t2.planned_start > before.t2.planned_start, 't2 pushed back');
  assert.ok(after.t3.planned_end > before.t3.planned_end, 'slip cascades to t3');
});

test('a recorded actual finish pins the task and pulls dependents forward', () => {
  const v = [
    { id: 't1', duration_days: 5, depends_on: [], sort_order: 0, actual_end: '2026-07-03' },
    { id: 't2', duration_days: 4, depends_on: ['t1'], sort_order: 1 },
  ];
  const m = byId(computeSchedule(v, '2026-07-01', WD));
  assert.equal(m.t1.planned_end, '2026-07-03');   // pinned to the real finish (Fri)
  assert.equal(m.t2.planned_start, '2026-07-06');  // Mon after
});

test('empty input is safe', () => {
  assert.equal(computeSchedule([], '2026-07-01', WD).length, 0);
});

test('workingDaysBetween is inclusive and skips weekends', () => {
  assert.equal(workingDaysBetween('2026-06-19', '2026-06-23', WD), 3); // Fri, Mon, Tue
  assert.equal(workingDaysBetween('2026-06-22', '2026-06-22', WD), 1);
});

test('addWorkingDays(0) snaps a weekend forward to Monday', () => {
  assert.equal(toISO(addWorkingDays(parseISO('2026-06-20'), 0, normWorkingDays(WD))), '2026-06-22');
});

test('programmeWindow spans first start to last end', () => {
  const r = computeSchedule([
    { id: 'a', duration_days: 2, depends_on: [], sort_order: 0 },
    { id: 'b', duration_days: 2, depends_on: ['a'], sort_order: 1 },
  ], '2026-07-01', WD);
  const w = programmeWindow(r);
  assert.equal(w.start, '2026-07-01');
  assert.ok(w.end >= w.start);
});
