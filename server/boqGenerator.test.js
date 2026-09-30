// Tests for the enriched BOQ Excel renderer.
//
// Focus: the additive enrichments (contract metadata header, per-section notes,
// Prime Cost / Provisional Sums recap) must render AND must not disturb the
// priced numbers — the recalc gate has to still reconcile to the penny, which
// proves the recap/metadata/note rows aren't being counted as priced lines.
//
// exceljs is a runtime dependency; if it isn't installed (fresh checkout with no
// node_modules) the whole suite skips rather than failing the run.

const test = require('node:test');
const assert = require('node:assert');

let ExcelJS, generateBOQExcel, assertBOQMatches;
let DEPS_OK = true;
try {
  ExcelJS = require('exceljs');
  ({ generateBOQExcel } = require('./boqGenerator'));
  ({ assertBOQMatches } = require('./recalcGate'));
} catch (e) {
  DEPS_OK = false;
}

const SECTIONS = [
  {
    number: '1', title: 'Preliminaries',
    note: 'Lump-sum prelims for a ~6 week phased internal reinstatement; CDM 2015 applies.',
    items: [
      { item: '1.1', description: 'Site supervision & co-ordination', unit: 'Item', qty: 1, rate: 2500, labour: 2500, materials: 0, total: 2500, rate_source: 'base_library' },
      { item: '1.2', description: 'Welfare unit / portaloo hire (6 wks)', unit: 'Item', qty: 1, rate: 350, labour: 0, materials: 350, total: 350, rate_source: 'base_library' },
    ],
  },
  {
    number: '2', title: 'Mechanical & Electrical',
    items: [
      { item: '2.1', description: 'NICEIC inspection & certificate', unit: 'Item', qty: 1, rate: 450, labour: 450, materials: 0, total: 450, rate_source: 'base_library' },
      { item: '2.2', description: 'Provisional sum for electrical remedial works', unit: 'P.Sum', qty: 1, rate: 3500, labour: 0, materials: 3500, total: 3500, rate_source: 'ai_estimated' },
    ],
  },
  {
    number: '3', title: 'Internal Finishes',
    items: [
      { item: '3.1', description: 'Supply & hang FD30 doorset, PC £500 supply + furniture, hang complete', unit: 'Nr', qty: 2, rate: 650, labour: 300, materials: 350, total: 1300, rate_source: 'base_library' },
      { item: '3.2', description: 'New travertine floor, tile PC £75/m2', unit: 'm2', qty: 12, rate: 120, labour: 60, materials: 60, total: 1440, rate_source: 'base_library' },
    ],
  },
];

const META_OPTS = {
  contingency_pct: 0, ohp_pct: 0, vat_rate: 20, currency: '£',
  location: 'Glasgow, G21',
  project_type: 'Insurance reinstatement',
  meta: {
    Employer: 'Mr & Mrs Williams',
    'Contract Administrator': 'Gateley Vinden (T. Walker-Smith)',
    Contract: 'JCT Minor Works (MW/MWD) 2024',
    'Type of loss': 'Escape of Water',
  },
};

function netOf(sections) {
  let n = 0;
  for (const s of sections) for (const it of s.items) n += it.total;
  return n;
}

// Read the BOQ sheet into an array of joined-cell-text strings, one per row.
async function boqRowTexts(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('BOQ');
  const out = [];
  ws.eachRow((row) => {
    const cells = [];
    row.eachCell({ includeEmpty: false }, (c) => {
      const v = c.value;
      if (v == null) return;
      if (typeof v === 'object') cells.push(String(v.text || v.result || ''));
      else cells.push(String(v));
    });
    out.push(cells.join(' | '));
  });
  return out;
}

test('enriched BOQ still reconciles to the construction total', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const buf = await generateBOQExcel(SECTIONS, 'Escape of water reinstatement', 'Steven Gormley', META_OPTS);
  assert.ok(buf && buf.length > 1000, 'workbook should be generated');
  const r = await assertBOQMatches(buf, netOf(SECTIONS));
  assert.strictEqual(r.ok, true, `recalc gate must pass (diff ${r.diff})`);
  assert.strictEqual(r.rows, 6, 'exactly the 6 priced lines should be counted, not the recap rows');
});

test('contract metadata, section note and PC/Provisional recap render', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const buf = await generateBOQExcel(SECTIONS, 'Escape of water reinstatement', 'Steven Gormley', META_OPTS);
  const rows = await boqRowTexts(buf);
  const blob = rows.join('\n');

  // Contract metadata block
  assert.match(blob, /Employer:.*Mr & Mrs Williams/, 'Employer metadata row');
  assert.match(blob, /Contract Administrator:.*Gateley Vinden/, 'CA metadata row');
  assert.match(blob, /Location:.*Glasgow/, 'Location metadata row');

  // Section narrative note
  assert.match(blob, /CDM 2015 applies/, 'section note rendered');

  // PC & Provisional recap with both groups and the provisional figure
  assert.match(blob, /PRIME COST & PROVISIONAL SUMS/, 'recap header');
  assert.match(blob, /Prime Cost \(PC\) sums/, 'PC group');
  assert.match(blob, /Provisional sums/, 'Provisional group');
  assert.match(blob, /Provisional sum for electrical remedial works/, 'provisional line recapped');
});

test('no PC/Provisional recap when there are none, and totals still reconcile', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const plain = [{
    number: '1', title: 'Finishes',
    items: [
      { item: '1.1', description: 'Skim & decorate wall', unit: 'm2', qty: 20, rate: 18, labour: 12, materials: 6, total: 360, rate_source: 'base_library' },
    ],
  }];
  const buf = await generateBOQExcel(plain, 'Small job', 'Client', { vat_rate: 20, currency: '£' });
  const blob = (await boqRowTexts(buf)).join('\n');
  assert.doesNotMatch(blob, /PRIME COST & PROVISIONAL SUMS/, 'no recap when nothing qualifies');
  const r = await assertBOQMatches(buf, 360);
  assert.strictEqual(r.ok, true, 'plain BOQ still reconciles');
});

// ── Markup by trade + trade packages ─────────────────────────────────────────
// A bill priced with per-trade markup prints the OH&P as the sum over the
// lines (with the blended rate in the label), a "Section totals with markup"
// block and a "Trade packages" block — all reference-only, so the recalc and
// pre-issue gates still pass and the Builder Pack parser still reconciles the
// file it will be handed later.
test('per-trade markup renders the trade and section-markup blocks and every gate still passes', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const pricer = require('./deterministicPricer');
  const { runPreIssueGate } = require('./preIssueGate');
  const { parseBOQ, reconcileParsed } = require('./builderExports');
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const items = [
    { key: 'site_welfare', qty: 1, unit: 'Item', section: 'Preliminaries' },
    { key: 'excavation_strip_foundation', qty: 12, unit: 'm³', section: '1. Substructure & Foundations' },
    { key: 'brick_outer_leaf', qty: 40, unit: 'm²', section: 'Superstructure' },
    { key: 'first_fix_electrical', qty: 1, unit: 'Item', section: 'Electrical' },
    { key: 'first_fix_plumbing', qty: 1, unit: 'Item', section: 'Mechanical & Plumbing' },
    // A provisional-sums section has no labour: its sub-total used to be an
    // uncached SUM formula over zeros, which the pre-issue gate rejects.
    { key: 'provisional_sum', description: 'Provisional sum for landscaping', qty: 1500, unit: 'Item', section: 'Provisional Sums' },
  ];
  const priced = pricer.priceLockedQuantities(items, '', {}, { ohp_pct: 20, trade_markup: { Electrical: 10, 'Plumbing & Heating': 10 } });
  assert.strictEqual(priced.summary.markup_by_trade, true);
  const sections = pricer.toPricedSections(priced);
  const buf = await generateBOQExcel(sections, 'Trade markup job', 'Client', {
    contingency_pct: priced.summary.contingency_pct, ohp_pct: priced.summary.ohp_pct, vat_rate: 20, currency: '£',
  });

  const recalc = await assertBOQMatches(buf, priced.summary.construction_total);
  assert.ok(recalc.ok, 'recalc gate: ' + JSON.stringify(recalc));
  const gate = await runPreIssueGate(buf);
  assert.ok(!gate.blocking, 'pre-issue gate: ' + gate.errors.join(' | '));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('BOQ');
  const texts = [];
  let ohpRow = null;
  ws.eachRow((row) => {
    const label = String((row.getCell(2).value && row.getCell(2).value.richText ? row.getCell(2).value.richText.map((r) => r.text).join('') : row.getCell(2).value) || '');
    const a = String(row.getCell(1).value || '');
    texts.push(a + ' ' + label);
    if (/^Overheads & Profit/.test(label)) ohpRow = row;
  });
  const all = texts.join('\n');
  assert.ok(ohpRow, 'OH&P summary row present');
  const ohpLabel = String(ohpRow.getCell(2).value);
  assert.match(ohpLabel, /by trade, average [\d.]+%/);
  const ohpCell = ohpRow.getCell(8).value;
  const ohpVal = typeof ohpCell === 'object' && ohpCell !== null && 'result' in ohpCell ? ohpCell.result : ohpCell;
  assert.ok(Math.abs(Number(ohpVal) - priced.summary.ohp) < 0.011, `OH&P ${ohpVal} vs pricer ${priced.summary.ohp}`);
  assert.match(all, /SECTION TOTALS WITH MARKUP & TRADE PACKAGES \(summary of the lines above - shown for reference\)/);
  assert.match(all, /Section totals with markup/);
  assert.match(all, /Construction cost with markup/);
  assert.match(all, /Trade packages \(the same lines grouped by trade/);
  assert.match(all, /Electrical \(Electrical\)/);
  assert.match(all, /Groundworks \(Substructure\)/);
  assert.match(all, /All trades/);

  // The Builder Pack reads this file back later: sections intact, blended
  // OH&P read from the label, bill reconciles.
  const file = path.join(os.tmpdir(), `boq-trade-${process.pid}.xlsx`);
  fs.writeFileSync(file, buf);
  try {
    const parsed = await parseBOQ(file);
    assert.strictEqual(parsed.sections.length, priced.sections.length, 'trade/markup blocks are not parsed as sections');
    assert.ok(Math.abs(parsed.source_summary.ohp_pct - priced.summary.ohp_effective_pct) < 0.02, 'blended OH&P % read from the label');
    const rec = reconcileParsed(parsed);
    assert.ok(rec && rec.ok, 'parsed bill reconciles: ' + JSON.stringify(rec));
  } finally {
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  }
});

test('a flat markup still prints the live formula row and no trade block is forced when lines carry no trade', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const buf = await generateBOQExcel(SECTIONS, 'Flat markup', 'Client', { ohp_pct: 12, vat_rate: 20, currency: '£' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('BOQ');
  let ohpRow = null; const labels = [];
  ws.eachRow((row) => { const l = String(row.getCell(2).value || ''); labels.push(l); if (/^Overheads & Profit/.test(l)) ohpRow = row; });
  assert.ok(ohpRow);
  assert.strictEqual(String(ohpRow.getCell(2).value), 'Overheads & Profit (12%)');
  assert.ok(ohpRow.getCell(8).value && typeof ohpRow.getCell(8).value === 'object' && 'formula' in ohpRow.getCell(8).value, 'flat OH&P stays a live formula');
  assert.ok(!labels.some((l) => /Trade packages/.test(l)), 'no trade block without trades on the lines');
  // Section totals with markup still print (titles only), because markup is on.
  assert.ok(labels.some((l) => /Section totals with markup/.test(l)));
});
