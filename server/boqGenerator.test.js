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
