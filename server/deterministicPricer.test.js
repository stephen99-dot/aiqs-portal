// Tests for the surface-by-surface decoration keys and the decoration
// double-count guard. Covers the chartered-bill decoration breakdown
// (skirting / architrave / doors / windows / staircase / sundry joinery).
//
// Also covers regional location factors — see detectLocationFactor below.

const test = require('node:test');
const assert = require('node:assert');

const { BASE_RATES, detectDuplicatesAndOverlaps, detectLocationFactor } = require('./deterministicPricer');

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

// ── detectLocationFactor ──────────────────────────────────────────────────────
// A London outward postcode puts a digit straight after the letters (SW1, SE10,
// N1). Every other UK area sharing those letters has a second letter first (SA
// Swansea, SN Swindon, NE Newcastle, WA Warrington). These tests lock that
// distinction in: matching 'sw'/'se'/'nw'/'tw'/'ec' as bare substrings used to
// price Swansea, Swindon, Somerset, Dorset and Cornwall at London +20%.

test('London postcodes are still detected', () => {
  for (const pc of ['SW1A 1AA', 'SE10 8XJ', 'N1 9GU', 'EC1A 1BB', 'WC2N 5DU',
                    'W12 7RJ', 'E14 5AB', 'NW3 2QG', 'TW9 1EL']) {
    const r = detectLocationFactor(pc);
    assert.strictEqual(r.factor, 1.20, `${pc} should be London +20%`);
  }
});

test('named London places are still detected', () => {
  for (const place of ['London', 'Richmond', 'Kingston', 'Wimbledon', 'Croydon']) {
    assert.strictEqual(detectLocationFactor(place).factor, 1.20, `${place} should be London`);
  }
});

test('town names containing London postcode letters are NOT priced as London', () => {
  // Each of these previously matched a bare postcode fragment and got +20%.
  const expected = {
    Swansea: 0.96,      // 'sw' — and it is in the Wales list, which was unreachable
    Swindon: 1.00,      // 'sw'
    Somerset: 1.05,     // 'se' — in the South West list, unreachable
    Dorset: 1.05,       // 'se' — in the South West list, unreachable
    Cornwall: 1.05,     // 'nw' — in the South West list, unreachable
    Selby: 1.00,        // 'se'
    Sevenoaks: 1.00,    // 'se'
    Ecclesfield: 1.00,  // 'ec'
    Aberystwyth: 1.00,  // 'tw'
  };
  for (const [town, factor] of Object.entries(expected)) {
    const r = detectLocationFactor(town);
    assert.notStrictEqual(r.factor, 1.20, `${town} must not price as London`);
    assert.strictEqual(r.factor, factor, `${town} factor`);
  }
});

test('non-London postcode areas sharing a first letter are not London', () => {
  // SA/SN/NE/WA/EN/ST all have a letter (not a digit) in second position.
  assert.notStrictEqual(detectLocationFactor('SA1 1AA').factor, 1.20, 'SA = Swansea');
  assert.notStrictEqual(detectLocationFactor('SN1 1AA').factor, 1.20, 'SN = Swindon');
  assert.notStrictEqual(detectLocationFactor('WA1 1AA').factor, 1.20, 'WA = Warrington');
  assert.notStrictEqual(detectLocationFactor('ST1 1AA').factor, 1.20, 'ST = Stoke');
});

test('nations and regions resolve to their own factors', () => {
  const expected = {
    Cardiff: 0.96, Wales: 0.96, Newport: 0.96,
    Glasgow: 1.03, Edinburgh: 1.03, Scotland: 1.03,
    Bristol: 1.05, Exeter: 1.05,
    Birmingham: 1.07, Manchester: 0.98, Leeds: 0.97, Newcastle: 0.97,
    Brighton: 1.15, Oxford: 1.15,
  };
  for (const [place, factor] of Object.entries(expected)) {
    assert.strictEqual(detectLocationFactor(place).factor, factor, `${place} factor`);
  }
});

test('Ireland still wins over everything and sets isIreland', () => {
  for (const place of ['Dublin', 'Cork', 'Galway', 'Co. Kildare']) {
    const r = detectLocationFactor(place);
    assert.strictEqual(r.factor, 1.10, `${place} should be Ireland`);
    assert.strictEqual(r.isIreland, true, `${place} isIreland`);
  }
});

test('unknown and empty locations fall back to a neutral factor', () => {
  assert.strictEqual(detectLocationFactor('Bolton').factor, 1.00);
  assert.strictEqual(detectLocationFactor('').factor, 1.00);
  assert.strictEqual(detectLocationFactor(null).factor, 1.00);
  assert.strictEqual(detectLocationFactor(undefined).label, 'default');
});
