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
