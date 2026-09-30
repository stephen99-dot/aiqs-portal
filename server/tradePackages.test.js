// Trade packages, canonical sections and markup by trade — the builder's view
// of a priced bill. All pure functions on deterministicPricer, so no database.
//
//   1. Every line gets a trade, deterministically, and the library keys land
//      where a builder would put them (the sparky's strip-out is electrical,
//      roof tiles are roofing not tiling, "decorate window" is decorating).
//   2. Section titles normalise to one canonical name in one order, so two
//      bills for two jobs read the same way; room-by-room bills keep their
//      own running order.
//   3. Per-trade markup: with no overrides the OH&P is exactly the flat %, with
//      overrides it is the sum over the lines, and the trade packages
//      reconcile to the construction total to the penny.

const test = require('node:test');
const assert = require('node:assert');

const pricer = require('./deterministicPricer');
const {
  BASE_RATES, TRADES, tradeForItem, normaliseTradeMarkup,
  canonicalSectionName, cleanSectionTitle, orderSections, CANONICAL_SECTION_NAMES,
  priceLockedQuantities, toPricedSections,
} = pricer;

// ── Trades ──────────────────────────────────────────────────────────────────

test('every library key resolves to a named trade, and almost none fall through', () => {
  const general = [];
  for (const [key, r] of Object.entries(BASE_RATES)) {
    const t = tradeForItem({ key, description: r.description, unit: r.unit });
    assert.ok(TRADES.includes(t), `${key} → "${t}" is not a canonical trade`);
    if (t === 'General Building') general.push(key);
  }
  // A handful of genuinely whole-package or builder's-work lumps are allowed
  // to stay general; anything beyond that means the ladder has a hole.
  assert.ok(general.length <= 6, 'too many library keys fall through to General Building: ' + general.join(', '));
});

test('library keys land in the trade a builder would sub them to', () => {
  const expect = {
    first_fix_electrical: 'Electrical',
    strip_out_electrics: 'Electrical',            // the sparky's job, not the demo gang's
    strip_out_heating: 'Plumbing & Heating',
    strip_out_plaster: 'Demolition & Strip-out',
    gas_boiler_combi: 'Plumbing & Heating',
    ufh_manifold_kitchen: 'Plumbing & Heating',   // manifold beats "kitchen"
    screed_ufh_75mm: 'Flooring & Screed',         // the screeder lays it
    kitchen_fitout_mid: 'Kitchen & Bathroom Fit-out',
    excavation_strip_foundation: 'Groundworks',
    concrete_slab_150mm: 'Groundworks',
    brick_outer_leaf: 'Brickwork & Blockwork',
    steel_lintels_catnic: 'Brickwork & Blockwork',
    structural_steel_beam: 'Structural Steel',
    roof_tiles_interlocking: 'Roofing',           // roofing, not tiling
    roof_trusses_fink: 'Carpentry & Joinery',     // the roof carcass is carpentry
    roof_structure_cut_timber: 'Carpentry & Joinery',
    internal_door_standard: 'Carpentry & Joinery',
    upvc_window_standard: 'Windows & Doors',
    sliding_patio_door: 'Windows & Doors',        // not "patio" external works
    decorate_window_timber: 'Decorating',
    emulsion_walls_2coat: 'Decorating',
    plasterboard_skim_walls: 'Plastering & Drylining',
    external_render: 'Plastering & Drylining',
    floor_tile_600x600: 'Tiling',
    lvt_flooring_karndean: 'Flooring & Screed',
    foul_drainage_110mm: 'Drainage & External Works',
    block_paving: 'Drainage & External Works',
    scaffolding: 'Preliminaries',
    skip_hire_8yd: 'Preliminaries',
    asbestos_removal: 'Specialist Works',
    provisional_sum: 'Fees & Provisional Sums',
    architect_fees: 'Fees & Provisional Sums',
    external_wall_insulation: 'Cladding & Insulation',
  };
  for (const [key, trade] of Object.entries(expect)) {
    const r = BASE_RATES[key];
    assert.ok(r, key + ' should be a library key');
    assert.strictEqual(tradeForItem({ key, description: r.description, unit: r.unit }), trade, key);
  }
});

test('unknown keys classify from the description, then the section, then General Building', () => {
  assert.strictEqual(tradeForItem({ key: 'custom_x1', description: 'Supply and fit 6 double sockets to kitchen', section: 'Kitchen' }), 'Electrical');
  assert.strictEqual(tradeForItem({ key: 'custom_x2', description: 'Allowance for works', section: 'Roof' }), 'Roofing');
  assert.strictEqual(tradeForItem({ key: 'custom_x3', description: 'Allowance for works', section: '13. Mechanical & Plumbing' }), 'Plumbing & Heating');
  assert.strictEqual(tradeForItem({ key: 'custom_x4', description: 'Allowance for works', section: 'Living Room' }), 'General Building');
  assert.strictEqual(tradeForItem(null), 'General Building');
});

test('normaliseTradeMarkup keeps known trades only, case-insensitively, clamped 0-100', () => {
  const m = normaliseTradeMarkup({ electrical: '10', 'Plumbing & Heating': 12.5, Bogus: 50, Roofing: 'abc', Decorating: 250, Tiling: null, Groundworks: '' });
  assert.deepStrictEqual(m, { Electrical: 10, 'Plumbing & Heating': 12.5, Decorating: 100 });
  assert.deepStrictEqual(normaliseTradeMarkup(null), {});
  assert.deepStrictEqual(normaliseTradeMarkup('nope'), {});
});

// ── Canonical sections ──────────────────────────────────────────────────────

test('section titles lose their numbering and map to one canonical name', () => {
  assert.strictEqual(cleanSectionTitle('1. Substructure & Foundations'), 'Substructure & Foundations');
  assert.strictEqual(cleanSectionTitle('1.   1. PRELIMINARIES'), 'PRELIMINARIES');
  assert.strictEqual(cleanSectionTitle('Section 3 - Roof:'), 'Roof');
  assert.strictEqual(cleanSectionTitle('A) External Works'), 'External Works');
  assert.strictEqual(cleanSectionTitle('14.0 Electrical'), 'Electrical');

  assert.strictEqual(canonicalSectionName('1. Substructure & Foundations'), 'Substructure');
  assert.strictEqual(canonicalSectionName('SUBSTRUCTURE'), 'Substructure');
  assert.strictEqual(canonicalSectionName('Windows & Doors'), 'Windows & External Doors');
  assert.strictEqual(canonicalSectionName('Mechanical'), 'Mechanical & Plumbing');
  assert.strictEqual(canonicalSectionName('13. Mechanical & Plumbing'), 'Mechanical & Plumbing');
  assert.strictEqual(canonicalSectionName('Preliminaries'), 'Preliminaries & General');
  assert.strictEqual(canonicalSectionName('Provisional Sums'), 'Provisional Sums');
  assert.strictEqual(canonicalSectionName('External Walls'), 'Superstructure');
  // Unknown titles keep their own name, un-shouted.
  assert.strictEqual(canonicalSectionName('HALL & STAIRS'), 'Hall & Stairs');
  assert.strictEqual(canonicalSectionName('Bedroom 2'), 'Bedroom 2');
  assert.strictEqual(canonicalSectionName(''), 'General');
  assert.strictEqual(canonicalSectionName(undefined), 'General');
  assert.strictEqual(CANONICAL_SECTION_NAMES.length, 16);
});

test('sections print in the standard order; room-by-room bills keep their running order', () => {
  const names = (secs) => orderSections(secs.map((name) => ({ name }))).map((s) => s.name);
  assert.deepStrictEqual(
    names(['Roof', 'Electrical', 'Preliminaries & General', 'Substructure', 'Superstructure', 'Provisional Sums', 'Internal Finishes']),
    ['Preliminaries & General', 'Substructure', 'Superstructure', 'Roof', 'Internal Finishes', 'Electrical', 'Provisional Sums'],
  );
  // Unknown (room) sections stay where they arrived relative to the last known one.
  assert.deepStrictEqual(
    names(['Preliminaries & General', 'Hall & Stairs', 'Bedroom 1', 'Kitchen', 'Bathroom', 'Provisional Sums']),
    ['Preliminaries & General', 'Hall & Stairs', 'Bedroom 1', 'Kitchen', 'Bathroom', 'Provisional Sums'],
  );
  // Provisional sums close the bill even when emitted first.
  assert.deepStrictEqual(names(['Provisional Sums', 'Roof', 'Substructure']), ['Substructure', 'Roof', 'Provisional Sums']);
});

test('priced items merge duplicate spellings of a section and carry a trade', () => {
  const items = [
    { key: 'excavation_strip_foundation', qty: 10, unit: 'm³', section: '1. Substructure & Foundations' },
    { key: 'concrete_slab_150mm', qty: 20, unit: 'm²', section: 'SUBSTRUCTURE' },
    { key: 'first_fix_electrical', qty: 1, unit: 'Item', section: '14. Electrical' },
  ];
  const r = priceLockedQuantities(items, '', {}, {});
  assert.deepStrictEqual(r.sections.map((s) => s.name), ['Substructure', 'Electrical']);
  assert.strictEqual(r.sections[0].items.length, 2);
  for (const s of r.sections) for (const it of s.items) {
    assert.ok(TRADES.includes(it.trade), it.key + ' trade');
    assert.strictEqual(typeof it.section_raw, 'string');
  }
  assert.strictEqual(r.sections[1].items[0].trade, 'Electrical');
});

// ── Markup by trade ─────────────────────────────────────────────────────────

const JOB = [
  { key: 'site_welfare', qty: 1, unit: 'Item', section: 'Preliminaries' },
  { key: 'excavation_strip_foundation', qty: 12, unit: 'm³', section: 'Substructure' },
  { key: 'brick_outer_leaf', qty: 40, unit: 'm²', section: 'Superstructure' },
  { key: 'roof_tiles_interlocking', qty: 45, unit: 'm²', section: 'Roof' },
  { key: 'first_fix_electrical', qty: 1, unit: 'Item', section: 'Electrical' },
  { key: 'second_fix_electrical', qty: 1, unit: 'Item', section: 'Electrical' },
  { key: 'first_fix_plumbing', qty: 1, unit: 'Item', section: 'Mechanical & Plumbing' },
  { key: 'plasterboard_skim_walls', qty: 60, unit: 'm²', section: 'Internal Finishes' },
];
const r2 = (n) => Math.round(n * 100) / 100;

test('no markup at all: nothing added, but the trade packages still reconcile', () => {
  const r = priceLockedQuantities(JOB, '', {}, {});
  assert.strictEqual(r.summary.ohp, 0);
  assert.strictEqual(r.summary.markup_by_trade, false);
  assert.strictEqual(r.summary.ohp_effective_pct, 0);
  assert.strictEqual(r.summary.grand_total, r2(r.summary.construction_total * 1.2));
  const sum = r.summary.trades.reduce((a, t) => a + t.subtotal, 0);
  assert.ok(Math.abs(sum - r.summary.construction_total) < 0.011, 'trade packages sum to the construction total');
  const lines = r.summary.trades.reduce((a, t) => a + t.item_count, 0);
  assert.strictEqual(lines, JOB.length);
});

test('a flat markup is exactly construction total × ohp_pct, as before', () => {
  const r = priceLockedQuantities(JOB, '', {}, { ohp_pct: 15 });
  assert.strictEqual(r.summary.ohp, r2(r.summary.construction_total * 0.15));
  assert.strictEqual(r.summary.markup_by_trade, false);
  assert.strictEqual(r.summary.ohp_effective_pct, 15);
  for (const s of r.sections) {
    assert.strictEqual(s.markup_pct, 15);
    assert.strictEqual(s.total_with_markup, r2(s.subtotal * 1.15));
  }
  for (const t of r.summary.trades) assert.strictEqual(t.markup_pct, 15);
});

test('per-trade markup overrides the default for that package only, and everything reconciles', () => {
  const r = priceLockedQuantities(JOB, '', {}, { ohp_pct: 20, contingency_pct: 5, trade_markup: { Electrical: 10, 'plumbing & heating': 10, Bogus: 99 } });
  const s = r.summary;
  assert.strictEqual(s.markup_by_trade, true);
  assert.deepStrictEqual(s.trade_markup, { Electrical: 10, 'Plumbing & Heating': 10 });
  assert.strictEqual(s.ohp_pct, 20, 'the default is reported as ohp_pct');

  const byTrade = Object.fromEntries(s.trades.map((t) => [t.trade, t]));
  assert.strictEqual(byTrade.Electrical.markup_pct, 10);
  assert.strictEqual(byTrade.Electrical.markup_overridden, true);
  assert.strictEqual(byTrade['Plumbing & Heating'].markup_pct, 10);
  assert.strictEqual(byTrade.Roofing.markup_pct, 20);
  assert.strictEqual(byTrade.Roofing.markup_overridden, false);

  // OH&P is the sum over the lines…
  let expected = 0;
  for (const sec of r.sections) for (const it of sec.items) expected += it.total * (it.markup_pct / 100);
  assert.strictEqual(s.ohp, r2(expected));
  // …which is less than the flat 20% would give, and more than 10% would.
  assert.ok(s.ohp < s.construction_total * 0.2 && s.ohp > s.construction_total * 0.1);
  assert.ok(s.ohp_effective_pct > 10 && s.ohp_effective_pct < 20);
  // Sections carry their own effective markup and total.
  const elec = r.sections.find((x) => x.name === 'Electrical');
  assert.strictEqual(elec.markup_pct, 10);
  assert.strictEqual(elec.total_with_markup, r2(elec.subtotal * 1.1));
  assert.deepStrictEqual(elec.trades, ['Electrical']);
  // Trade packages reconcile to the construction total and the OH&P.
  const tSub = s.trades.reduce((a, t) => a + t.subtotal, 0);
  const tMark = s.trades.reduce((a, t) => a + t.markup, 0);
  assert.ok(Math.abs(tSub - s.construction_total) < 0.011);
  assert.ok(Math.abs(tMark - s.ohp) < 0.011);
  assert.strictEqual(s.construction_total_with_markup, r2(s.construction_total + s.ohp));
  // The cascade is unchanged in shape: contingency on construction, VAT on the lot.
  assert.strictEqual(s.contingency, r2(s.construction_total * 0.05));
  assert.strictEqual(s.grand_total, r2((s.construction_total + s.contingency + s.ohp) * 1.2));
});

test('toPricedSections carries trade and markup through to the Excel renderer', () => {
  const r = priceLockedQuantities(JOB, '', {}, { ohp_pct: 20, trade_markup: { Electrical: 10 } });
  const secs = toPricedSections(r);
  const elec = secs.find((s) => s.title === 'Electrical');
  assert.ok(elec);
  assert.strictEqual(elec.markup_pct, 10);
  assert.strictEqual(elec.total_with_markup, r2(elec.items.reduce((a, i) => a + i.total, 0) * 1.1));
  for (const it of elec.items) { assert.strictEqual(it.trade, 'Electrical'); assert.strictEqual(it.markup_pct, 10); }
  const roof = secs.find((s) => s.title === 'Roof');
  for (const it of roof.items) assert.strictEqual(it.markup_pct, 20);
});
