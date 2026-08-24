/**
 * Two delivered bills drive every test here.
 *
 * Wolfe Pavilion — a 470 m2 commercial sports-club pavilion — was priced as a
 * domestic extension. detectProjectType() returned 'general', the cost/m2 cap
 * read the 250 m2 slab line as the building's floor area, and the residential
 * envelope of GBP 2,800/m2 rescaled all 114 rates by 0.3198 so the total would
 * land on 250 x 2,800 = GBP 700,000. The workbook said GBP 700,000.92. The chat
 * said GBP 1,252,782. Both reconciled internally.
 *
 * The tests assert the two halves of the fix: the domestic caps stand down on a
 * building the library is not for, and the coverage gate refuses to call the
 * result a bill when it cannot support one.
 */
const test = require('node:test');
const assert = require('node:assert');
const { priceLockedQuantities, detectBuildingClass } = require('./deterministicPricer');
const { assessCoverage, subcontractExposure } = require('./coverageGate');

// The pavilion, reduced to the lines that decide its classification and price.
const PAVILION = [
  { key: 'concrete_slab_150mm', description: 'New concrete ground-bearing structural slab to SE design', unit: 'm2', qty: 250, assumed_rate: 156, section: 'Substructure' },
  { key: 'x_glazing', description: 'Supply & install new external aluminium windows & doors (commercial curtain walling)', unit: 'm2', qty: 45, assumed_rate: 1240, section: 'Windows & Doors' },
  { key: 'x_mvhr', description: 'Mechanical ventilation per M200 — HRVU1 heat-recovery unit to changing rooms', unit: 'Item', qty: 1, assumed_rate: 56000, section: 'Mechanical' },
  { key: 'x_ips', description: 'Toilet/shower cubicles & IPS wall panelling to WCs and changing rooms', unit: 'Nr', qty: 12, assumed_rate: 1440, section: 'Fit-out' },
  { key: 'x_docm', description: 'WC suites incl. accessible Doc M pack per sanitary schedule', unit: 'Nr', qty: 14, assumed_rate: 840, section: 'Fit-out' },
  { key: 'x_steel', description: 'Supply & install structural steelwork to SE design', unit: 'Item', qty: 9, assumed_rate: 7000, section: 'Superstructure' },
  { key: 'x_walls', description: 'New external wall type A above DPC (cavity wall)', unit: 'm2', qty: 150, assumed_rate: 330, section: 'Superstructure' },
  { key: 'x_ext', description: 'Hard surfaces — tarmac road/path incl. sub-base', unit: 'm2', qty: 350, assumed_rate: 116, section: 'External Works' },
];

// A plain domestic rear extension, to prove nothing here disarms the guards
// that the library WAS built for.
const HOUSE = [
  { key: 'concrete_slab_150mm', description: 'Ground bearing slab to rear extension', unit: 'm2', qty: 30, section: 'Substructure' },
  { key: 'x_kitchen', description: 'New kitchen to the extension, mid range units', unit: 'Item', qty: 1, assumed_rate: 9000, section: 'Fit-out' },
  { key: 'x_ensuite', description: 'En-suite shower room to master bedroom', unit: 'Item', qty: 1, assumed_rate: 6000, section: 'Fit-out' },
];

// ───────────────────────── classification ─────────────────────────

test('a sports pavilion with commercial elements classifies as non-residential', () => {
  const c = detectBuildingClass(PAVILION, 'Sports cricket club pavilion refurbishment and extension');
  assert.strictEqual(c.klass, 'non_residential');
  assert.strictEqual(c.sector, 'sports');
  assert.ok(c.signals.some((s) => s.startsWith('element:')), JSON.stringify(c.signals));
});

test('a domestic extension is never classified non-residential', () => {
  const c = detectBuildingClass(HOUSE, 'single storey rear extension');
  assert.notStrictEqual(c.klass, 'non_residential');
  assert.strictEqual(c.residential, true);
});

test('one stray building word is not enough to reclassify a house', () => {
  // "cafe" in a schedule of finishes, and nothing else commercial about it.
  const c = detectBuildingClass(
    [{ description: 'Supply cafe-style pendant lights to kitchen', unit: 'Nr', qty: 3 }],
    'single storey rear extension',
  );
  assert.strictEqual(c.klass, 'unknown', JSON.stringify(c));
});

// ───────────────────── the caps stand down ─────────────────────

test('a commercial job is not rescaled to a domestic cost-per-m2 envelope', () => {
  const r = priceLockedQuantities(PAVILION, 'Cheshire CW1 2AB', {}, {
    project_type: 'sports pavilion refurbishment and extension',
  });
  assert.strictEqual(r.building_class.klass, 'non_residential');
  assert.strictEqual(r.summary.rates_rescaled_by_cap, false);
  assert.strictEqual(r.summary.construction_total, r.summary.pre_cap_construction_total,
    'the total after caps must equal the total as priced');
  assert.ok(r.cap_events.some((e) => e.cap === 'cost_per_m2' && e.action === 'suppressed'),
    JSON.stringify(r.cap_events));
});

test('a domestic cost cap still fires when a real floor area is supplied', () => {
  // The historic guard, unchanged: a small floor area with far too much work in it.
  const r = priceLockedQuantities(HOUSE, 'Manchester M1 1AA', {}, {
    project_type: 'extension', floor_area: 4,
  });
  assert.ok(r.warnings.some((w) => /COST CAP APPLIED/.test(w)), JSON.stringify(r.warnings));
  assert.strictEqual(r.summary.rates_rescaled_by_cap, true);
  assert.ok(r.summary.pre_cap_construction_total > r.summary.construction_total);
});

test('a slab line is never trusted as the floor area for a rescale', () => {
  // The same shape of job with no floor_area supplied. Against the 4 m2 slab
  // line the bill reads over the envelope — but 4 m2 is the new slab, not the
  // building. Report it; do not rewrite every rate to fit a number nobody
  // measured. This is exactly how the pavilion lost its rates: GIA 470, slab
  // 250, and 250 x GBP 2,800 became the target.
  const items = HOUSE.map((i) => (i.key === 'concrete_slab_150mm' ? { ...i, qty: 4 } : i));
  const r = priceLockedQuantities(items, 'Manchester M1 1AA', {}, { project_type: 'extension' });
  assert.strictEqual(r.summary.rates_rescaled_by_cap, false);
  const ev = r.cap_events.find((e) => e.cap === 'cost_per_m2');
  assert.ok(ev, JSON.stringify(r.cap_events));
  assert.strictEqual(ev.action, 'reported_only');
  assert.strictEqual(ev.reason, 'floor_area_is_slab_proxy');
});

test('every rescale is recorded — a cap can never be silent again', () => {
  const r = priceLockedQuantities(HOUSE, 'Manchester M1 1AA', {}, {
    project_type: 'extension', floor_area: 4,
  });
  const resc = r.cap_events.filter((e) => e.action === 'rescaled');
  assert.ok(resc.length >= 1);
  for (const e of resc) {
    assert.ok(e.scale > 0 && e.scale < 1, JSON.stringify(e));
    assert.ok(e.lines >= 1);
  }
  assert.ok(r.review_flags.some((f) => /rescaled_by/.test(f.reason || '')));
});

// ───────────────────── commercial rates ─────────────────────

test('the commercial library prices commercial work from a library rate', () => {
  const items = [
    { key: 'comm_curtain_walling', description: 'Curtain walling to entrance elevation', unit: 'm2', qty: 45, section: 'Envelope' },
    { key: 'comm_structural_steel_erected', description: 'Structural steelwork to SE design', unit: 't', qty: 12, section: 'Frame' },
    { key: 'comm_wc_accessible_docm', description: 'Doc M accessible WC pack', unit: 'Nr', qty: 2, section: 'Sanitary' },
  ];
  const r = priceLockedQuantities(items, 'Cheshire CW1 2AB', {}, { project_type: 'community pavilion' });
  const all = r.sections.flatMap((s) => s.items);
  for (const it of all) assert.strictEqual(it.rate_source, 'base_library', it.key);
  assert.strictEqual(r.summary.rate_source_coverage.coverage_pct, 100);
});

test('commercial glazing survives the ceiling on a commercial job and is clipped on a house', () => {
  const line = (desc) => ([{ key: 'x_cw', description: desc, unit: 'm2', qty: 40, assumed_rate: 1240, section: 'Envelope' }]);
  const comm = priceLockedQuantities(
    line('Curtain walling to entrance elevation of the sports pavilion, structural glazing'),
    'London EC1A 1BB', {}, { project_type: 'sports pavilion' },
  );
  const dom = priceLockedQuantities(
    line('Glazed screen to rear of dwelling'), 'London EC1A 1BB', {}, { project_type: 'extension' },
  );
  const cRate = comm.sections[0].items[0].rate;
  const dRate = dom.sections[0].items[0].rate;
  assert.strictEqual(comm.sections[0].items[0].rate_source, 'ai_estimated');
  assert.strictEqual(dom.sections[0].items[0].rate_source, 'ceiling_clipped');
  assert.ok(cRate > dRate, `commercial ${cRate} should exceed clipped domestic ${dRate}`);
});

test('a provisional sum stating its figure is carried at face value, never at GBP 1', () => {
  const items = [
    { key: 'x_ps', description: 'P.Sum 4 — provisional sum of £75,000 for licensed asbestos removal', unit: 'Item', qty: 1, section: 'Preliminaries' },
    { key: 'x_ps2', description: 'Provisional sum for statutory undertakers diversions', unit: 'Item', qty: 1, section: 'Preliminaries' },
  ];
  const r = priceLockedQuantities(items, 'Manchester M1 1AA', {}, { project_type: 'commercial' });
  const [a, b] = r.sections[0].items;
  assert.strictEqual(a.rate, 75000, 'stated sum carried at face value');
  assert.strictEqual(a.rate_source, 'stated_sum');
  // And NOT location-adjusted: a GBP 75,000 provisional sum is GBP 75,000
  // wherever the site is. Manchester's factor is 0.98, so a wrong answer here
  // reads GBP 73,500 and looks entirely plausible.
  assert.ok(b.rate > 1, `an unstated provisional sum must not price at GBP ${b.rate}`);
  assert.notStrictEqual(b.rate_source, 'stated_sum');
});

// ───────────────────── the gate itself ─────────────────────

test('a bill whose rates were rescaled to hit a target is declined', () => {
  const r = priceLockedQuantities(HOUSE, 'Manchester M1 1AA', {}, {
    project_type: 'extension', floor_area: 4,
  });
  const v = assessCoverage(r);
  assert.strictEqual(v.verdict, 'decline');
  assert.strictEqual(v.blocking, true);
  assert.match(v.reasons[0], /multiplied by/);
  assert.match(v.statement, /not going to produce a bill/);
});

test('a non-residential job with no commercial-library line is declined', () => {
  const r = priceLockedQuantities(PAVILION, 'Cheshire CW1 2AB', {}, {
    project_type: 'sports pavilion refurbishment and extension',
  });
  const v = assessCoverage(r);
  assert.strictEqual(v.verdict, 'decline');
  assert.ok(v.reasons.some((x) => /commercial rate library/.test(x)), JSON.stringify(v.reasons));
  // And it must say what would fix it, not just refuse.
  assert.ok(v.remedy.length >= 2, JSON.stringify(v.remedy));
  assert.ok(v.remedy.some((x) => /quotation/i.test(x)));
});

test('a fully library-priced bill issues without qualification', () => {
  const items = [
    { key: 'comm_curtain_walling', description: 'Curtain walling to entrance', unit: 'm2', qty: 45, section: 'Envelope' },
    { key: 'comm_blockwork_dense_140', description: '140mm dense blockwork inner leaf', unit: 'm2', qty: 220, section: 'Superstructure' },
    { key: 'comm_vinyl_safety_flooring', description: 'Safety vinyl to changing rooms', unit: 'm2', qty: 300, section: 'Finishes' },
    { key: 'comm_decoration_commercial', description: 'Contract emulsion throughout', unit: 'm2', qty: 900, section: 'Decoration' },
    { key: 'comm_toilet_cubicle_hpl', description: 'HPL changing cubicles', unit: 'Nr', qty: 12, section: 'Fit-out' },
  ];
  const r = priceLockedQuantities(items, 'Cheshire CW1 2AB', {}, { project_type: 'community pavilion' });
  const v = assessCoverage(r);
  assert.strictEqual(v.verdict, 'issue');
  assert.strictEqual(v.blocking, false);
  assert.strictEqual(v.remedy.length, 0);
});

test('subcontract exposure names the packages carrying guessed rates', () => {
  const r = priceLockedQuantities(PAVILION, 'Cheshire CW1 2AB', {}, { project_type: 'sports pavilion' });
  const packs = subcontractExposure(r.sections.flatMap((s) => s.items));
  const names = packs.map((p) => p.package);
  assert.ok(names.includes('mechanical services'), names.join(', '));
  assert.ok(names.includes('structural steelwork'), names.join(', '));
  for (const p of packs) assert.ok(p.value_pct >= 0 && p.value_pct <= 100);
});

test('strict mode makes a qualified bill blocking too', () => {
  const items = [
    { key: 'comm_curtain_walling', description: 'Curtain walling to entrance', unit: 'm2', qty: 45, section: 'Envelope' },
    { key: 'x_guess', description: 'Sundry builders work and attendances', unit: 'Item', qty: 1, assumed_rate: 30000, section: 'Prelims' },
  ];
  const r = priceLockedQuantities(items, 'Cheshire CW1 2AB', {}, { project_type: 'community pavilion' });
  const loose = assessCoverage(r);
  const strict = assessCoverage(r, { strict: true });
  assert.strictEqual(loose.verdict, strict.verdict);
  if (loose.verdict === 'qualify') {
    assert.strictEqual(loose.blocking, false);
    assert.strictEqual(strict.blocking, true);
  }
});

test('a stated sum counts as evidenced, not as an unpriced allowance', () => {
  const items = [
    { key: 'x_ps', description: 'P.Sum 13 — provisional sum of £50,000 for the cafe air source heat pump', unit: 'Item', qty: 1, section: 'Mechanical' },
    { key: 'comm_blockwork_dense_140', description: '140mm dense blockwork inner leaf', unit: 'm2', qty: 220, section: 'Superstructure' },
  ];
  const r = priceLockedQuantities(items, 'Cheshire CW1 2AB', {}, { project_type: 'community pavilion' });
  const v = assessCoverage(r);
  assert.strictEqual(v.unpriced_allowances.length, 0, JSON.stringify(v.unpriced_allowances));
  // Both lines rest on something somebody stands behind, so nothing is estimated.
  assert.strictEqual(v.coverage.estimated_pct, 0);
  assert.strictEqual(v.verdict, 'issue');
});
