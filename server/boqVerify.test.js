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

// A tender cascade: OH&P on the measured sections only, provisional sums
// added flat, "NET TENDER SUM excluding VAT" as the bottom line. The tender
// sum was not recognised as a printed total, so the bill locked as
// "no printed total" (Horley Community Centre, 213 lines, £1.6m).
test('a cascade to "NET TENDER SUM excluding VAT" with OH&P on the measured sections only verifies', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const v = await check([
    HEADER,
    ['1. PRELIMINARIES'],
    ['1.01', 'Site manager', 'wk', 42, 1650, 69300, 0, 69300],
    ['', 'Subtotal carried to summary - 1. PRELIMINARIES', '', '', '', 69300, 0, 69300],
    [],
    ['2. PROVISIONAL SUMS AND DAYWORKS (CSA 5; outside OH&P)'],
    ['2.01', 'AV and CCTV first fix', 'PS', 1, 7500, 0, 7500, 7500],
    ['', 'Subtotal carried to summary - 2. PROVISIONAL SUMS AND DAYWORKS', '', '', '', 0, 7500, 7500],
    [],
    ['SUMMARY AND TENDER CASCADE'],
    ['Sections 1-1: preliminaries and measured works', '', '', '', '', '', '', 69300],
    ['Overheads and profit at 17% on sections 1-1 (CSA 6.06)', '', '', '', '', '', '', 11781],
    ['Provisional sums and dayworks, section 2 (no OH&P added)', '', '', '', '', '', '', 7500],
    ['NET TENDER SUM excluding VAT - to Form of Tender (CSA 10)', '', '', '', '', '', '', 88581],
    ['VAT at 20%', '', '', '', '', '', '', 17716.2],
    ['TENDER SUM INCLUDING VAT', '', '', '', '', '', '', 106297.2],
  ]);
  assert.strictEqual(v.status, 'verified', v.message);
  assert.strictEqual(v.detail.parsed_total, 76800);
  assert.strictEqual(v.detail.printed_total, 88581);
});
