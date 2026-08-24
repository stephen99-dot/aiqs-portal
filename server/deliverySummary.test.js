const test = require('node:test');
const assert = require('node:assert');
const { buildDeliverySummary, classifyWarning, isInternalOnly } = require('./deliverySummary');

const PRICED = {
  summary: { construction_total: 141122.84, vat_rate: 20, vat_amount: 28224.57, grand_total: 169347.41, currency: 'GBP' },
  sections: [
    { title: 'Superstructure', items: [{ total: 44025 }] },
    { title: 'Roof', items: [{ total: 20611 }] },
    { title: 'Preliminaries', items: [{ total: 10825 }] },
  ],
  warnings: [],
  review_flags: [],
};

test('withholds the headline when the bill does not reconcile to the document', () => {
  // The real failure: chat announced £1,170,875, the spreadsheet held £141,123.
  const recalc = { ok: false, lineSum: 141122.84, expected: 1170875, diff: -1029752.16 };
  const out = buildDeliverySummary(PRICED, recalc);
  assert.strictEqual(out.reconciled, false);
  assert.strictEqual(out.headline, null, 'an unreconciled bill must not state a confident total');
  assert.match(out.statusLine, /do not yet reconcile/);
  assert.match(out.statusLine, /£141,123/);
  assert.match(out.statusLine, /£1,170,875/);
});

test('states the headline when the numbers agree with the document', () => {
  const recalc = { ok: true, lineSum: 141122.84, expected: 141122.84, diff: 0 };
  const out = buildDeliverySummary(PRICED, recalc, { floorAreaM2: 465 });
  assert.strictEqual(out.reconciled, true);
  assert.strictEqual(out.headline.formatted.construction, '£141,123');
  assert.strictEqual(out.headline.formatted.total, '£169,347');
  assert.strictEqual(out.headline.perM2, 303);
  assert.strictEqual(out.headline.formatted.perM2, '£303/m²');
});

test('sections come back largest first', () => {
  const out = buildDeliverySummary(PRICED, { ok: true, lineSum: 1, expected: 1, diff: 0 });
  assert.deepStrictEqual(out.sections.map((s) => s.title), ['Superstructure', 'Roof', 'Preliminaries']);
  assert.strictEqual(out.sections[0].formatted, '£44,025');
});

test('a capped rate becomes a review item, not a log line', () => {
  const priced = { ...PRICED, review_flags: [
    { key: 'garage_construction', unit: 'm', qty: 1, originalRate: 14700, ceiling: 490, reason: 'rate_above_unit_ceiling' },
  ] };
  const out = buildDeliverySummary(priced, { ok: true, lineSum: 1, expected: 1, diff: 0 });
  assert.strictEqual(out.needsCheck.length, 1);
  assert.strictEqual(out.needsCheck[0].id, 'ceiling_clipped');
  assert.match(out.needsCheck[0].detail, /garage_construction/);
  assert.match(out.needsCheck[0].detail, /£490\/m ceiling/);
});

test('rate-library chatter is internal, never a review item', () => {
  const priced = { ...PRICED, warnings: [
    "No base rate for 'skips_waste_removal' — used ai_estimated rate £17250/Item",
    "No base rate for 'temporary_protection' — used ai_estimated rate £5175/Item",
    "Key 'heating_extension' prices per m2 but the line is per Nr — likely the wrong rate key.",
  ] };
  const out = buildDeliverySummary(priced, { ok: true, lineSum: 1, expected: 1, diff: 0 });
  assert.strictEqual(out.needsCheck.length, 0, 'no-base-rate notes are not decisions for a human');
  assert.strictEqual(out.internal.length, 3);
  assert.match(out.statusLine, /no lines are flagged/);
});

test('quantity auto-corrections and double-counts do need a human', () => {
  const priced = { ...PRICED, warnings: [
    'AUTO-CORRECTED: plasterboard_skim_walls qty 1315 → 276. Plasterboard capped at 276m²',
    'Double-count in kitchen fit-out: removed "bar_fitout" (contains "worktop")',
  ] };
  const out = buildDeliverySummary(priced, { ok: true, lineSum: 1, expected: 1, diff: 0 });
  assert.strictEqual(out.needsCheck.length, 2);
  assert.deepStrictEqual(out.needsCheck.map((n) => n.id), ['qty_autocorrected', 'double_count_removed']);
  assert.match(out.statusLine, /2 lines need your check/);
});

test('classification helpers', () => {
  assert.strictEqual(classifyWarning("No base rate for 'x'"), null);
  assert.ok(isInternalOnly("No base rate for 'x'"));
  assert.strictEqual(classifyWarning('AUTO-CORRECTED: foo qty 9 → 1').id, 'qty_autocorrected');
});
