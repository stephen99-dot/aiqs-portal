const test = require('node:test');
const assert = require('node:assert');
const { runLabourGovernor, combinedOutput } = require('./labourGovernor');

const DAY = 250;

// 96 m2 of facing brickwork at a plausible 6.5 m2/operative-day is
// 14.8 operative-days = £3,692 of labour.
const SOUND = [{ title: 'Superstructure', items: [
  { item: '2.01', description: 'Facing brickwork in half brick skin', unit: 'm2', qty: 96, labour: 3692, materials: 6800 },
] }];

test('passes a rate inside the benchmark band', () => {
  const r = runLabourGovernor(SOUND, { dayRate: DAY });
  assert.strictEqual(r.findings.length, 0, JSON.stringify(r.findings));
  assert.strictEqual(r.stats.itemsTested, 1);
});

test('catches the gang-scale error: brickwork at ~1 m2 per operative-day', () => {
  // 1.02 bricklayer-days/m2 — i.e. one square metre a day. This shape of
  // error reached issue once and was worth £207,000.
  const sections = [{ title: 'Superstructure', items: [
    { item: '2.01', description: 'Facing brickwork in half brick skin', unit: 'm2', qty: 96, labour: 96 * 1.02 * DAY },
  ] }];
  const r = runLabourGovernor(sections, { dayRate: DAY });
  assert.strictEqual(r.findings.length, 1);
  assert.strictEqual(r.findings[0].direction, 'labour_heavy');
  assert.strictEqual(r.findings[0].severity, 'high');
  assert.match(r.findings[0].message, /gang-scale/);
});

test('catches the component-drift error: labour far too light', () => {
  // 96 m2 of brickwork for 2 operative-days = 48 m2/day, ~7x plausible.
  const sections = [{ title: 'Superstructure', items: [
    { item: '2.01', description: 'Facing brickwork in half brick skin', unit: 'm2', qty: 96, labour: 2 * DAY },
  ] }];
  const r = runLabourGovernor(sections, { dayRate: DAY });
  assert.strictEqual(r.findings.length, 1);
  assert.strictEqual(r.findings[0].direction, 'labour_light');
  assert.strictEqual(r.findings[0].severity, 'high');
});

test('skips lump sums, provisional sums and time-related lines', () => {
  const sections = [{ title: 'Preliminaries', items: [
    { item: '1.01', description: 'Non-working supervisor', unit: 'wk', qty: 148, labour: 200000 },
    { item: '1.02', description: 'Sub-contract design', unit: 'item', qty: 1, labour: 65000 },
    { item: '1.03', description: 'Provisional sum for underpinning', unit: 'sum', qty: 1, labour: 25000 },
  ] }];
  const r = runLabourGovernor(sections, { dayRate: DAY });
  assert.strictEqual(r.findings.length, 0);
  assert.strictEqual(r.stats.itemsTested, 0);
  assert.strictEqual(r.stats.itemsSkipped, 3);
});

test('reports operative-days for the programme engine', () => {
  const r = runLabourGovernor(SOUND, { dayRate: DAY });
  assert.strictEqual(r.stats.operativeDays, 14.8);
});

test('combined output of a two-operation rate is not the slower of the two', () => {
  // Rake out at 4 m2/day and point at 6 gives 2.40, not 4.
  assert.strictEqual(Math.round(combinedOutput(4, 6) * 100) / 100, 2.4);
  assert.strictEqual(combinedOutput(0, 6), null);
});

test('a unit that does not match the benchmark unit is skipped, not flagged', () => {
  // Brickwork billed by the thousand rather than by m2 — no m2 benchmark applies.
  const sections = [{ title: 'Superstructure', items: [
    { item: '2.01', description: 'Facing brickwork in half brick skin', unit: 'nr', qty: 12000, labour: 4000 },
  ] }];
  const r = runLabourGovernor(sections, { dayRate: DAY });
  assert.strictEqual(r.findings.length, 0);
  assert.strictEqual(r.stats.itemsSkipped, 1);
});
