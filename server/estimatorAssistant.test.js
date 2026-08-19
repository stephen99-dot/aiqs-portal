// Tests for the quote-assistant changeset validation + preview.
//
// The model's propose_quote_update output is untrusted: refs can point at lines
// that don't exist, numbers can be strings or garbage, and a proposal with no
// real change must be rejected rather than shown as an empty "Apply" card. The
// preview totals must come from the same computeFinancials cascade the editor
// and PDFs use, or the before/after shown in chat would disagree with the page.

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAndPreview, snapshotForPrompt } = require('./estimatorAssistantRoutes')._test;

const HEADER = { quote_number: 'Q-1', project_name: 'Kitchen extension', currency: 'GBP', ohp_pct: 15, contingency_pct: 5, vat_pct: 20, notes: '' };
const LINES = [
  { section: 'Electrics', item: 'First fix electrics', description: '', unit: 'item', qty: 1, rate: 1500, labour: 900, materials: 600 },
  { section: 'Electrics', item: 'Second fix electrics', description: '', unit: 'item', qty: 1, rate: 1200, labour: 700, materials: 500 },
  { section: 'Roof', item: 'Tiling', description: '', unit: 'm2', qty: 30, rate: 55, labour: 30, materials: 25 },
];

test('updates a line by ref and previews the new totals through the money cascade', () => {
  const v = validateAndPreview({ summary: 'Electrics up to supplier quote', line_updates: [{ ref: 1, rate: 1850 }] }, HEADER, LINES);
  assert.equal(v.ok, true);
  const p = v.proposal;
  assert.equal(p.line_updates.length, 1);
  assert.equal(p.line_updates[0].rate, 1850);
  // net before = 1500 + 1200 + 1650 = 4350; after = 4700
  // grand = net * 1.20 (ohp+cont) * 1.20 (vat)
  assert.equal(p.before_total, 6264);
  assert.equal(p.after_total, 6768);
  assert.equal(p.changes.length, 1);
  assert.match(p.changes[0].label, /1500.*1850/);
});

test('rejects unknown refs but keeps the valid parts, reporting warnings', () => {
  const v = validateAndPreview({
    summary: 'Mixed',
    line_updates: [{ ref: 99, rate: 10 }, { ref: 2, qty: 2 }],
    remove_refs: [42],
  }, HEADER, LINES);
  assert.equal(v.ok, true);
  assert.equal(v.proposal.line_updates.length, 1);
  assert.equal(v.proposal.line_updates[0].ref, 2);
  assert.equal(v.proposal.remove_refs.length, 0);
  assert.equal(v.warnings.length, 2); // ref 99 + remove 42
});

test('a proposal with nothing valid in it is refused', () => {
  const v = validateAndPreview({ summary: 'nothing', line_updates: [{ ref: 50, rate: 1 }] }, HEADER, LINES);
  assert.equal(v.ok, false);
  assert.ok(v.errors.length > 0);
});

test('new lines get the 60/40 labour split fallback and removals subtract from the total', () => {
  const v = validateAndPreview({
    summary: 'Add skip, drop second fix',
    new_lines: [{ section: 'Prelims', item: 'Skip hire', unit: 'nr', qty: 2, rate: 200 }],
    remove_refs: [2],
  }, HEADER, LINES);
  assert.equal(v.ok, true);
  const p = v.proposal;
  assert.equal(p.new_lines[0].labour, 120);
  assert.equal(p.new_lines[0].materials, 80);
  // net before 4350 → after 4350 - 1200 + 400 = 3550
  assert.equal(p.after_total, 5112); // 3550 * 1.2 * 1.2
  assert.equal(p.changes.filter(c => c.kind === 'remove').length, 1);
  assert.equal(p.changes.filter(c => c.kind === 'add').length, 1);
});

test('header percentage changes flow into the preview totals', () => {
  const v = validateAndPreview({ summary: 'VAT to zero-rated', header: { vat_pct: 0 } }, HEADER, LINES);
  assert.equal(v.ok, true);
  assert.equal(v.proposal.header.vat_pct, 0);
  assert.equal(v.proposal.after_total, 5220); // 4350 * 1.2, no VAT
  assert.equal(v.proposal.changes[0].kind, 'header');
});

test('garbage numbers are coerced, strings are clamped, and est_rate is not invented', () => {
  const v = validateAndPreview({
    summary: 'x'.repeat(2000),
    line_updates: [{ ref: 3, qty: '35.5', description: 'd'.repeat(900) }],
  }, HEADER, LINES);
  assert.equal(v.ok, true);
  assert.equal(v.proposal.summary.length, 600);
  assert.equal(v.proposal.line_updates[0].qty, 35.5);
  assert.equal(v.proposal.line_updates[0].description.length, 500);
});

test('snapshot numbers lines from 1 and carries the grand total', () => {
  const snap = snapshotForPrompt(HEADER, LINES);
  assert.match(snap, /^1 \| Electrics \| First fix electrics/m);
  assert.match(snap, /^3 \| Roof \| Tiling/m);
  assert.match(snap, /GRAND TOTAL 6264/);
});
