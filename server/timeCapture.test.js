const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTimeRollup } = require('./timeCapture');

const tasks = [
  { id: 'a', name: 'Groundworks', phase: 'Substructure', percent_complete: 50 },
  { id: 'b', name: 'First fix', phase: 'Internal', percent_complete: 0 },
];

test('rolls captured hours + labour up per task against planned', () => {
  const planned = new Map([['a', 2000], ['b', 1000]]);
  const entries = [
    { task_id: 'a', hours: 8, labour_cost: 1200 },
    { task_id: 'a', hours: 8, labour_cost: 1200 }, // task a now £2400 vs £2000 planned
    { task_id: 'b', hours: 4, labour_cost: 600 },
  ];
  const r = computeTimeRollup(tasks, entries, planned);
  const a = r.rows.find((x) => x.taskId === 'a');
  assert.equal(a.plannedLabour, 2000);
  assert.equal(a.capturedLabour, 2400);
  assert.equal(a.capturedHours, 16);
  assert.equal(a.percent, 50);
  assert.equal(a.over, true);
  assert.equal(a.overBy, 400);

  const b = r.rows.find((x) => x.taskId === 'b');
  assert.equal(b.over, false); // 600 < 1000

  assert.equal(r.totals.plannedLabour, 3000);
  assert.equal(r.totals.capturedLabour, 3000);
  assert.equal(r.totals.capturedHours, 20);
  assert.equal(r.totals.variance, 0);
  assert.equal(r.totals.tasksOver, 1);
});

test('flags over-budget tasks and overall overrun', () => {
  const planned = new Map([['a', 1000]]);
  const entries = [{ task_id: 'a', hours: 20, labour_cost: 1500 }];
  const r = computeTimeRollup(tasks, entries, planned);
  assert.equal(r.totals.tasksOver, 1);
  assert.ok(r.flags.some((f) => /over budget overall/i.test(f)));
  assert.ok(r.flags.some((f) => /Groundworks/.test(f)));
});

test('tasks with no plan and no captured work are omitted; unassigned still totalled', () => {
  const entries = [
    { task_id: null, hours: 5, labour_cost: 750 }, // logged without a task
  ];
  const r = computeTimeRollup(tasks, entries, new Map());
  assert.equal(r.rows.length, 0);           // neither task has plan or captured work
  assert.equal(r.totals.capturedLabour, 750);
  assert.equal(r.totals.unassignedLabour, 750);
  assert.equal(r.totals.unassignedHours, 5);
});

test('empty inputs do not throw', () => {
  const r = computeTimeRollup([], [], new Map());
  assert.deepEqual(r.rows, []);
  assert.equal(r.totals.capturedLabour, 0);
  assert.deepEqual(r.flags, []);
});
