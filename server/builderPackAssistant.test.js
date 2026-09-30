// Tests for the builder-pack assistant's changeset validation + preview.
//
// Same posture as estimatorAssistant.test.js, but the data shape is the BOQ
// editor's: labour/materials are LINE totals, composite lines carry their money
// in `total` alone, and items are addressed by flat refs across sections while
// the normalized changeset carries (s, i) locations the page applies directly.

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAndPreview, snapshotForPrompt, flattenItems, baseNet } = require('./builderPackAssistantRoutes')._test;

const PROJECT = { id: 'p1', title: '9 Dartmouth Road', currency: 'GBP' };
const CONTROLS = { overhead_pct: 0, profit_pct: 0, contingency_pct: 0, vat_pct: 0, provisional_sum: 0 };
const SECTIONS = [
  {
    number: '1', title: 'Preliminaries', items: [
      { itemRef: '1.1', description: 'Site set-up', unit: 'Item', qty: 1, labour: 1540, materials: 660, total: 2200 },
      { itemRef: '1.2', description: 'Independent access scaffold', unit: 'Item', qty: 1, labour: 11400, materials: 7600, total: 19000 },
    ],
  },
  {
    number: '2', title: 'Electrics', items: [
      { itemRef: '2.1', description: 'First fix electrics', unit: 'Item', qty: 1, labour: 900, materials: 600, total: 1500 },
      // Composite line — no split, money lives in `total`.
      { itemRef: '2.2', description: 'EV charger supply & fit', unit: 'Item', qty: 1, labour: 0, materials: 0, total: 950 },
    ],
  },
];

test('flat refs run 1..N in document order across sections', () => {
  const flat = flattenItems(SECTIONS);
  assert.equal(flat.length, 4);
  assert.equal(flat[0].ref, 1);
  assert.deepEqual([flat[2].s, flat[2].i], [1, 0]); // ref 3 = first electrics item
});

test('updates carry section/item locations and the base-net preview moves', () => {
  const v = validateAndPreview({
    summary: 'Scaffold up to £21,500',
    line_updates: [{ ref: 2, labour: 12900, materials: 8600 }],
  }, PROJECT, SECTIONS, CONTROLS);
  assert.equal(v.ok, true);
  const p = v.proposal;
  assert.deepEqual([p.line_updates[0].s, p.line_updates[0].i], [0, 1]);
  assert.equal(p.before_total, 23650); // 2200 + 19000 + 1500 + 950
  assert.equal(p.after_total, 26150);  // scaffold 19000 → 21500
  assert.match(p.changes[0].label, /labour £11400 → £12900/);
});

test('a split edit beats a stray composite total on the same update', () => {
  const v = validateAndPreview({
    summary: 'x',
    line_updates: [{ ref: 3, labour: 1100, materials: 750, total: 9999 }],
  }, PROJECT, SECTIONS, CONTROLS);
  assert.equal(v.ok, true);
  assert.equal(v.proposal.line_updates[0].total, undefined);
  assert.equal(v.proposal.after_total, 24000); // 1500 → 1850, nothing zeroed
});

test('composite lines update via total; removals splice bottom-up; adds target a section by number', () => {
  const v = validateAndPreview({
    summary: 'EV charger up, drop scaffold, add skip to prelims',
    line_updates: [{ ref: 4, total: 1200 }],
    remove_refs: [2],
    new_lines: [{ section_number: '1', description: 'Second skip', unit: 'nr', qty: 1, labour: 0, materials: 400 }],
  }, PROJECT, SECTIONS, CONTROLS);
  assert.equal(v.ok, true);
  const p = v.proposal;
  assert.equal(p.after_total, 5300); // 2200 + 1500 + 1200 + 400
  assert.deepEqual([p.new_lines[0].s], [0]);
  assert.equal(p.remove_locs[0].ref, 2);
  assert.ok(p.totals_note.length > 0);
});

test('a new section is created with the next number and carries its money', () => {
  const v = validateAndPreview({
    summary: 'New appliances section',
    new_sections: [{
      title: 'Appliances',
      items: [{ description: 'Supply only — Siemens ovens (provisional)', unit: 'Nr', qty: 4, total: 2796 }],
    }],
  }, PROJECT, SECTIONS, CONTROLS);
  assert.equal(v.ok, true);
  const p = v.proposal;
  assert.equal(p.new_sections.length, 1);
  assert.equal(p.new_sections[0].number, '3');       // follows sections 1 and 2
  assert.equal(p.new_sections[0].items[0].total, 2796);
  assert.equal(p.after_total, 26446);                // 23650 + 2796 — the price lands
  assert.match(p.changes[0].label, /New section 3: Appliances .*£2796/);
  assert.equal(v.warnings.length, 0);
});

test('a new line priced only as a composite total keeps its money', () => {
  const v = validateAndPreview({
    summary: 'Skip',
    new_lines: [{ section_number: '1', description: 'Second skip', unit: 'nr', qty: 1, total: 400 }],
  }, PROJECT, SECTIONS, CONTROLS);
  assert.equal(v.ok, true);
  assert.equal(v.proposal.new_lines[0].total, 400);
  assert.equal(v.proposal.after_total, 24050);
});

test('a priceless new item and an unmatched section number both warn instead of failing silently', () => {
  const v = validateAndPreview({
    summary: 'x',
    new_lines: [{ section_number: '9', description: 'Mystery item', qty: 1 }],
  }, PROJECT, SECTIONS, CONTROLS);
  assert.equal(v.ok, true);
  assert.equal(v.warnings.length, 2); // no section "9" + no price
  assert.match(v.warnings.join(' | '), /no section numbered "9"/);
  assert.match(v.warnings.join(' | '), /no price/);
});

test('unknown refs are warned about, not applied; empty proposals are refused', () => {
  const v = validateAndPreview({ summary: 'x', line_updates: [{ ref: 40, qty: 2 }] }, PROJECT, SECTIONS, CONTROLS);
  assert.equal(v.ok, false);
  const v2 = validateAndPreview({
    summary: 'x',
    line_updates: [{ ref: 40, qty: 2 }, { ref: 1, qty: 2 }],
  }, PROJECT, SECTIONS, CONTROLS);
  assert.equal(v2.ok, true);
  assert.equal(v2.warnings.length, 1);
});

test('control changes are listed and clamped to numbers', () => {
  const v = validateAndPreview({ summary: 'VAT on', controls: { vat_pct: '20', profit_pct: 12.5 } }, PROJECT, SECTIONS, CONTROLS);
  assert.equal(v.ok, true);
  assert.equal(v.proposal.controls.vat_pct, 20);
  assert.equal(v.proposal.controls.profit_pct, 12.5);
  assert.equal(v.proposal.changes.filter(c => c.kind === 'header').length, 2);
  // Controls alone don't move the base net.
  assert.equal(v.proposal.before_total, v.proposal.after_total);
});

test('snapshot shows sections, refs, composite money and the net', () => {
  const snap = snapshotForPrompt(PROJECT, SECTIONS, CONTROLS);
  assert.match(snap, /-- Section 1: Preliminaries/);
  assert.match(snap, /^4 \| 2 \| 2\.2 \| EV charger supply & fit .*\| 950$/m);
  assert.match(snap, /Net build cost .*£23650/);
  assert.equal(baseNet(SECTIONS), 23650);
});

// ── Markup by trade ─────────────────────────────────────────────────────────
// "Put 10% on the sparky and plumber" arrives as controls.trade_markup and is
// mapped onto the sections those trades dominate, merged over the overrides
// already on the page; a trade with no section, an unknown trade name and a
// provisional section are warned about rather than silently dropped.
test('trade_markup maps onto per-section uplift overrides and merges with existing ones', () => {
  const controls = { ...CONTROLS, per_trade_ohp: { '1': 41 } };
  const v = validateAndPreview({
    summary: '10% on the electrician, and remember it',
    controls: { trade_markup: { Electrical: 10, Roofing: 12, Bogus: 5 }, remember_trade_markup: true },
  }, PROJECT, SECTIONS, controls);
  assert.equal(v.ok, true);
  assert.deepEqual(v.proposal.controls.per_trade_ohp, { '1': 41, '2': 10 });
  assert.deepEqual(v.proposal.controls.trade_markup, { Electrical: 10, Roofing: 12 });
  assert.equal(v.proposal.controls.remember_trade_markup, true);
  const labels = v.proposal.changes.map((c) => c.label);
  assert.ok(labels.some((l) => /Electrical → 10% uplift \(section 2 Electrics\)/.test(l)), labels.join(' | '));
  assert.ok(labels.some((l) => /standing markup by trade/.test(l)));
  assert.ok(v.warnings.some((w) => /unknown trade "Bogus"/.test(w)));
  assert.ok(v.warnings.some((w) => /no section on this bill is Roofing/.test(w)));
});

test('section_uplift sets or clears one section by number, and refuses provisional sections', () => {
  const sections = SECTIONS.concat([{ number: '9', title: 'Provisional Sums', provisional: true, items: [{ description: 'PS', labour: 0, materials: 0, total: 500 }] }]);
  const controls = { ...CONTROLS, per_trade_ohp: { '1': 41, '2': 10 } };
  const v = validateAndPreview({ summary: 'x', controls: { section_uplift: { '1': 30, '2': null, '9': 5, '42': 1 } } }, PROJECT, sections, controls);
  assert.equal(v.ok, true);
  assert.deepEqual(v.proposal.controls.per_trade_ohp, { '1': 30 });
  assert.ok(v.warnings.some((w) => /section 9 is provisional/.test(w)));
  assert.ok(v.warnings.some((w) => /unknown section number 42/.test(w)));
});

test('the snapshot names each section\'s trade, the current overrides and the standing markup', () => {
  const snap = snapshotForPrompt(PROJECT, SECTIONS, { ...CONTROLS, per_trade_ohp: { '2': 10 } }, { tradeMarkup: { Electrical: 10 } });
  assert.match(snap, /-- Section 2: Electrics \[trade: Electrical\]/);
  assert.match(snap, /Per-section uplift overrides .*: 2 → 10%/);
  assert.match(snap, /standing markup by trade .*: Electrical 10%/);
  assert.match(snap, /Trade package names: Preliminaries \| /);
});

// ── Client copy total + computed section subtotals ──────────────────────────
// An uplift change never moves the net build cost, so the proposal also says
// what the customer's price does; the snapshot carries computed section
// subtotals so the model quotes the page's figures instead of adding lines.
test('an uplift-only proposal shows the client copy moving while the net stays put', () => {
  const { clientCopyExVat } = require('./builderPackAssistantRoutes')._test;
  const controls = { ...CONTROLS, overhead_pct: 19, profit_pct: 18.5, vat_pct: 20, per_trade_ohp: {} };
  const before = clientCopyExVat(SECTIONS, controls);
  // 19% overhead × 18.5% profit compound to 41.015% on every section.
  const net = baseNet(SECTIONS);
  assert.ok(Math.abs(before.ex_vat - net * 1.19 * 1.185) < 0.02, `before ${before.ex_vat}`);

  const v = validateAndPreview({ summary: '10% on electrics', controls: { section_uplift: { '2': 10 } } }, PROJECT, SECTIONS, controls);
  assert.equal(v.ok, true);
  assert.equal(v.proposal.before_total, v.proposal.after_total, 'net build cost unchanged');
  const elecBase = 1500 + 950;
  const expectedAfter = (net - elecBase) * 1.19 * 1.185 + elecBase * 1.10;
  assert.equal(v.proposal.client_before, before.ex_vat);
  assert.ok(Math.abs(v.proposal.client_after - expectedAfter) < 0.02, `after ${v.proposal.client_after} vs ${expectedAfter}`);
  assert.ok(v.proposal.client_after < v.proposal.client_before);
  assert.match(v.proposal.client_note, /Client copy total excl\. VAT \(VAT @ 20% on top\)/);
});

test('client copy total honours prelims, day rate, contingency, provisional sections and rounding like the page', () => {
  const { clientCopyExVat } = require('./builderPackAssistantRoutes')._test;
  const sections = SECTIONS.concat([{ number: '9', title: 'Provisional Sums', provisional: true, items: [{ description: 'PS', labour: 0, materials: 0, total: 500 }] }]);
  const r = clientCopyExVat(sections, {
    overhead_pct: 10, profit_pct: 0, contingency_pct: 5, vat_pct: 0, provisional_sum: 999, // lump ignored: a provisional section exists
    per_trade_ohp: { '2': 0 }, prelims_mode: 'flat', prelims_amount: 1000, day_rate_on: true, day_rate: { days: 2, rate_per_day: 300 }, rounding: 10,
  });
  const prelimsBase = 2200 + 19000, elecBase = 2450;
  const netConstruction = Math.round((prelimsBase * 1.10) / 10) * 10 + Math.round((elecBase * 1.0) / 10) * 10;
  const expected = netConstruction + 1000 + 600 + 500 + (prelimsBase + elecBase) * 0.05;
  assert.ok(Math.abs(r.ex_vat - expected) < 0.02, `${r.ex_vat} vs ${expected}`);
  assert.equal(clientCopyExVat([], {}), null);
});

test('the snapshot carries computed section subtotals and the client copy total', () => {
  const snap = snapshotForPrompt(PROJECT, SECTIONS, { ...CONTROLS, overhead_pct: 10 });
  assert.match(snap, /-- Section 1: Preliminaries .*— 2 lines, subtotal £21200/);
  assert.match(snap, /SECTION SUBTOTALS \(computed/);
  assert.match(snap, /\n2 Electrics: £2450\n/);
  assert.match(snap, /Client copy total \(excl\. VAT\) with the controls above: £26015/); // 23650 × 1.10
});
