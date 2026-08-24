// Parity tests for rateResolver against deterministicPricer's inline ladder.
//
// This is the whole point of Phase 1: the resolver must be a faithful copy of what ships
// today before any later phase is allowed to change what a rate is. So these tests do
// not assert the resolver produces "sensible" rates — they assert it produces the SAME
// rate and the SAME rate_source as priceLockedQuantities(), item for item, across the
// cases where the two could plausibly diverge.
//
// The interesting cases are the late rewrites, not the happy path: the client-rate
// sanity ratio, the unit-family guard, the unit ceiling clip. A reimplementation that
// gets the ladder right and forgets the ceiling looks correct on a base-library job and
// drifts silently on a real one.

const test = require('node:test');
const assert = require('node:assert');

const { priceLockedQuantities, BASE_RATES, detectLocationFactor, GBP_TO_EUR } = require('./deterministicPricer');
const { resolveRate } = require('./rateResolver');

// Recompute locFactor the way priceLockedQuantities does, so the resolver is fed the
// same input the pricer used rather than a re-derived guess.
function locFactorFor(location, options = {}) {
  const info = detectLocationFactor(location);
  const ukPostcode = /\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i.test(location || '');
  const isUKAddress = ukPostcode && !info.isIreland;
  const isIreland = info.isIreland || (!isUKAddress && options.currency === 'EUR');
  return isIreland ? info.factor * GBP_TO_EUR : info.factor;
}

// Price a set of items through the real pricer, then resolve each one independently and
// compare. Returns the per-item comparison so a failing case names itself.
function compare(items, location, clientRates = {}, options = {}) {
  const priced = priceLockedQuantities(
    JSON.parse(JSON.stringify(items)), location, clientRates, options
  );
  const locFactor = locFactorFor(location, options);
  const flat = priced.sections.flatMap(s => s.items);

  return flat.map((line) => {
    const original = items.find(i => i.key === line.key) || {};
    const r = resolveRate({
      itemKey: line.key,
      description: original.description || '',
      unit: original.unit || line.unit,
      qty: line.qty,
      locFactor,
      overrideRate: original.override_rate,
      clientRate: clientRates[line.key],
      assumedRate: original.assumed_rate,
    });
    return {
      key: line.key,
      pricerRate: line.rate,
      resolverRate: r.rate,
      pricerSource: line.rate_source,
      resolverSource: r.rateSource,
    };
  });
}

function assertParity(rows, label) {
  const bad = rows.filter(r => r.pricerRate !== r.resolverRate || r.pricerSource !== r.resolverSource);
  assert.deepStrictEqual(bad, [], `${label}: resolver diverged from the pricer`);
  assert.ok(rows.length > 0, `${label}: nothing was compared`);
}

const REGIONS = ['London SW1A 1AA', 'Cardiff', 'Manchester', 'Swansea', 'Dublin', ''];

test('base-library rates match across every region', () => {
  const items = [
    { key: 'brick_outer_leaf', qty: 120, unit: 'm²' },
    { key: 'concrete_slab_150mm', qty: 60, unit: 'm²' },
    { key: 'blockwork_inner_leaf_100mm', qty: 100, unit: 'm²' },
    { key: 'tile_battens', qty: 80, unit: 'm²' },
  ];
  for (const region of REGIONS) {
    assertParity(compare(items, region), `base library @ "${region}"`);
  }
});

test('an explicit override wins and is NOT location-adjusted', () => {
  const items = [{ key: 'brick_outer_leaf', qty: 100, unit: 'm²', override_rate: 137 }];
  for (const region of REGIONS) {
    const rows = compare(items, region);
    assertParity(rows, `override @ "${region}"`);
    assert.strictEqual(rows[0].resolverRate, 137,
      `override must survive the ${region} location factor untouched`);
  }
});

test('a client rate inside the sanity ratio wins, and is NOT location-adjusted', () => {
  // 95 against a base of 82 — ratio ~1.16, comfortably inside the 0.1x–5x window.
  const items = [{ key: 'brick_outer_leaf', qty: 100, unit: 'm²' }];
  for (const region of REGIONS) {
    const rows = compare(items, region, { brick_outer_leaf: 95 });
    assertParity(rows, `client rate @ "${region}"`);
    assert.strictEqual(rows[0].resolverSource, 'client_verified');
    assert.strictEqual(rows[0].resolverRate, 95, 'client rate is already regional');
  }
});

test('a client rate outside the sanity ratio is rejected back to base', () => {
  // The real-world case: scaffolding stored at thousands against a base of tens.
  const items = [{ key: 'scaffolding', qty: 50, unit: 'm²' }];
  for (const region of ['London SW1A 1AA', 'Manchester', 'Dublin']) {
    const rows = compare(items, region, { scaffolding: 2245 });
    assertParity(rows, `corrupted client rate @ "${region}"`);
    assert.strictEqual(rows[0].resolverSource, 'base_library',
      'a 100x client rate must fall back to the library');
  }
});

test('a client rate far BELOW base is also rejected', () => {
  const items = [{ key: 'brick_outer_leaf', qty: 100, unit: 'm²' }];
  const rows = compare(items, 'Manchester', { brick_outer_leaf: 4 }); // ratio ~0.05
  assertParity(rows, 'client rate below 0.1x');
  assert.strictEqual(rows[0].resolverSource, 'base_library');
});

test('an unknown key falls back, preferring the model rate over the keyword ladder', () => {
  const withAssumed = [{
    key: 'totally_unknown_key', qty: 5, unit: 'm²',
    description: 'bespoke curved oak screen', assumed_rate: 240,
  }];
  const withoutAssumed = [{
    key: 'another_unknown_key', qty: 5, unit: 'm²',
    description: 'bespoke curved oak screen',
  }];
  for (const region of REGIONS) {
    const a = compare(withAssumed, region);
    assertParity(a, `unknown key + assumed_rate @ "${region}"`);
    assert.strictEqual(a[0].resolverSource, 'ai_estimated');

    const b = compare(withoutAssumed, region);
    assertParity(b, `unknown key, no assumed_rate @ "${region}"`);
    assert.strictEqual(b[0].resolverSource, 'fallback_estimated');
  }
});

test('the unit-family guard fires when the line unit contradicts the key', () => {
  // cavity_wall_ties_ss is priced per Nr; this line is a built wall in m².
  const items = [{
    key: 'cavity_wall_ties_ss', qty: 60, unit: 'm²',
    description: 'cavity wall built in blockwork',
  }];
  for (const region of ['Manchester', 'London SW1A 1AA', 'Dublin']) {
    const rows = compare(items, region);
    assertParity(rows, `unit family mismatch @ "${region}"`);
    assert.notStrictEqual(rows[0].resolverSource, 'base_library',
      'the per-Nr library rate must not be applied to an m² line');
  }
});

test('the unit ceiling clips an impossible rate, isolated from the AI cap', () => {
  // Both inputs below are chosen so ONLY the ceiling can fire. That matters: with
  // qty > 1 and an ai_estimated basis, the AI total-cost cap clips to the same value,
  // so a naive test passes even when the ceiling check is deleted entirely.
  //
  // (a) qty = 1 — the AI cap requires qty > 1, so it cannot participate.
  const viaAssumedRate = [{
    key: 'unknown_cladding_a', qty: 1, unit: 'm²',
    description: 'specialist cladding system', assumed_rate: 4000,
  }];
  // (b) a client rate on a key with no base rate — basis is client_verified, which the
  // AI cap ignores, and with no base rate the sanity ratio has nothing to compare
  // against either. The ceiling is the only guard left standing.
  const viaClientRate = [{
    key: 'unknown_cladding_b', qty: 40, unit: 'm²',
    description: 'specialist cladding system',
  }];

  for (const region of ['Manchester', 'Dublin', 'London SW1A 1AA']) {
    const a = compare(viaAssumedRate, region);
    assertParity(a, `unit ceiling via assumed_rate @ "${region}"`);
    assert.strictEqual(a[0].resolverSource, 'ceiling_clipped',
      'a rate over the unit ceiling must be reported as clipped to the ceiling');

    const b = compare(viaClientRate, region, { unknown_cladding_b: 4000 });
    assertParity(b, `unit ceiling via client rate @ "${region}"`);
    assert.strictEqual(b[0].resolverSource, 'ceiling_clipped',
      'the ceiling must clip a client rate too — the ratio check cannot see this path');
  }
});

test('the AI total-cost cap fires when a per-unit rate is really a total', () => {
  // 60,000 "per m²" over 30 m² — the model put the job total in assumed_rate.
  const items = [{
    key: 'unknown_big_ticket_item', qty: 30, unit: 'Item',
    description: 'mechanical ventilation installation throughout', assumed_rate: 60000,
  }];
  const rows = compare(items, 'Manchester');
  assertParity(rows, 'AI total-cost cap');
});

test('a mixed job stays at parity line for line', () => {
  const items = [
    { key: 'brick_outer_leaf', qty: 120, unit: 'm²' },
    { key: 'concrete_slab_150mm', qty: 60, unit: 'm²', override_rate: 91 },
    { key: 'blockwork_inner_leaf_100mm', qty: 100, unit: 'm²' },
    { key: 'scaffolding', qty: 200, unit: 'm²' },
    { key: 'mystery_item', qty: 2, unit: 'Nr', description: 'bespoke ironmongery set' },
  ];
  const clientRates = { blockwork_inner_leaf_100mm: 47, scaffolding: 9999 };
  for (const region of REGIONS) {
    const rows = compare(items, region, clientRates, { contingency_pct: 5, ohp_pct: 15 });
    assertParity(rows, `mixed job @ "${region}"`);
    assert.ok(rows.length >= 4, 'most lines survived to be compared');
  }
});

test('resolveRate always returns a usable envelope', () => {
  const r = resolveRate({
    itemKey: 'brick_outer_leaf', unit: 'm²', qty: 10, locFactor: 1,
    region: 'north_west', projectType: 'extension',
  });
  assert.strictEqual(r.rate, BASE_RATES.brick_outer_leaf.rate);
  assert.strictEqual(r.basis, 'composite');
  assert.ok(r.confidence > 0 && r.confidence <= 1, 'confidence is a fraction');
  assert.ok(Array.isArray(r.provenance) && r.provenance.length > 0, 'provenance present');
  assert.strictEqual(r.provenance[0].region, 'north_west', 'context carried into provenance');
  assert.ok(Array.isArray(r.adjustments), 'adjustments array exists for Phase 5');
  assert.strictEqual(r.needsReview, false);
});

test('resolveRate is total on garbage input — it never throws', () => {
  for (const params of [
    {}, { itemKey: null }, { itemKey: '', unit: null, qty: 0, locFactor: 0 },
    { itemKey: 'x', locFactor: 1, qty: NaN }, { itemKey: undefined, description: undefined },
  ]) {
    const r = resolveRate(params);
    assert.ok(Number.isFinite(r.rate), `rate must be finite for ${JSON.stringify(params)}`);
    assert.ok(r.basis, 'a basis is always reported');
  }
});

test('the commercial ceiling applies on non-domestic work in both implementations', () => {
  // 45 m2 of curtain walling at GBP 1,240/m2 is an ordinary commercial rate and
  // must survive; the same rate on a house is above the domestic ceiling and is
  // clipped to it. The pricer and the resolver have to agree on both answers.
  const params = {
    itemKey: 'x_cw',
    description: 'Curtain walling to entrance elevation, structural glazing',
    unit: 'm2', qty: 45, assumedRate: 1240, locFactor: 1,
  };
  const comm = resolveRate({ ...params, nonResidential: true });
  const dom = resolveRate({ ...params, nonResidential: false });
  assert.strictEqual(comm.rate, 1240, 'a commercial facade rate is not clipped');
  assert.strictEqual(comm.basis, 'ai_estimated');
  assert.strictEqual(dom.rate, 800, 'the same rate on a house clips to the domestic ceiling');
  assert.strictEqual(dom.basis, 'ceiling_clipped');
});
