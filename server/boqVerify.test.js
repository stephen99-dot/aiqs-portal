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
