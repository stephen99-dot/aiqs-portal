const test = require('node:test');
const assert = require('node:assert/strict');
const { priceVariationDraft } = require('./variationDraft');

test('prices lines, computes line_total, and marks them indicative', () => {
  const lines = priceVariationDraft({
    lines: [
      { section: 'Change', item: 'Plastering', description: 'Skim hallway', unit: 'm2', qty: 5, rate: 22, labour: 14, materials: 8 },
      { item: 'Carpenter', unit: 'day', qty: 2, rate: 250 }, // labour-only, no split given
    ],
  });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].line_total, 110);      // 5 × 22
  assert.equal(lines[0].est_rate, 1);          // indicative — office fixes it
  assert.equal(lines[0].sort_order, 0);
  assert.equal(lines[1].line_total, 500);      // 2 × 250
  assert.equal(lines[1].labour, 150);          // 60% fallback split
  assert.equal(lines[1].materials, 100);       // 40% fallback split
  assert.equal(lines[1].section, 'Change');    // defaulted
});

test('handles missing/garbage input without throwing', () => {
  assert.deepEqual(priceVariationDraft(null), []);
  assert.deepEqual(priceVariationDraft({}), []);
  assert.deepEqual(priceVariationDraft({ lines: 'nope' }), []);
  const one = priceVariationDraft({ lines: [{}] });
  assert.equal(one.length, 1);
  assert.equal(one[0].qty, 0);
  assert.equal(one[0].rate, 0);
  assert.equal(one[0].line_total, 0);
  assert.equal(one[0].unit, 'item');
});

test('caps over-long text fields', () => {
  const lines = priceVariationDraft({ lines: [{ item: 'x'.repeat(500), description: 'y'.repeat(1000), qty: 1, rate: 1 }] });
  assert.equal(lines[0].item.length, 200);
  assert.equal(lines[0].description.length, 500);
});
