const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { assertBOQMatches, isStrictRecalc } = require('./recalcGate');
const { priceLockedQuantities, toPricedSections } = require('./deterministicPricer');
const { generateBOQExcel } = require('./boqGenerator');

const ITEMS = [
  { key: 'brick_outer_leaf', qty: 120, unit: 'm²', description: 'Facing brickwork outer leaf' },
  { key: 'blockwork_inner_leaf_100mm', qty: 100, unit: 'm²', description: 'Blockwork inner leaf 100mm' },
  { key: 'concrete_slab_150mm', qty: 60, unit: 'm²', description: 'Concrete slab 150mm' },
];

// Async-aware: a sync `finally` would restore the env before the awaited work
// ever read it, so the test would silently exercise the wrong setting.
async function withEnv(value, fn) {
  const prev = process.env.STRICT_RECALC;
  if (value === undefined) delete process.env.STRICT_RECALC;
  else process.env.STRICT_RECALC = value;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.STRICT_RECALC;
    else process.env.STRICT_RECALC = prev;
  }
}
function withEnvSync(value, fn) {
  const prev = process.env.STRICT_RECALC;
  if (value === undefined) delete process.env.STRICT_RECALC;
  else process.env.STRICT_RECALC = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.STRICT_RECALC;
    else process.env.STRICT_RECALC = prev;
  }
}

test('strict is ON by default and OFF only when explicitly set to 0', () => {
  withEnvSync(undefined, () => assert.strictEqual(isStrictRecalc(), true, 'unset must mean strict'));
  withEnvSync('1', () => assert.strictEqual(isStrictRecalc(), true));
  withEnvSync('0', () => assert.strictEqual(isStrictRecalc(), false, 'only "0" opts out'));
});

// The safety check that had to pass before strict could be turned on: markups
// must not make a legitimate bill look unreconciled.
for (const [label, opts] of [
  ['no markup', { contingency_pct: 0, ohp_pct: 0 }],
  ['contingency 5%', { contingency_pct: 5, ohp_pct: 0 }],
  ['contingency + OH&P 5/15', { contingency_pct: 5, ohp_pct: 15 }],
  ['OH&P only 15%', { contingency_pct: 0, ohp_pct: 15 }],
]) {
  test(`a legitimate bill reconciles to the penny — ${label}`, async () => {
    const priced = priceLockedQuantities(ITEMS, 'Manchester', {}, opts);
    const sections = toPricedSections(priced);
    const buf = await generateBOQExcel(sections, 'Recalc Test', 'Client', {
      contingency_pct: opts.contingency_pct, ohp_pct: opts.ohp_pct,
      vat_rate: priced.summary.vat_rate, currency: '£',
    });
    const r = await assertBOQMatches(buf, priced.summary.construction_total);
    assert.strictEqual(r.ok, true, `${label} must reconcile (diff ${r.diff})`);
    assert.strictEqual(r.diff, 0);
    assert.strictEqual(r.mismatches.length, 0);
  });
}

// A bill whose lines do not sum to the pricer's total is the Forest Mead
// failure: chat reported £1,170,875, the sheet held £141,123.
async function unreconciledBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOQ');
  ws.getRow(1).values = ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Labour', 'Materials', 'Total'];
  const r = ws.getRow(2);
  r.getCell(1).value = '1.01'; r.getCell(2).value = 'Scaffold';
  r.getCell(3).value = 'Item'; r.getCell(4).value = 1; r.getCell(5).value = 5.46;
  r.getCell(6).value = 3.28; r.getCell(7).value = 2.18; r.getCell(8).value = 5.46;
  return wb.xlsx.writeBuffer();
}

test('an unreconciled bill throws under the default (strict) setting', async () => {
  const buf = await unreconciledBuffer();
  await assert.rejects(
    () => withEnv(undefined, () => assertBOQMatches(buf, 1170875)),
    (err) => {
      assert.match(err.message, /does not reconcile/);
      // The figures ride on the error so the chat can still name both numbers.
      assert.ok(err.recalc, 'the thrown error must carry the recalc figures');
      assert.strictEqual(err.recalc.expected, 1170875);
      assert.strictEqual(err.recalc.lineSum, 5.46);
      return true;
    },
  );
});

test('STRICT_RECALC=0 restores warn-and-return', async () => {
  const buf = await unreconciledBuffer();
  const r = await withEnv('0', () => assertBOQMatches(buf, 1170875));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.expected, 1170875);
});
