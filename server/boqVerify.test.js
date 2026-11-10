// The verification gate: a delivered bill is only served once the lines read
// from it add up to the total it prints. These cover the pure file check;
// the database-backed wrapper (ensureBoqVerified) is a thin store around it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ExcelJS, verifyBoqFile;
let DEPS_OK = true;
try {
  ExcelJS = require('exceljs');
  // boqVerify requires ./database (better-sqlite3). Load the pure function
  // without it by stubbing the module when the native binding is absent.
  try { require('./database'); } catch (e) {
    require.cache[require.resolve('./database')] = { id: require.resolve('./database'), filename: require.resolve('./database'), loaded: true, exports: { prepare: () => ({ run() {}, get() {}, all() { return []; } }) } };
  }
  ({ verifyBoqFile } = require('./boqVerify'));
} catch (e) {
  DEPS_OK = false;
}

async function write(rows, sheet = 'BOQ') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  for (const r of rows) ws.addRow(r);
  const file = path.join(os.tmpdir(), `verify-${process.pid}-${Math.random().toString(36).slice(2)}.xlsx`);
  await wb.xlsx.writeFile(file);
  return file;
}
async function check(rows, sheet) {
  const file = await write(rows, sheet);
  try { return await verifyBoqFile(file); } finally { try { fs.unlinkSync(file); } catch (e) { /* ignore */ } }
}
const HEADER = ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Labour', 'Materials', 'Total'];

test('a bill whose lines add up to its printed total is verified', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const v = await check([
    HEADER,
    ['1.0', 'PRELIMINARIES'],
    ['1.1', 'Site set-up', 'item', 1, 1200, 800, 400, 1200],
    ['1.2', 'Skips', 'nr', 3, 300, 100, 800, 900],
    ['', 'Sub-total — Preliminaries', '', '', '', 900, 1200, 2100],
    ['', 'Net construction cost', '', '', '', '', '', 2100],
  ]);
  assert.strictEqual(v.status, 'verified');
  assert.ok(v.ok);
  assert.strictEqual(v.detail.parsed_total, 2100);
  assert.strictEqual(v.detail.printed_total, 2100);
});

test('a bill whose printed total the lines do not reach is a mismatch, and locks', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const v = await check([
    HEADER,
    ['1.0', 'PRELIMINARIES'],
    ['1.1', 'Site set-up', 'item', 1, 1200, 800, 400, 1200],
    ['', 'Net construction cost', '', '', '', '', '', 5000],
  ]);
  assert.strictEqual(v.status, 'mismatch');
  assert.ok(!v.ok);
  assert.match(v.message, /1,200/);
  assert.match(v.message, /5,000/);
});

test('a labour breakdown (no Description / Qty header) is not a bill', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const v = await check([
    ['Ref', 'Item', 'Unit', 'Quantity', 'Net labour £', 'Man-days'],
    ['0.2', 'Site management', 'wk', 17, 2808.4, 9.565],
  ], 'Labour breakdown');
  assert.strictEqual(v.status, 'not_a_bill');
  assert.ok(!v.ok);
});

test('a bill that prints no total line cannot be verified and locks', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const v = await check([
    HEADER,
    ['1.0', 'PRELIMINARIES'],
    ['1.1', 'Site set-up', 'item', 1, 1200, 800, 400, 1200],
  ]);
  assert.strictEqual(v.status, 'no_printed_total');
  assert.ok(!v.ok);
});

test('a missing file is reported, not thrown', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const v = await verifyBoqFile(path.join(os.tmpdir(), 'does-not-exist.xlsx'));
  assert.strictEqual(v.status, 'missing');
});

// A bill written by a program can carry its sub-totals and summary as
// formulas with NO cached value — exactly what this app's own generator did
// until recently. A data-only read sees 0 for every one of them, so a bill
// whose ten lines added up perfectly was locked as "no printed total" (G73
// 5LR, Rutherglen). The parser now evaluates those formulas.
test('a bill whose totals are uncached formulas still verifies', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const v = await check([
    HEADER,
    ['   1.   1. PRELIMINARIES'],
    ['1.1', 'Site establishment and welfare', 'Item', 1, 2266, 1586.2, 679.8, 2266],
    ['1.2', 'Independent access scaffold', 'm²', 180, 20, 2160, 1440, 3600],
    ['', 'SUB-TOTAL — SECTION 1: 1. PRELIMINARIES', '', '', '', { formula: 'SUM(F3:F4)' }, { formula: 'SUM(G3:G4)' }, { formula: 'SUM(H3:H4)' }],
    [],
    ['   2.   2. EXTERNAL WALL'],
    ['2.1', 'Rainscreen panels', 'm²', 180, 149.35, 13441.5, 13441.5, 26883],
    ['', 'SUB-TOTAL — SECTION 2: 2. EXTERNAL WALL', '', '', '', { formula: 'SUM(F8:F8)' }, { formula: 'SUM(G8:G8)' }, { formula: 'SUM(H8:H8)' }],
    [],
    ['PROJECT SUMMARY'],
    ['', 'Net Construction Cost', '', '', '', '', '', { formula: 'H5+H9' }],
    ['', 'TOTAL CONSTRUCTION COST (EXCL. VAT)', '', '', '', '', '', { formula: 'H12' }],
    ['', 'VAT @ 20%', '', '', '', '', '', { formula: 'H13*0.2' }],
    ['', 'TOTAL CONSTRUCTION COST (INCL. VAT @ 20%)', '', '', '', '', '', { formula: 'H13+H14' }],
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
  assert.strictEqual(v.detail.parsed_total, 32749);
  assert.strictEqual(v.detail.printed_total, 32749);
});

// Trafalgar House: the OH&P row prints only its percentage (17% in the Rate
// cell, nothing in Total) and the one document total is "TOTAL QUOTATION
// (EXCLUDING VAT)". The lines equal the bill's own net; the printed total is
// that net × 1.17. Locked as a mismatch until the percentage-only row was read.
test('a bill whose OH&P is a percentage-only row and whose total is "TOTAL QUOTATION (EXCLUDING VAT)" verifies', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const v = await check([
    HEADER,
    ['1  PRELIMINARIES'],
    ['1.1', 'Site set-up', 'item', 1, 1000, 800, 200, 1000],
    ['1.2', 'Skips', 'nr', 2, 300, 100, 500, 600],
    ['Section 1 total carried to summary', '', '', '', '', 900, 700, 1600],
    ['SUMMARY'],
    ['Overheads and profit', '', '', '', 0.17],
    ['1', 'Preliminaries', '', '', '', 1600, 272, 1872],
    ['TOTAL QUOTATION (EXCLUDING VAT)', '', '', '', '', 1600, 272, 1872],
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
  assert.ok(v.ok);
  assert.strictEqual(v.detail.parsed_total, 1600);
  assert.strictEqual(v.detail.printed_total, 1872);
  assert.match(v.message, /OH&P/);
});

// Hidcote Garden Room (Vision Build): the bill prints a per-unit "Total rate"
// column beside the line "Amount". The first header starting with "total" was
// taken as the line value, so 97 lines summed to their unit rates (£52k, not
// the bill's £114k) and the net total — printed under Amount — was never
// read: a correct bill locked as "no printed total".
test('a "Labour rate | Materials rate | Total rate | Amount" layout reads Amount as the line value and verifies', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const v = await check([
    ['Item', 'Description', 'Unit', 'Quantity', 'Labour rate', 'Materials & plant rate', 'Total rate', 'Amount'],
    ['S1', 'PRELIMINARIES'],
    ['1.01', 'Site supervision, one day per week', 'week', 10, 290, 0, 290, 2900],
    ['1.02', 'Welfare unit, weekly hire', 'week', 10, 0, 120, 120, 1200],
    ['', 'Total carried to summary: Preliminaries', '', '', '', '', '', 4100],
    ['S2', 'SUBSTRUCTURE'],
    ['2.01', 'Strip topsoil and set aside', 'm2', 40, 7.5, 2.5, 10, 400],
    ['', 'Total carried to summary: Substructure', '', '', '', '', '', 400],
    ['SUMMARY'],
    ['S1', 'Preliminaries', '', '', '', '', '', 4100],
    ['S2', 'Substructure', '', '', '', '', '', 400],
    ['', 'NET TOTAL (prime cost)', '', '', '', '', '', 4500],
    ['', 'Overheads and profit', '', '', '', 0.17, 'on net total', 765],
    ['', 'SUB TOTAL', '', '', '', '', '', 5265],
    ['', 'Value Added Tax', '', '', '', 0.2, 'on sub total', 1053],
    ['', 'TOTAL', '', '', '', '', '', 6318],
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
  assert.ok(v.ok);
  assert.strictEqual(v.detail.items, 3);
  assert.strictEqual(v.detail.parsed_total, 4500);
  assert.strictEqual(v.detail.printed_total, 4500);
});

// ── Summary layouts that locked correct bills (Nov 2026) ───────────────────
const SEC = (n, title, lines) => {
  const sum = lines.reduce((a, l) => a + l[1], 0);
  return {
    sum,
    rows: [
      [n + '.0   ' + title],
      ...lines.map((l, i) => [n + '.0' + (i + 1), l[0], 'item', 1, l[1], l[1] / 2, l[1] / 2, l[1]]),
    ],
  };
};

test('OH&P on the measured sections only, provisional sums at face value, contingency on the sub total (Foyle Road)', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const a = SEC(1, 'PRELIMINARIES', [['Site set-up', 2000], ['Welfare', 1000]]);
  const b = SEC(2, 'SUBSTRUCTURE', [['Trench fill', 4000], ['Blockwork', 3000]]);
  const measured = a.sum + b.sum;                       // 10,000
  const sub = measured * 1.17 + 1500;                   // 13,200
  const net = sub * 1.05;                               // 13,860
  const v = await check([
    HEADER,
    ...a.rows, ['Total Section 1.0  Preliminaries', '', '', '', '', 1500, 1500, a.sum],
    ...b.rows, ['Total Section 2.0  Substructure', '', '', '', '', 3500, 3500, b.sum],
    ['3.0   PROVISIONAL SUMS  (at face value, no overheads and profit)'],
    ['3.01', 'Structural engineer', 'sum', 1, 1500, 0, 1500, 1500],
    ['Total Section 3.0  Provisional sums', '', '', '', '', 0, 1500, 1500],
    ['MEASURED WORKS  (Sections 1.0 to 2.0)', '', '', '', '', '', '', measured],
    ['Overheads and profit at 17.0% on measured works', '', '', '', '', '', '', measured * 0.17],
    ['Provisional sums (Section 3.0), at face value', '', '', '', '', '', '', 1500],
    ['SUB TOTAL', '', '', '', '', '', '', sub],
    ['Contingency at 5.0% on the sub total', '', '', '', '', '', '', sub * 0.05],
    ['NET BEFORE VAT', '', '', '', '', '', '', net],
    ['VAT at 13.5%', '', '', '', '', '', '', net * 0.135],
    ['CONTRACT SUM', '', '', '', '', '', '', net * 1.135],
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
  assert.strictEqual(v.detail.parsed_total, 11500);
  // The bottom line before VAT is the net, not the VAT-inclusive contract sum.
  assert.strictEqual(v.detail.doc_total, 13860);
});

test('lines that reconcile to every section total verify, whatever the summary adds (18 West Street)', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const a = SEC(1, 'DEMOLITION', [['Strip out', 2000], ['Skips', 1000]]);
  const b = SEC(2, 'JOINERY', [['Doors', 4000], ['Skirting', 3000]]);
  const v = await check([
    HEADER,
    ...a.rows, ['', 'Total carried to summary', '', '', '', 1500, 1500, a.sum],
    ...b.rows, ['', 'Total carried to summary', '', '', '', 3500, 3500, b.sum],
    ['SUMMARY'],
    ['', 'Demolition', '', '', '', '', '', a.sum],
    ['', 'Joinery', '', '', '', '', '', b.sum],
    ['', 'Site allowances', '', '', '', '', '', 1047.7],
    ['', 'SUB TOTAL (excluding VAT)', '', '', '', '', '', 11047.7],
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
  assert.strictEqual(v.detail.proof, 'sections');
  assert.strictEqual(v.detail.parsed_total, 10000);
  assert.strictEqual(v.detail.doc_total, 11047.7);
  // A section's own carry row is not one of the bill's document totals.
  assert.ok(!v.detail.printed_all.some((p) => /carried to summary/i.test(p.label)));
});

test('the section proof fails when a section\'s lines do not reach its own total', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const a = SEC(1, 'DEMOLITION', [['Strip out', 2000], ['Skips', 1000]]);
  const b = SEC(2, 'JOINERY', [['Doors', 4000], ['Skirting', 3000]]);
  const v = await check([
    HEADER,
    ...a.rows, ['', 'Total carried to summary', '', '', '', 1500, 1500, a.sum],
    ...b.rows, ['', 'Total carried to summary', '', '', '', 3500, 3500, b.sum + 2500],
    ['SUMMARY'],
    ['', 'SUB TOTAL (excluding VAT)', '', '', '', '', '', 13500],
  ]);
  assert.strictEqual(v.status, 'mismatch');
});

test('amount-only rows after a section\'s total row are not read as lines', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const a = SEC(1, 'DEMOLITION', [['Strip out', 2000], ['Skips', 1000]]);
  const b = SEC(2, 'JOINERY', [['Doors', 4000], ['Skirting', 3000]]);
  const v = await check([
    HEADER,
    ...a.rows, ['', 'Total carried to summary', '', '', '', 1500, 1500, a.sum],
    ...b.rows, ['', 'Total carried to summary', '', '', '', 3500, 3500, b.sum],
    // No summary heading: these repeat the sections and must not be read as lines.
    ['', 'Demolition', '', '', '', '', '', a.sum],
    ['', 'Joinery', '', '', '', '', '', b.sum],
    ['', 'Contract sum', '', '', '', '', '', 12345],
  ]);
  assert.ok(v.ok, v.message);
  assert.strictEqual(v.detail.parsed_total, 10000);
});

test('"Measured works (A to B)" plus OH&P, with a closing section at face value (Grange Lawn)', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const a = SEC(1, 'SUBSTRUCTURE', [['Trench fill', 4000], ['Blockwork', 3000]]);
  const b = SEC(2, 'ROOF', [['Trusses', 5000]]);
  const c = SEC(3, 'PC SUMS', [['Kitchen supply', 2500]]);
  const measured = a.sum + b.sum;
  const v = await check([
    HEADER, ...a.rows, ...b.rows, ...c.rows,
    ['SUMMARY'],
    ['', 'Measured works and preliminaries (1 to 2)', '', '', '', '', '', measured],
    ['', 'Overheads and profit 17%', '', '', '', '', '', measured * 0.17],
    ['', 'PC sums', '', '', '', '', '', c.sum],
    ['', 'TOTAL EXCLUDING VAT', '', '', '', '', '', measured * 1.17 + c.sum],
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
  assert.strictEqual(v.detail.parsed_total, 14500);
});

test('a bill in parts verifies when its part totals add up to the lines (Stonebank)', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const a = SEC(1, 'STAGE ONE', [['Works', 4000], ['More works', 3000]]);
  const b = SEC(2, 'BUDGET ALLOWANCES', [['Allowance', 5000]]);
  const v = await check([
    HEADER, ...a.rows, ...b.rows,
    ['SUMMARY'],
    ['', 'TOTAL PART A - TENDER STAGE 1', '', '', '', '', '', a.sum],
    ['', 'TOTAL PART B - STAGE 2 BUDGET ALLOWANCES', '', '', '', '', '', b.sum],
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
});

test('a doubled bill still locks under the new checks', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const a = SEC(1, 'SUBSTRUCTURE', [['Trench fill', 4000], ['Blockwork', 3000]]);
  const b = SEC(2, 'ROOF', [['Trusses', 5000]]);
  const v = await check([
    HEADER, ...a.rows, ...b.rows,
    ['SUMMARY'],
    ['', 'Net construction cost', '', '', '', '', '', 6000],
    ['', 'Overheads and profit 17%', '', '', '', '', '', 1020],
    ['', 'TOTAL EXCLUDING VAT', '', '', '', '', '', 7020],
  ]);
  assert.strictEqual(v.status, 'mismatch');
});

// ── Layouts from the second batch of locked bills ──────────────────────────
test('a summary headed "S | SUMMARY" is not read as a second set of lines (Dubai, Orb Electrical)', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const a = SEC(1, 'PRELIMINARIES', [['Site set-up', 2000], ['Welfare', 1000]]);
  const b = SEC(2, 'FLOORING', [['Epoxy', 4000], ['Screed', 3000]]);
  const v = await check([
    HEADER,
    ...a.rows, ['', 'Subtotal carried to summary — A', '', '', '', 1500, 1500, a.sum],
    ...b.rows, ['', 'Subtotal carried to summary — B', '', '', '', 3500, 3500, b.sum],
    ['SUM', 'SUMMARY'],
    ['A', 'PRELIMINARIES', '', '', '', 1500, 1500, a.sum],
    ['B', 'FLOORING', '', '', '', 3500, 3500, b.sum],
    ['', 'Net construction cost', '', '', '', '', '', 10000],
    ['', 'Overheads and profit', '', '', 0.17, '', '', 1700],
    ['', 'TOTAL EXCLUDING VAT', '', '', '', '', '', 11700],
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
  assert.strictEqual(v.detail.parsed_total, 10000);
});

test('a summary page read as lines can never pass on its real sections alone', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  // An unrecognised heading and summary rows that do not simply echo the
  // section totals: the lines come to more than the bill's bottom line.
  const a = SEC(1, 'PRELIMINARIES', [['Site set-up', 2000], ['Welfare', 1000]]);
  const b = SEC(2, 'FLOORING', [['Epoxy', 4000], ['Screed', 3000]]);
  const v = await check([
    HEADER, ...a.rows, ...b.rows,
    ['9.0   BREAKDOWN BY ELEMENT'],
    ['9.01', 'Building works', 'item', 1, 6000, 3000, 3000, 6000],
    ['9.02', 'Finishes', 'item', 1, 4000, 2000, 2000, 4000],
    ['', 'Net construction cost', '', '', '', '', '', 10000],
  ]);
  assert.strictEqual(v.status, 'mismatch');
});

test('options priced outside the tender sum are kept out of the lines (Twyford Ave)', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const a = SEC(1, 'ROOFS', [['Slating', 2000], ['Leadwork', 1000]]);
  const b = SEC(2, 'KITCHEN', [['Units', 4000], ['Worktops', 3000]]);
  const v = await check([
    HEADER,
    ...a.rows, ['', 'Total - Section 1', '', '', '', 1500, 1500, a.sum],
    ...b.rows, ['', 'Total - Section 2', '', '', '', 3500, 3500, b.sum],
    ['X', 'OPTIONS AND ALTERNATIVES - PRICED SEPARATELY, NOT IN THE TENDER SUM'],
    ['X1', 'Open the hall wall'],
    ['X1.1', 'Form opening', 'item', 1, 4000, 2400, 1600, 4000],
    ['X1.2', 'Deduct door', 'item', 1, -500, -300, -200, -500],
    ['', 'SUMMARY'],
    ['', 'NET COST OF THE WORKS (Sections 1 to 2)', '', '', '', '', '', 10000],
    ['', 'TENDER SUM, EXCLUSIVE OF VAT', '', '', '', '', '', 10000],
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
  assert.strictEqual(v.detail.parsed_total, 10000);
});

test('a header below a long preamble is still found (Mountjoy Square, Northcote Manor)', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const preamble = [];
  for (let i = 0; i < 45; i++) preamble.push(['', 'Basis of measurement note ' + i, 'm2', 12.5, 'As stated in scope']);
  const a = SEC(1, 'PRELIMINARIES', [['Site set-up', 2000], ['Welfare', 1000]]);
  const v = await check([
    ...preamble, HEADER, ...a.rows,
    ['', 'SUMMARY'],
    ['', 'NET TOTAL', '', '', '', '', '', 3000],
    [], HEADER, // a second table beneath the bill must not move its start
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
  assert.strictEqual(v.detail.parsed_total, 3000);
});

test('OH&P worked section by section, sub-headed sections and a re-listed schedule (Platway Lane)', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const v = await check([
    HEADER,
    ['A', 'PRELIMINARIES'],
    ['A.01', 'Site management'],
    ['', 'Site manager', 'wk', 10, 250, 2500, 0, 2500],
    ['', 'Welfare unit', 'wk', 10, 100, 0, 1000, 1000],
    ['A.02', 'Scaffolding'],
    ['', 'Scaffold', 'item', 1, 3500, 0, 3500, 3500],
    ['', 'PROVISIONAL SUM — staircase (employer allowance)', 'item', 1, 2000, 0, 2000, 2000],
    ['', 'Section A — contractor works, net', '', '', '', '', '', 7000],
    ['', ' of which subcontract quotations returned', '', '', '', '', '', 3500],
    ['', 'Overheads & profit — own work at H1', '', '', '', '', '', 1190],
    ['', 'Employer allowances (at face value, not uplifted)', '', '', '', '', '', 2000],
    ['', 'SECTION A TOTAL CARRIED TO TENDER SUMMARY', '', '', '', '', '', 10190],
    ['B', 'DEMOLITION'],
    ['B.01', 'Roof'],
    ['', 'Strip tiles', 'm2', 100, 11, 1100, 0, 1100],
    ['', 'Remove structure', 'm2', 60, 15, 900, 0, 900],
    ['', 'Section B — contractor works, net', '', '', '', '', '', 2000],
    ['', 'Overheads & profit — own work at H1', '', '', '', '', '', 340],
    ['', 'SECTION B TOTAL CARRIED TO TENDER SUMMARY', '', '', '', '', '', 2340],
    ['TENDER RETURN — ITEM AMOUNTS FOR SCHEDULE (incl. OH&P, excl. VAT)'],
    ['A.01', 'Site management', '', '', '', '', '', 4095],
    ['A.02', 'Scaffolding', '', '', '', '', '', 6095],
    ['B.01', 'Roof', '', '', '', '', '', 2340],
    ['TENDER PRICE SUMMARY'],
    ['A', 'Preliminaries', '', '', '', '', '', 10190],
    ['B', 'Demolition', '', '', '', '', '', 2340],
    ['', 'BASE TENDER TOTAL A–B, EXCLUDING VAT', '', '', '', '', '', 12530],
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
  assert.strictEqual(v.detail.parsed_total, 11000);
  assert.strictEqual(v.detail.doc_total, 12530);
});

test('sub-totals and a second table under an "ELEMENTAL SUMMARY" are not lines (Chesterfield, Eireann)', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const a = SEC(1, 'CEILINGS', [['Coffers', 2000], ['Bulkheads', 1000]]);
  const b = SEC(2, 'JOINERY', [['Bar', 4000], ['Booths', 3000]]);
  const v = await check([
    HEADER,
    ...a.rows, ['', 'Sub-total measured work', '', '', '', '', '', a.sum],
    ...b.rows, ['', 'Section 2 total carried to summary', '', '', '', '', '', b.sum],
    ['ELEMENTAL SUMMARY'],
    ['Ref', 'Element', '', '', '% of net', 'GBP / m2', '', 'Total'],
    ['1', 'Ceilings', '', '', 0.3, 17, '', 3000],
    ['2', 'Joinery', '', '', 0.7, 40, '', 7000],
    ['', 'NET WORKS TOTAL', '', '', '', '', '', 10000],
    ['', 'TOTAL BUDGET EXCLUDING VAT', '', '', '', '', '', 12285],
    ['', 'TOTAL BUDGET INCLUDING VAT', '', '', '', '', '', 14742],
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
  assert.strictEqual(v.detail.parsed_total, 10000);
});
