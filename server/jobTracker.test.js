const test = require('node:test');
const assert = require('node:assert');

const { decorate, summarise, daysBetween, parseTs } = require('./jobTracker');
const { defaultDueAt, isOpen, isParked, isValidStage, isValidSource } = require('./jobStages');

const NOW = new Date('2026-08-31T12:00:00Z');

function job(overrides = {}) {
  return {
    id: overrides.id || 'j1',
    stage: 'new',
    owner: null,
    source: 'portal',
    received_at: '2026-08-31T12:00:00Z',
    due_at: null,
    created_at: '2026-08-31T12:00:00Z',
    ...overrides,
  };
}

test('waiting time is measured from when the enquiry arrived, not when it was logged', () => {
  // An email that landed a week ago but was typed into the portal this morning.
  const row = job({ received_at: '2026-08-24T12:00:00Z', created_at: '2026-08-31T11:00:00Z' });
  assert.strictEqual(decorate(row, NOW).waiting_days, 7);
});

test('rows with no received_at fall back to created_at rather than reporting nothing', () => {
  const row = job({ received_at: null, created_at: '2026-08-28T12:00:00Z' });
  assert.strictEqual(decorate(row, NOW).waiting_days, 3);
});

test("SQLite's zone-less timestamps are read as UTC, not local time", () => {
  // "2026-08-31 12:00:00" is what CURRENT_TIMESTAMP writes. Parsed naively it
  // shifts by the server's offset, which silently skews every age figure.
  assert.strictEqual(parseTs('2026-08-31 12:00:00').toISOString(), '2026-08-31T12:00:00.000Z');
  assert.strictEqual(daysBetween('2026-08-29 12:00:00', NOW), 2);
});

test('a job past its target date and still ours is overdue', () => {
  const row = job({ stage: 'pricing', due_at: '2026-08-29T12:00:00Z' });
  const d = decorate(row, NOW);
  assert.strictEqual(d.overdue, true);
  assert.strictEqual(d.days_until_due, -2);
});

test('a delivered job is never overdue — the work is out the door', () => {
  const row = job({ stage: 'delivered', due_at: '2026-08-01T12:00:00Z' });
  assert.strictEqual(decorate(row, NOW).overdue, false);
});

test('an on-hold job is not overdue — we are the ones waiting', () => {
  const row = job({ stage: 'on_hold', due_at: '2026-08-01T12:00:00Z' });
  assert.strictEqual(decorate(row, NOW).overdue, false);
});

test('a job with no target date is not overdue', () => {
  assert.strictEqual(decorate(job({ stage: 'pricing' }), NOW).overdue, false);
});

test('every stage carries a human label for the trail to read back', () => {
  assert.strictEqual(decorate(job({ stage: 'takeoff' }), NOW).stage_label, 'Take-off');
});

test('summary separates untouched work from work in flight', () => {
  const s = summarise([
    job({ id: 'a', stage: 'new' }),
    job({ id: 'b', stage: 'new' }),
    job({ id: 'c', stage: 'takeoff', owner: 'va@example.com' }),
    job({ id: 'd', stage: 'on_hold', owner: 'va@example.com' }),
    job({ id: 'e', stage: 'delivered', owner: 'va@example.com' }),
  ], NOW);

  assert.strictEqual(s.total, 5);
  assert.strictEqual(s.open, 4);          // everything but the delivered one
  assert.strictEqual(s.unstarted, 2);
  assert.strictEqual(s.in_progress, 1);   // on-hold is open but not in flight
  assert.strictEqual(s.on_hold, 1);
  assert.strictEqual(s.delivered, 1);
  assert.strictEqual(s.by_stage.new, 2);
});

test('summary counts unassigned open work, ignoring finished jobs', () => {
  const s = summarise([
    job({ id: 'a', stage: 'new', owner: null }),
    job({ id: 'b', stage: 'pricing', owner: 'va@example.com' }),
    job({ id: 'c', stage: 'delivered', owner: null }),
  ], NOW);
  assert.strictEqual(s.unassigned, 1);
  assert.strictEqual(s.by_owner['(unassigned)'], 1);
  assert.strictEqual(s.by_owner['va@example.com'], 1);
});

test('oldest waiting figure covers open work only', () => {
  const s = summarise([
    // Delivered 40 days ago — finished, so it must not headline the queue.
    job({ id: 'a', stage: 'delivered', received_at: '2026-07-22T12:00:00Z' }),
    job({ id: 'b', stage: 'new', received_at: '2026-08-26T12:00:00Z' }),
  ], NOW);
  assert.strictEqual(s.oldest_waiting_days, 5);
});

test('an empty queue reports zero rather than blowing up on Math.max', () => {
  const s = summarise([], NOW);
  assert.strictEqual(s.oldest_waiting_days, 0);
  assert.strictEqual(s.open, 0);
});

test('the default target date is the turnaround measured from arrival', () => {
  assert.strictEqual(defaultDueAt('2026-08-31T12:00:00Z'), '2026-09-03T12:00:00.000Z');
  assert.strictEqual(defaultDueAt('not a date'), null);
});

test('stage and source vocabularies reject anything unrecognised', () => {
  assert.ok(isValidStage('pricing'));
  assert.ok(!isValidStage('nearly-done'));
  assert.ok(isValidSource('email'));
  assert.ok(!isValidSource('carrier-pigeon'));
  assert.ok(isOpen('on_hold'));
  assert.ok(!isOpen('delivered'));
  assert.ok(isParked('on_hold'));
});
