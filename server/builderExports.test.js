// End-to-end tests for Provisional Sums flowing from the generated BOQ through
// parseBOQ (the Builder Pack data source). Covers:
//   1. A real "Provisional Sums" section is captured in full, once, with its
//      sub-total row NOT mistaken for an extra line.
//   2. boqGenerator's "shown for reference" PC/Provisional recap is NOT parsed
//      as an authoritative PS section (no partial/duplicate PS, no double-count).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ExcelJS, generateBOQExcel, parseBOQ;
let DEPS_OK = true;
try {
  ExcelJS = require('exceljs');
  ({ generateBOQExcel } = require('./boqGenerator'));
  ({ parseBOQ } = require('./builderExports'));
} catch (e) {
  DEPS_OK = false;
}

// Provisional sums follow the pipeline convention: qty = £ value, rate = 1.
function ps(item, desc, value) {
  return { item, description: desc, unit: 'Item', qty: value, rate: 1, labour: 0, materials: value, total: value, rate_source: 'ai_estimated' };
}

const SECTIONS = [
  { number: '1', title: 'Preliminaries', items: [
    { item: '1.1', description: 'Site supervision', unit: 'Item', qty: 1, rate: 2500, labour: 2500, materials: 0, total: 2500, rate_source: 'base_library' },
  ]},
  { number: '4', title: 'Hall & Stairs', items: [
    { item: '4.1', description: 'Strip out & replaster hall walls', unit: 'm2', qty: 32, rate: 38, labour: 700, materials: 516, total: 1216, rate_source: 'base_library' },
  ]},
  { number: '9', title: 'Provisional Sums', items: [
    ps('9.1', 'Air-conditioning installation throughout — subject to mechanical design', 32000),
    ps('9.2', 'Yellow Storage Room — refurbishment/fit-out, subject to scope of works', 2000),
    ps('9.3', 'Building façade repair (Ground Floor) — subject to stonemason\'s report', 8500),
  ]},
];

async function genAndParse(sections) {
  const buf = await generateBOQExcel(sections, 'Reinstatement', 'Client', { vat_rate: 20, currency: '£' });
  const file = path.join(os.tmpdir(), `boqtest-${process.pid}-${Math.round(buf.length)}.xlsx`);
  fs.writeFileSync(file, buf);
  try {
    return await parseBOQ(file);
  } finally {
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  }
}

test('a real Provisional Sums section is captured in full, once, without its sub-total', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const parsed = await genAndParse(SECTIONS);
  const provSections = (parsed.sections || []).filter((s) => s.provisional);
  assert.strictEqual(provSections.length, 1, 'exactly one provisional section');
  const proveItems = provSections[0].items;
  assert.strictEqual(proveItems.length, 3, 'all three provisional sums captured (not 1)');
  const sum = proveItems.reduce((a, i) => a + (i.total || 0), 0);
  assert.strictEqual(sum, 42500, 'provisional total is the three lines, not doubled by a sub-total row');
  const descs = proveItems.map((i) => i.description).join(' | ');
  assert.match(descs, /Air-conditioning/);
  assert.match(descs, /Yellow Storage Room/);
  assert.match(descs, /façade repair/i);
});

// Tender-shaped workbook: a priced "10.0 PRIME COST & PROVISIONAL SUMS"
// section mid-document (NOT boqGenerator's "shown for reference" recap),
// followed by a further priced section and a summary whose Overhead/Profit/
// Contingency percentages sit in a %-formatted cell OUTSIDE the Rate column.
// Reproduces the 17 Wing Road upload, where everything from section 10.0
// down was silently dropped (client copy showed £669k of a £1.39m BOQ).
async function buildTenderWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOQ');
  const merge = (rowNumber) => ws.mergeCells(`A${rowNumber}:H${rowNumber}`);
  ws.addRow(['BILL OF QUANTITIES']); merge(1);
  ws.addRow(['Item', 'Description', 'Unit', 'Qty', 'Rate (£)', 'Labour (£)', 'Materials (£)', 'Total (£)']);
  ws.addRow(['1.0  PRELIMINARIES']); merge(3);
  ws.addRow(['1.01', 'Site establishment', 'item', 1, 1000, 600, 400, 1000]);
  ws.addRow(['Subtotal 1.0', null, null, null, null, null, null, 1000]); ws.mergeCells('A5:G5');
  ws.addRow(['10.0  PRIME COST & PROVISIONAL SUMS']); merge(6);
  ws.addRow(['10.01', "Provisional — builder's work in connection", 'PROV', 1, 4500, '-', 4500, 4500]);
  ws.addRow(['10.02', 'Provisional — unforeseen ground works', 'PROV', 1, 6000, '-', 6000, 6000]);
  ws.addRow(['Subtotal 10.0', null, null, null, null, null, null, 10500]); ws.mergeCells('A9:G9');
  ws.addRow(['11.0  EXISTING BUILDING — REMODEL & CONVERSION']); merge(10);
  ws.addRow(['11.01', 'Soft strip of existing building', 'PROV', 1, 26000, '-', 26000, 26000]);
  ws.addRow(['11.02', 'Structural tie-in of new build', 'item', 1, 9500, 4200, 5300, 9500]);
  ws.addRow(['Subtotal 11.0', null, null, null, null, null, null, 35500]); ws.mergeCells('A13:G13');
  ws.addRow(['SUMMARY OF TENDER']); merge(14);
  ws.addRow(['Net Construction Cost (Sections 1.0 – 11.0)', null, null, null, null, null, null, 47000]); ws.mergeCells('A15:G15');
  const pct = (rowNumber, label, fraction, amount) => {
    const r = ws.addRow([label, null, null, null, null, null, fraction, amount]);
    ws.mergeCells(`A${rowNumber}:F${rowNumber}`);
    r.getCell(7).numFmt = '0.0%';
  };
  pct(16, 'Overhead', 0.155, 7285);
  pct(17, 'Profit (applied to Net + Overhead)', 0.15, 8142.75);
  pct(18, 'Contingency (ground risk — editable)', 0.05, 2350);
  const buf = await wb.xlsx.writeBuffer();
  fs.writeFileSync(file, buf);
}

test('a priced PRIME COST & PROVISIONAL SUMS section and everything after it survive parsing', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const file = path.join(os.tmpdir(), `boqtender-${process.pid}.xlsx`);
  await buildTenderWorkbook(file);
  let parsed;
  try {
    parsed = await parseBOQ(file);
  } finally {
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  }

  const numbers = parsed.sections.map((s) => s.number);
  assert.deepStrictEqual(numbers, ['1.0', '10.0', '11.0'], 'no section is dropped as a false reference recap');

  const prov = parsed.sections.find((s) => s.provisional);
  assert.ok(prov, 'the PC & Provisional Sums section is carried as provisional');
  assert.strictEqual(prov.number, '10.0', 'provisional section keeps the source numbering');
  assert.strictEqual(prov.items.length, 2, 'both PS lines captured; the merged Subtotal row is not swallowed as a line');
  assert.strictEqual(prov.subtotal.total, 10500);

  const s11 = parsed.sections.find((s) => s.number === '11.0');
  assert.strictEqual(s11.items.length, 2);
  assert.strictEqual(s11.subtotal.total, 35500);

  assert.strictEqual(parsed.grand.total, 47000, 'grand total reconciles to the tender net construction cost');

  const ss = parsed.source_summary;
  assert.strictEqual(ss.overhead_pct, 15.5, 'overhead % read from the %-formatted cell outside the Rate column');
  assert.strictEqual(ss.profit_pct, 15);
  assert.strictEqual(ss.contingency_pct, 5);
});

test('the reference recap alone does not create a provisional section', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  // No dedicated PS section — provisional content sits inline. boqGenerator
  // still prints the "shown for reference" recap, which must NOT be parsed.
  const inline = [
    { number: '2', title: 'Service Installation', items: [
      { item: '2.1', description: 'Electrical remedial works — provisional sum', unit: 'Item', qty: 2500, rate: 1, labour: 0, materials: 2500, total: 2500, rate_source: 'ai_estimated' },
    ]},
  ];
  const parsed = await genAndParse(inline);
  const provSections = (parsed.sections || []).filter((s) => s.provisional);
  assert.strictEqual(provSections.length, 0, 'reference recap must not be parsed as a PS section');
});
