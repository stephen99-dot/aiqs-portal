// Written from the Wolfe Pavilion tender, which passed the recalc gate and the
// pre-issue gate and was still not issuable.
const test = require('node:test');
const assert = require('node:assert');
const { checkBillCredibility, checkNarrativeTotals, checkProvisionalSums,
        checkFallbackConcentration, checkRateMonoculture } = require('./billCredibility');

// Every Item rate on that job was an integer multiple of £319.79.
const BASE = 319.79;
const WOLFE = {
  summary: { construction_total: 700001, grand_total: 840001, vat_rate: 20, currency: 'GBP' },
  sections: [
    { title: 'Preliminaries', items: [
      { description: 'Site management & supervision, 40 weeks @ £1,450/wk', unit: 'Item', qty: 40, rate: BASE * 3, total: 38375, rate_source: 'fallback_estimated' },
      { description: 'Site setup & general costs', unit: 'Item', qty: 1, rate: BASE * 6, total: 1919, rate_source: 'fallback_estimated' },
    ] },
    { title: 'External Works', items: [
      { description: 'External steel canopy/pergola', unit: 'Item', qty: 1, rate: BASE * 90, total: 28781, rate_source: 'fallback_estimated' },
      { description: "P.Sum 4 — Soft landscaping to areas labelled 'XXX'. Fixed sum.", unit: 'Item', qty: 1, rate: BASE * 10, total: 3198, rate_source: 'fallback_estimated' },
      { description: 'P.Sum 10 — External signage for CAFÉ and Clubhouse. Fixed sum.', unit: 'Item', qty: 1, rate: BASE * 6, total: 1919, rate_source: 'fallback_estimated' },
    ] },
    { title: 'Mechanical', items: [
      { description: 'P.Sum 13 — ASHP to the Café in lieu of electric radiators. Fixed sum.', unit: 'Item', qty: 1, rate: BASE * 50, total: 15989, rate_source: 'fallback_estimated' },
    ] },
  ],
};

test('catches a narrative total that is not in the bill', () => {
  // The reply announced £1,252,782 against a £700,001 bill.
  const f = checkNarrativeTotals(
    'The result is £1,252,782 ex-VAT (£1,503,338 inc VAT), ~£2,665/m² over 470 m².',
    { construction_total: 700001, grand_total: 840001 },
  );
  assert.ok(f.length >= 1);
  assert.strictEqual(f[0].severity, 'high');
  assert.match(f[0].message, /not a price/);
});

test('accepts figures that ARE the bill', () => {
  const f = checkNarrativeTotals(
    'Construction is £700,001 ex-VAT (£840,001 inc VAT), with £140,000 of VAT.',
    { construction_total: 700001, grand_total: 840001 },
  );
  assert.strictEqual(f.length, 0, JSON.stringify(f));
});

test('ignores rates and small allowances in prose', () => {
  const f = checkNarrativeTotals(
    'Priced at £1,450/wk with a £250 day rate.',
    { construction_total: 700001, grand_total: 840001 },
  );
  assert.strictEqual(f.length, 0);
});

test('catches provisional sums re-priced instead of carried', () => {
  // 13 sums fixed at £75,000; the bill carried £21,106 of the ones modelled here.
  const f = checkProvisionalSums(WOLFE.sections, 75000);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].severity, 'high');
  assert.match(f[0].message, /fixed by the tender documents/);
  assert.ok(f[0].shortfall > 0);
});

test('accepts provisional sums carried at their stated total', () => {
  const sections = [{ title: 'X', items: [
    { description: 'P.Sum 1 — kitchen units. Fixed sum.', qty: 1, rate: 16000, total: 16000, rate_source: 'override' },
    { description: 'P.Sum 2 — café ASHP. Fixed sum.', qty: 1, rate: 25000, total: 25000, rate_source: 'override' },
  ] }];
  assert.strictEqual(checkProvisionalSums(sections, 41000).length, 0);
});

test('flags provisional sums priced by the estimator when no total is stated', () => {
  const f = checkProvisionalSums(WOLFE.sections, null);
  assert.strictEqual(f.length, 1);
  assert.match(f[0].message, /carried at a stated value/);
});

test('catches a bill resting on generic fallback estimates', () => {
  const f = checkFallbackConcentration(WOLFE.sections);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].severity, 'high');
  assert.ok(f[0].share > 60);
  assert.match(f[0].message, /outside the rate library/);
});

test('a properly-priced bill raises nothing', () => {
  const sections = [{ title: 'S', items: [
    { description: 'Facing brickwork', unit: 'm2', qty: 120, rate: 142, total: 17040, rate_source: 'client_verified' },
    { description: 'Blockwork inner leaf', unit: 'm2', qty: 100, rate: 88, total: 8800, rate_source: 'base_library' },
    { description: 'Concrete slab', unit: 'm2', qty: 60, rate: 91, total: 5460, rate_source: 'base_library' },
    { description: 'Plasterboard and skim', unit: 'm2', qty: 200, rate: 34, total: 6800, rate_source: 'base_library' },
    { description: 'Roof tiling', unit: 'm2', qty: 150, rate: 67, total: 10050, rate_source: 'client_verified' },
    { description: 'Windows', unit: 'Nr', qty: 12, rate: 780, total: 9360, rate_source: 'base_library' },
  ] }];
  assert.strictEqual(checkFallbackConcentration(sections).length, 0);
  assert.strictEqual(checkRateMonoculture(sections).length, 0);
});

test('catches rates that are all multiples of one estimator base', () => {
  const f = checkRateMonoculture(WOLFE.sections);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].severity, 'high');
  assert.match(f[0].message, /one estimator pricing the whole/);
});

test('the whole Wolfe bill is blocking on every count', () => {
  const r = checkBillCredibility(WOLFE, {
    replyText: 'The result is £1,252,782 ex-VAT (£1,503,338 inc VAT).',
    statedProvisionalSums: 75000,
  });
  assert.strictEqual(r.blocking, true);
  const ids = r.findings.map((f) => f.id);
  for (const expected of ['fallback_concentration', 'rate_monoculture', 'provisional_sums_repriced', 'narrative_total_mismatch']) {
    assert.ok(ids.includes(expected), `expected ${expected}, got ${ids.join(', ')}`);
  }
});
