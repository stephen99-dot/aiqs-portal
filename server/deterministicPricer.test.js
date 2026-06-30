// Tests for the surface-by-surface decoration keys and the decoration
// double-count guard. Covers the chartered-bill decoration breakdown
// (skirting / architrave / doors / windows / staircase / sundry joinery).

const test = require('node:test');
const assert = require('node:assert');

const { BASE_RATES, detectDuplicatesAndOverlaps } = require('./deterministicPricer');

const SPLIT_KEYS = [
  'decorate_skirting', 'decorate_architrave', 'decorate_door',
  'decorate_window_timber', 'decorate_staircase', 'decorate_joinery_sundry',
];

test('surface-split decoration keys exist with sensible units', () => {
  const expectUnit = {
    decorate_skirting: 'm', decorate_architrave: 'm',
    decorate_door: 'Nr', decorate_window_timber: 'Nr',
    decorate_staircase: 'Item', decorate_joinery_sundry: 'Item',
  };
  for (const key of SPLIT_KEYS) {
    const r = BASE_RATES[key];
    assert.ok(r, `${key} should be a base rate`);
    assert.strictEqual(r.unit, expectUnit[key], `${key} unit`);
    assert.ok(r.rate > 0, `${key} should have a positive rate`);
    assert.ok(Math.abs((r.labour + r.materials) - 1) < 1e-9, `${key} labour+materials should sum to 1`);
  }
});

test('lump internal_decorations removes the surface-split keys (no double count)', () => {
  const items = [
    { key: 'internal_decorations', qty: 50, unit: 'm²' },
    { key: 'decorate_skirting', qty: 30, unit: 'm' },
    { key: 'decorate_door', qty: 4, unit: 'Nr' },
    { key: 'emulsion_walls_2coat', qty: 40, unit: 'm²' },
    { key: 'plasterboard_skim_walls', qty: 40, unit: 'm²' }, // unrelated, must survive
  ];
  const warnings = detectDuplicatesAndOverlaps(items);
  const keys = items.map(i => i.key);
  assert.ok(keys.includes('internal_decorations'), 'lump survives');
  assert.ok(keys.includes('plasterboard_skim_walls'), 'unrelated item survives');
  assert.ok(!keys.includes('decorate_skirting'), 'split skirting removed by lump');
  assert.ok(!keys.includes('decorate_door'), 'split door removed by lump');
  assert.ok(!keys.includes('emulsion_walls_2coat'), 'emulsion removed by lump');
  assert.ok(warnings.some(w => /decoration/i.test(w)), 'a decoration warning is raised');
});

test('surface-split decoration survives when there is no lump item', () => {
  const items = [
    { key: 'emulsion_walls_2coat', qty: 40, unit: 'm²' },
    { key: 'emulsion_ceiling', qty: 20, unit: 'm²' },
    ...SPLIT_KEYS.map((key) => ({ key, qty: 2, unit: BASE_RATES[key].unit })),
  ];
  const before = items.length;
  detectDuplicatesAndOverlaps(items);
  assert.strictEqual(items.length, before, 'nothing removed without a lump decoration item');
  for (const key of SPLIT_KEYS) {
    assert.ok(items.some(i => i.key === key), `${key} survives`);
  }
});
