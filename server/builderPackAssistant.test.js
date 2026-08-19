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
