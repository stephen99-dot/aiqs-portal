const test = require('node:test');
const assert = require('node:assert');

const { decorate, summarise, daysBetween, parseTs, dayKey, daySheet, daySeries } = require('./jobTracker');
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


// ─── Day sheet ───────────────────────────────────────────────────────────────

const DAY = '2026-08-31';

function ev(overrides = {}) {
  return {
    submission_id: 'j1',
    event_type: 'stage',
    actor: 'ella@theaiqs.co.uk',
    created_at: '2026-08-31T10:00:00Z',
    ...overrides,
  };
}

test('a day runs midnight to midnight in office time, not UTC', () => {
  // 23:30 London on the 31st is 22:30 UTC — same day either way.
  assert.strictEqual(dayKey('2026-08-31T22:30:00Z'), '2026-08-31');
  // 00:30 London on 1 Sept is 23:30 UTC on 31 Aug. Counted in UTC this lands
  // on the wrong day, which is how late-evening work goes missing.
  assert.strictEqual(dayKey('2026-08-31T23:30:00Z'), '2026-09-01');
});

test('jobs typed in by hand are credited to whoever logged them', () => {
  const jobs = [
    { id: 'j1', source: 'email', created_at: '2026-08-31T09:00:00Z' },
    { id: 'j2', source: 'phone', created_at: '2026-08-31T09:30:00Z' },
  ];
  const events = [
    ev({ submission_id: 'j1', event_type: 'created' }),
    ev({ submission_id: 'j2', event_type: 'created' }),
  ];
  const sheet = daySheet({ jobs, events, day: DAY });
  assert.strictEqual(sheet.logged, 2);
  assert.strictEqual(sheet.people[0].actor, 'ella@theaiqs.co.uk');
  assert.strictEqual(sheet.people[0].logged, 2);
});

test('portal submissions count as arrivals, not as somebody\'s work', () => {
  const jobs = [{ id: 'j1', source: 'portal', created_at: '2026-08-31T09:00:00Z' }];
  const events = [ev({ event_type: 'created', actor: 'customer@builder.co.uk' })];
  const sheet = daySheet({ jobs, events, day: DAY });
  assert.strictEqual(sheet.arrived, 1);
  assert.strictEqual(sheet.logged, 0);
  // The customer did that typing — they must not appear in the office's figures.
  assert.strictEqual(sheet.people.length, 0);
});

test('deliveries are counted from the stamp on the job, not the event wording', () => {
  const jobs = [
    { id: 'j1', source: 'portal', created_at: '2026-08-20T09:00:00Z',
      delivered_at: '2026-08-31T16:00:00Z', delivered_by: 'ella@theaiqs.co.uk' },
    { id: 'j2', source: 'email', created_at: '2026-08-20T09:00:00Z',
      delivered_at: '2026-08-30T16:00:00Z', delivered_by: 'ella@theaiqs.co.uk' },
  ];
  const sheet = daySheet({ jobs, events: [], day: DAY });
  assert.strictEqual(sheet.delivered, 1, 'yesterday\'s delivery is not today\'s');
  assert.strictEqual(sheet.people[0].delivered, 1);
});

test('stage moves and notes are attributed per person', () => {
  const events = [
    ev({ actor: 'ella@theaiqs.co.uk' }),
    ev({ actor: 'ella@theaiqs.co.uk' }),
    ev({ actor: 'sam@theaiqs.co.uk' }),
    ev({ actor: 'sam@theaiqs.co.uk', event_type: 'note' }),
    ev({ actor: 'ella@theaiqs.co.uk', created_at: '2026-08-29T10:00:00Z' }), // another day
  ];
  const sheet = daySheet({ jobs: [], events, day: DAY });
  assert.strictEqual(sheet.moved, 3);
  assert.strictEqual(sheet.notes, 1);
  const ella = sheet.people.find(p => p.actor.startsWith('ella'));
  assert.strictEqual(ella.moved, 2);
});

test('work with no actor recorded is reported, not silently dropped', () => {
  const sheet = daySheet({ jobs: [], events: [ev({ actor: null })], day: DAY });
  assert.strictEqual(sheet.moved, 1);
  assert.strictEqual(sheet.people[0].actor, '(unattributed)');
});

test('a quiet day reports zeroes rather than an empty object', () => {
  const sheet = daySheet({ jobs: [], events: [], day: DAY });
  assert.deepStrictEqual(
    [sheet.arrived, sheet.logged, sheet.delivered, sheet.moved, sheet.people.length],
    [0, 0, 0, 0, 0]
  );
});

test('the history series ends on the requested day and runs oldest first', () => {
  const jobs = [{ id: 'j1', source: 'portal', created_at: '2026-08-29T09:00:00Z',
                  delivered_at: '2026-08-31T09:00:00Z', delivered_by: 'ella@theaiqs.co.uk' }];
  const series = daySeries({ jobs, events: [], endDay: DAY, days: 3 });
  assert.deepStrictEqual(series.map(d => d.date), ['2026-08-29', '2026-08-30', '2026-08-31']);
  assert.strictEqual(series[0].arrived, 1);
  assert.strictEqual(series[2].delivered, 1);
});
