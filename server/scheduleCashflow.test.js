const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCashflow, computeTaskCosts, round2 } = require('./scheduleCashflow');

const WD = [1, 2, 3, 4, 5]; // Mon–Fri

test('planned total reconciles to the contract value', () => {
  const tasks = [
    { id: 'a', duration_days: 10, planned_start: '2026-07-01', planned_end: '2026-07-14', source_line_ids: [] },
    { id: 'b', duration_days: 10, planned_start: '2026-07-15', planned_end: '2026-07-28', source_line_ids: [] },
  ];
  const cf = buildCashflow({ tasks, lineTotalById: new Map(), contractValue: 20000, workingDays: WD, claims: [] });
  assert.equal(cf.totals.contractValue, 20000);
  assert.equal(cf.totals.plannedTotal, 20000); // no value is lost in the spread
});

test('priced source lines drive each task cost; residual spreads by duration', () => {
  const lineTotalById = new Map([['L1', 5000]]);
  const tasks = [
    { id: 'a', duration_days: 5, source_line_ids: ['L1'] }, // priced at 5000
    { id: 'b', duration_days: 5, source_line_ids: [] },      // gets half the residual
    { id: 'c', duration_days: 5, source_line_ids: [] },      // gets half the residual
  ];
  const costs = computeTaskCosts(tasks, lineTotalById, 11000); // residual = 6000
  assert.equal(round2(costs.get('a')), 7000); // 5000 priced + 2000 dur-share (5/15 of 6000)
  assert.equal(round2(costs.get('b')), 2000);
  assert.equal(round2(costs.get('c')), 2000);
  const sum = round2(costs.get('a') + costs.get('b') + costs.get('c'));
  assert.equal(sum, 11000);
});

test('cost is bucketed into the right calendar months', () => {
  // One task spanning end of July into August; value should split across months.
  const tasks = [
    { id: 'a', duration_days: 10, planned_start: '2026-07-27', planned_end: '2026-08-07', source_line_ids: [] },
  ];
  const cf = buildCashflow({ tasks, lineTotalById: new Map(), contractValue: 10000, workingDays: WD, claims: [] });
  const months = cf.months.map((m) => m.month);
  assert.deepEqual(months, ['2026-07', '2026-08']);
  // 10 working days total: Jul 27–31 (5) + Aug 3–7 (5) → 50/50.
  assert.equal(cf.months[0].planned, 5000);
  assert.equal(cf.months[1].planned, 5000);
  assert.equal(cf.months[1].cumulativePlanned, 10000);
});

test('claims are overlaid by issue month and cumulated', () => {
  const tasks = [
    { id: 'a', duration_days: 20, planned_start: '2026-07-01', planned_end: '2026-07-28', source_line_ids: [] },
  ];
  const claims = [
    { date: '2026-07-15', amount: 3000 },
    { date: '2026-08-10', amount: 2000 },
  ];
  const cf = buildCashflow({ tasks, lineTotalById: new Map(), contractValue: 10000, workingDays: WD, claims });
  const jul = cf.months.find((m) => m.month === '2026-07');
  const aug = cf.months.find((m) => m.month === '2026-08');
  assert.equal(jul.claimed, 3000);
  assert.equal(aug.claimed, 2000);
  assert.equal(aug.cumulativeClaimed, 5000);
  assert.equal(cf.totals.claimedToDate, 5000);
  assert.equal(cf.totals.remainingToClaim, 5000);
});

test('no contract value falls back to priced net without throwing', () => {
  const lineTotalById = new Map([['L1', 800]]);
  const tasks = [
    { id: 'a', duration_days: 4, planned_start: '2026-07-01', planned_end: '2026-07-06', source_line_ids: ['L1'] },
  ];
  const cf = buildCashflow({ tasks, lineTotalById, contractValue: 0, workingDays: WD, claims: [] });
  assert.equal(cf.totals.contractValue, 0);
  assert.equal(cf.totals.plannedTotal, 800);
});

test('an explicit-cost task (change order) carries its cost and stacks on the contract value', () => {
  const tasks = [
    { id: 'a', duration_days: 10, planned_start: '2026-07-01', planned_end: '2026-07-14', source_line_ids: [] },
    // Approved change order added by scheduleLink: explicit cost, runs in Aug.
    { id: 'vo', duration_days: 5, planned_start: '2026-08-03', planned_end: '2026-08-07', source_line_ids: [], cost_amount: 3000 },
  ];
  const cf = buildCashflow({ tasks, lineTotalById: new Map(), contractValue: 10000, workingDays: WD, claims: [] });
  // Base quote (10000) is spread over task 'a' only; the VO carries its 3000.
  assert.equal(cf.totals.contractValue, 13000);
  assert.equal(cf.totals.variationsValue, 3000);
  assert.equal(cf.totals.plannedTotal, 13000);
  const aug = cf.months.find((m) => m.month === '2026-08');
  assert.equal(aug.planned, 3000); // the VO lands in August
  const jul = cf.months.find((m) => m.month === '2026-07');
  assert.equal(jul.planned, 10000); // the full quote value, undiluted by the VO
});

test('duration heuristic scales with labour and is bounded', () => {
  const { estimateDurationDays } = require('./scheduleLink');
  assert.equal(estimateDurationDays([]), 1);                          // no labour → 1 day
  assert.equal(estimateDurationDays([{ labour: 0 }]), 1);
  assert.equal(estimateDurationDays([{ labour: 500 }]), 2);           // 500/250 = 2
  assert.equal(estimateDurationDays([{ labour: 250 }, { labour: 250 }]), 2);
  assert.equal(estimateDurationDays([{ labour: 100000 }]), 20);       // capped at 20
});

test('empty schedule yields empty months, not a crash', () => {
  const cf = buildCashflow({ tasks: [], lineTotalById: new Map(), contractValue: 5000, workingDays: WD, claims: [] });
  assert.deepEqual(cf.months, []);
  assert.equal(cf.totals.plannedTotal, 0);
  assert.equal(cf.totals.contractValue, 5000);
});
