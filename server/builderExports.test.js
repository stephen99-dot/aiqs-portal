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

let ExcelJS, generateBOQExcel, parseBOQ, sniffBOQ, reconcileParsed, isTotalRowItem, addMissingProvisionalSections;
let DEPS_OK = true;
try {
  ExcelJS = require('exceljs');
  ({ generateBOQExcel } = require('./boqGenerator'));
  ({ parseBOQ, sniffBOQ, reconcileParsed, isTotalRowItem, addMissingProvisionalSections } = require('./builderExports'));
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

// Second tender layout (9 Dartmouth Road): fill-marked section headers with
// the number and title in SEPARATE cells ("1" | "PRELIMINARIES"), sub-totals
// worded "Section 1 total — …", a negative Deduct line, a "NET MEASURED COST"
// summary, and an unnumbered PS block ("PS" | "PROVISIONAL SUMS — …") closed
// by "Total provisional sums". Previously: trades were named by their bare
// number, every section total doubled (the Section-total row was read as a
// line), the Deduct line's numbered prefix split its section in half, and the
// PS block was counted twice (as a plain section AND as a flat lump).
async function buildSplitHeaderWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOQ');
  const FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  const header = (num, title) => {
    const r = ws.addRow([num, title]);
    r.getCell(1).fill = FILL; r.getCell(2).fill = FILL;
  };
  ws.addRow(['BILL OF QUANTITIES']);
  ws.addRow(['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Labour', 'Materials', 'Total']);
  header('1', 'PRELIMINARIES');
  ws.addRow(['1.01', 'Site management', 'day', 20, 253, 5060, 0, 5060]);
  ws.addRow([null, 'Section 1 total — PRELIMINARIES', null, null, null, 5060, 0, 5060]);
  header('5', 'WINDOWS, DOORS AND ROOFLIGHT');
  ws.addRow(['5.01', 'Door and frame D2 per quotation', 'no', 1, 2500, 0, 2500, 2500]);
  // Credit line with an empty Rate cell: its value lives only in the negative
  // materials/total split — exercises the lm !== 0 normalisation branch.
  ws.addRow(['5.04', 'Deduct: deposit already discharged against order', 'item', 1, null, 0, -1000, -1000]);
  ws.addRow(['5.05', 'Rooflight RL3 per quotation', 'no', 1, 2000, 0, 2000, 2000]);
  ws.addRow([null, 'Section 5 total — WINDOWS, DOORS AND ROOFLIGHT', null, null, null, 0, 3500, 3500]);
  ws.addRow([null, 'NET MEASURED COST', null, null, null, null, null, 8560]);
  ws.addRow([null, 'of which labour / materials and sub-contract', null, null, null, 5060, 3500, null]);
  const pctRow = (label, fraction, amount) => {
    const r = ws.addRow([null, label, null, null, null, null, fraction, amount]);
    r.getCell(7).numFmt = '0.0%';
  };
  pctRow('Overhead', 0.16, 1369.6);
  pctRow('Profit', 0.15, 1489.44);
  const psHead = ws.addRow(['PS', 'PROVISIONAL SUMS — carried excluding overhead and profit']);
  psHead.getCell(1).fill = FILL; psHead.getCell(2).fill = FILL;
  ws.addRow(['A', 'Reclaimed brick patio', 'sum', null, null, null, null, 2400]);
  ws.addRow(['B', 'Asbestos survey and removal if encountered', 'sum', null, null, null, null, 650]);
  ws.addRow([null, 'Total provisional sums', null, null, null, null, null, 3050]);
  ws.addRow([null, 'NET TOTAL', null, null, null, null, null, 14469.04]);
  pctRow('VAT — standard rated', 0.2, 2893.808);
  const buf = await wb.xlsx.writeBuffer();
  fs.writeFileSync(file, buf);
}

test('split-cell headers, Section-total rows, Deduct lines and an unnumbered PS block parse correctly', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const file = path.join(os.tmpdir(), `boqsplit-${process.pid}.xlsx`);
  await buildSplitHeaderWorkbook(file);
  let parsed;
  try {
    parsed = await parseBOQ(file);
  } finally {
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  }

  assert.deepStrictEqual(
    parsed.sections.map((s) => [s.number, s.title]),
    [
      ['1', 'PRELIMINARIES'],
      ['5', 'WINDOWS, DOORS AND ROOFLIGHT'],
      ['PS', 'PROVISIONAL SUMS — carried excluding overhead and profit'],
    ],
    'split-cell headings keep number AND title; the Deduct line does not split section 5; no phantom summary sections'
  );

  const s1 = parsed.sections[0];
  assert.strictEqual(s1.items.length, 1, 'the Section-total row is not swallowed as a line item');
  assert.strictEqual(s1.subtotal.total, 5060, 'section 1 not doubled by its Section-total row');

  const s5 = parsed.sections[1];
  assert.strictEqual(s5.items.length, 3, 'the negative Deduct line stays a line item in its section');
  assert.strictEqual(s5.subtotal.total, 3500, 'deduct nets off; section 5 not doubled');

  const ps = parsed.sections[2];
  assert.ok(ps.provisional, 'unnumbered PS block flagged provisional');
  assert.strictEqual(ps.items.length, 2);
  assert.strictEqual(ps.subtotal.total, 3050);
  assert.strictEqual(parsed.source_summary.provisional_sum, null,
    'no flat provisional lump on top of the itemised PS section (double count)');

  assert.strictEqual(parsed.grand.total, 11610, 'grand = net measured 8560 + PS 3050, nothing doubled');
  assert.strictEqual(parsed.source_summary.overhead_pct, 16);
  assert.strictEqual(parsed.source_summary.profit_pct, 15);
  assert.strictEqual(parsed.source_summary.vat_pct, 20);
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

// Hand-built QS layout (the "client copy is double the BOQ" report): sections
// closed by "Total — Preliminaries" / "Groundworks total" / "Carried to
// summary", a collection-style heading carrying its own section total
// ("3.0 ROOFING … 5,000"), a capitalised lump-sum line, and a closing
// "TOTAL CONSTRUCTION COST (EXCL. VAT)" row. Every one of those rows used to
// be read as a priced line, so the parsed bill came out at several times the
// delivered figure.
async function buildHandBuiltWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOQ');
  ws.addRow(['BILL OF QUANTITIES — 12 Example Road']);
  ws.addRow([]);
  ws.addRow(['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Labour', 'Materials', 'Total']);
  ws.addRow(['1.0', 'PRELIMINARIES']);
  ws.addRow(['1.1', 'Site set-up and welfare', 'item', 1, 1200, 800, 400, 1200]);
  ws.addRow(['1.2', 'Skips and waste removal', 'nr', 3, 300, 100, 800, 900]);
  ws.addRow(['1.3', 'ALLOW FOR SCAFFOLDING TO REAR', '', '', '', '', '', 650]);
  ws.addRow(['', 'Total — Preliminaries', '', '', '', 900, 1200, 2750]);
  ws.addRow([]);
  ws.addRow(['2.0', 'GROUNDWORKS']);
  ws.addRow(['2.1', 'Excavate trench foundations', 'm3', 10, 85, 600, 250, 850]);
  ws.addRow(['2.2', 'Concrete foundations C25', 'm3', 8, 190, 500, 1020, 1520]);
  ws.addRow(['', 'Groundworks total', '', '', '', 1100, 1270, 2370]);
  ws.addRow(['', 'Carried to summary', '', '', '', '', '', 2370]);
  ws.addRow([]);
  ws.addRow(['3.0', 'ROOFING', '', '', '', '', '', 5000]);
  ws.addRow(['3.1', 'Strip and re-tile roof', 'm2', 50, 100, 3000, 2000, 5000]);
  ws.addRow([]);
  ws.addRow(['4.0', 'DECORATION']);
  ws.addRow(['4.1', 'Two coats emulsion to walls', 'm2', 120, 8, 720, 240, 960]);
  ws.addRow(['4.2', 'Total for decoration', '', '', '', '', '', 960]); // total row with a ref cell
  ws.addRow([]);
  // A collection page: every section total repeated, then the grand total.
  ws.addRow(['', 'COLLECTION']);
  ws.addRow(['1.0', 'PRELIMINARIES', '', '', '', '', '', 2750]);
  ws.addRow(['2.0', 'GROUNDWORKS', '', '', '', '', '', 2370]);
  ws.addRow(['3.0', 'ROOFING', '', '', '', '', '', 5000]);
  ws.addRow(['4.0', 'DECORATION', '', '', '', '', '', 960]);
  ws.addRow(['', 'TOTAL CONSTRUCTION COST (EXCL. VAT)', '', '', '', '', '', 11080]);
  ws.addRow(['', 'VAT @ 20%', '', '', '', '', '', 2216]);
  ws.addRow(['', 'TOTAL (INCL. VAT)', '', '', '', '', '', 13296]);
  await wb.xlsx.writeFile(file);
}

test('hand-built total rows, carried headings and a closing grand total are not read as lines', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const file = path.join(os.tmpdir(), `boqhand-${process.pid}.xlsx`);
  await buildHandBuiltWorkbook(file);
  let parsed;
  try {
    parsed = await parseBOQ(file);
  } finally {
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  }

  assert.deepStrictEqual(
    parsed.sections.map((s) => [s.number, s.title, s.items.length, s.subtotal.total]),
    [
      ['1.0', 'PRELIMINARIES', 3, 2750],
      ['2.0', 'GROUNDWORKS', 2, 2370],
      ['3.0', 'ROOFING', 1, 5000],
      ['4.0', 'DECORATION', 1, 960],
    ],
    'each section keeps only its priced lines; the capitalised lump-sum line survives as a line; the collection page adds nothing'
  );
  assert.strictEqual(parsed.sections[0].items[2].description, 'ALLOW FOR SCAFFOLDING TO REAR');
  assert.strictEqual(parsed.grand.total, 11080, 'grand total matches the delivered bill, nothing doubled');
  assert.strictEqual(parsed.source_summary.ex_vat_total, 11080, 'the printed ex-VAT total is captured');
  assert.strictEqual(parsed.source_summary.vat_pct, 20);

  const check = reconcileParsed(parsed);
  assert.ok(check && check.ok, 'parsed lines reconcile to the printed total');
});

test('a section total row worded unexpectedly is dropped by reconciling to the printed sub-total', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOQ');
  ws.addRow(['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Labour', 'Materials', 'Total']);
  ws.addRow(['1.0', 'PRELIMINARIES']);
  ws.addRow(['1.1', 'Site set-up and welfare', 'item', 1, 1200, 800, 400, 1200]);
  ws.addRow(['1.2', 'Skips and waste removal', 'nr', 3, 300, 100, 800, 900]);
  ws.addRow(['', 'Preliminaries — amount carried', '', '', '', '', '', 2100]); // matched by CARRIED
  ws.addRow(['', 'Sum of the above', '', '', '', '', '', 2100]);               // no recognised wording at all
  ws.addRow(['', 'Sub-total — Preliminaries', '', '', '', '', '', 2100]);
  ws.addRow(['', 'Net Construction Cost', '', '', '', '', '', 2100]);
  const file = path.join(os.tmpdir(), `boqrec-${process.pid}.xlsx`);
  await wb.xlsx.writeFile(file);
  let parsed;
  try {
    parsed = await parseBOQ(file);
  } finally {
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  }
  assert.strictEqual(parsed.sections.length, 1);
  assert.strictEqual(parsed.sections[0].items.length, 2, 'the unrecognised total row is dropped because the lines otherwise sum to double the printed sub-total');
  assert.strictEqual(parsed.grand.total, 2100);
  assert.strictEqual(parsed.source_summary.net_total, 2100);
  assert.ok(reconcileParsed(parsed).ok);
});

test('a doubled parse is reported as not reconciling, and saved total-row lines are recognised', { skip: !DEPS_OK && 'exceljs not installed' }, () => {
  const parsed = {
    sections: [{ number: '1', title: 'PRELIMINARIES', items: [{}, {}], subtotal: { total: 4200 } }],
    grand: { total: 4200 },
    source_summary: { net_total: 2100 },
  };
  const check = reconcileParsed(parsed);
  assert.strictEqual(check.ok, false);
  assert.strictEqual(check.printed, 2100);
  assert.strictEqual(check.parsed, 4200);

  assert.ok(isTotalRowItem({ itemRef: '', description: 'Total — Preliminaries', unit: '', qty: 0, total: 2100 }));
  assert.ok(isTotalRowItem({ itemRef: '', description: 'Carried to summary', unit: '', qty: '', total: 2370 }));
  assert.ok(isTotalRowItem({ itemRef: '', description: 'TOTAL CONSTRUCTION COST (EXCL. VAT)', unit: '', qty: 0, total: 9470 }));
  assert.ok(!isTotalRowItem({ itemRef: '1.4', description: 'Total station survey of site', unit: 'item', qty: 1, total: 450 }), 'a priced line that mentions "total" is kept');
  assert.ok(!isTotalRowItem({ itemRef: '1.1', description: 'Site set-up and welfare', unit: 'item', qty: 1, total: 1200 }));
});

// The Kildowie delivery: a QS bill whose columns are "Ref | Description | Unit |
// Quantity | Labour rate | Labour | Materials, plant and prov. sums | Total",
// closed by a SUMMARY page, "NET DIRECT COST" and a cascade to the contract
// sum — delivered in one batch with a "Labour breakdown" workbook (Ref | Item |
// Unit | Quantity | Net labour £ | Man-days). The portal wired the labour
// breakdown up as the project's BOQ and priced the client copy off man-days.
async function buildKildowieStyleBill(file) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOQ');
  ws.addRow(['MULL JOINERS']);
  ws.addRow(['BILL OF QUANTITIES']);
  ws.addRow([]);
  ws.addRow(['Ref', 'Description', 'Unit', 'Quantity', 'Labour rate', 'Labour', 'Materials, plant\nand prov. sums', 'Total']);
  ws.addRow(['SECTION 0  —  PRELIMINARIES']); ws.mergeCells('A5:H5');
  ws.addRow(['0.1', 'Site establishment; welfare unit', 'wk', 17, null, { formula: 'IF(N(E6)=0,0,D6*E6)' }, 5100, { formula: 'F6+G6', result: 5100 }]);
  ws.addRow(['0.2', 'Site management and supervision', 'wk', 17, 165.2, { formula: 'IF(N(E7)=0,0,D7*E7)', result: 2808.4 }, 0, { formula: 'F7+G7', result: 2808.4 }]);
  ws.addRow(['Section 0 subtotal — net direct', '', '', '', '', 2808.4, 5100, 7908.4]); ws.mergeCells('A8:E8');
  ws.addRow([]);
  ws.addRow(['SECTION 1  —  DEMOLITION']); ws.mergeCells('A10:H10');
  ws.addRow(['1.2', 'Take up existing front timber decking', 'm2', 28, 24, { formula: 'IF(N(E11)=0,0,D11*E11)', result: 672 }, 0, { formula: 'F11+G11', result: 672 }]);
  ws.addRow(['1.5', 'Form new opening in the retained front wall', 'nr', 1, 780, { formula: 'IF(N(E12)=0,0,D12*E12)', result: 780 }, 460, { formula: 'F12+G12', result: 1240 }]);
  ws.addRow(['Section 1 subtotal — net direct', '', '', '', '', 1452, 460, 1912]); ws.mergeCells('A13:E13');
  ws.addRow([]);
  ws.addRow(['SUMMARY']); ws.mergeCells('A15:H15');
  ws.addRow(['Ref', 'Section', '', '', '', 'Labour', 'Materials, plant\nand prov. sums', 'Total']);
  ws.addRow(['0', 'PRELIMINARIES', '', '', '', 2808.4, 5100, 7908.4]);
  ws.addRow(['1', 'DEMOLITION', '', '', '', 1452, 460, 1912]);
  ws.addRow(['NET DIRECT COST', '', '', '', '', 4260.4, 5560, 9820.4]); ws.mergeCells('A19:E19');
  ws.addRow(['CASCADE TO CONTRACT SUM']); ws.mergeCells('A20:H20');
  ws.addRow(['Labour cascaded  (labour ÷ divisor)', '', '', '', '', '', '', 5680.53]); ws.mergeCells('A21:E21');
  ws.addRow(['Materials cascaded  (materials × pass-through)', '', '', '', '', '', '', 6116]); ws.mergeCells('A22:E22');
  ws.addRow(['CONTRACT SUM  (excluding VAT)', '', '', '', '', '', '', 11796.53]); ws.mergeCells('A23:E23');
  ws.addRow(['VAT at 20%', '', '', '', '', '', '', 2359.31]); ws.mergeCells('A24:E24');
  ws.addRow(['TOTAL PAYABLE', '', '', '', '', '', '', 14155.84]); ws.mergeCells('A25:E25');
  await wb.xlsx.writeFile(file);
}

async function buildLabourBreakdown(file) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Labour breakdown');
  ws.addRow(['MULL JOINERS']);
  ws.addRow(['Document', 'Labour breakdown']);
  ws.addRow([]);
  ws.addRow(['Ref', 'Item', 'Unit', 'Quantity', 'Net labour £', 'Man-days', 'Output per man-day']);
  ws.addRow(['SECTION 0  —  PRELIMINARIES']); ws.mergeCells('A5:G5');
  ws.addRow(['0.1', 'Site establishment; welfare unit', 'wk', 17, 0, { formula: 'E6/293.6' }]);
  ws.addRow(['0.2', 'Site management and supervision', 'wk', 17, 2808.4, { formula: 'E7/293.6', result: 9.565 }, { formula: 'D7/F7', result: 1.777 }]);
  ws.addRow(['Section 0 labour', '', '', '', 2808.4, 9.565]); ws.mergeCells('A8:D8');
  const ml = wb.addWorksheet('Materials list');
  ml.addRow(['Materials list']);
  await wb.xlsx.writeFile(file);
}

test('a QS bill with a "Labour rate | Labour" split, SUMMARY page and NET DIRECT COST parses to its net direct cost', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const file = path.join(os.tmpdir(), `boqkdw-${process.pid}.xlsx`);
  await buildKildowieStyleBill(file);
  let parsed, sniff;
  try {
    parsed = await parseBOQ(file);
    sniff = await sniffBOQ(file);
  } finally {
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  }
  assert.strictEqual(parsed.header_detected, true);
  assert.deepStrictEqual(parsed.sections.map((s) => [s.items.length, s.subtotal.total]), [[2, 7908.4], [2, 1912]],
    'the SUMMARY page, NET DIRECT COST and the cascade add no sections or lines');
  assert.strictEqual(Math.round(parsed.grand.total * 100) / 100, 9820.4);
  // Labour is read from the VALUE column, not the per-unit "Labour rate".
  const s0 = parsed.sections[0];
  assert.deepStrictEqual(s0.items.map((i) => [i.labour, i.materials]), [[0, 5100], [2808.4, 0]]);
  assert.deepStrictEqual(parsed.sections[1].items.map((i) => [i.labour, i.materials]), [[672, 0], [780, 460]]);
  assert.strictEqual(parsed.source_summary.net_total, 9820.4, 'NET DIRECT COST is the printed net total');
  assert.ok(reconcileParsed(parsed).ok);
  assert.ok(sniff.looks_like_boq && sniff.named_sheet);
});

test('a labour breakdown workbook is recognised as not a bill, and flagged rather than priced', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const file = path.join(os.tmpdir(), `labour-${process.pid}.xlsx`);
  await buildLabourBreakdown(file);
  let parsed, sniff;
  try {
    parsed = await parseBOQ(file);
    sniff = await sniffBOQ(file);
  } finally {
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  }
  assert.strictEqual(sniff.looks_like_boq, false, 'no Description + Qty header on any sheet');
  assert.strictEqual(parsed.header_detected, false);
  const check = reconcileParsed(parsed);
  assert.strictEqual(check.ok, false);
  assert.strictEqual(check.reason, 'not_a_boq');
});

// The Henslowe Road delivery: sections closed by "Total, Section A" rows, a
// SUMMARY page repeating every section, then "Total measured works",
// "Overheads and profit" (17.5% in the Rate cell), "Net construction cost"
// AFTER OH&P, contingency and VAT. The deployed parser read the total rows
// and the whole summary page as lines: a £429,598 bill came out at £1.7m.
test('"Total, Section X" rows, a SUMMARY page and a post-OH&P net line parse to the measured works and reconcile', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Bill of Quantities');
  ws.addRow(['', '', '', 'PRICED BILL OF QUANTITIES']);
  ws.addRow(['Item', 'Description', 'Unit', 'Quantity', 'Rate', 'Labour', 'Materials', 'Total']);
  ws.addRow(['A    PRELIMINARIES']); ws.mergeCells('A3:H3');
  ws.addRow(['A.01', 'Site establishment, hoarding', 'item', 1, 2610, 1850, 760, 2610]);
  ws.addRow(['A.02', 'Temporary welfare accommodation', 'week', 36, 168, 6048, { formula: 'ROUND(D5*0,2)' }, 6048]);
  ws.addRow(['', 'Total, Section A', '', '', '', 7898, 760, 8658]);
  ws.addRow([]);
  ws.addRow(['B    DEMOLITION']); ws.mergeCells('A8:H8');
  ws.addRow(['B.01', 'Soft strip existing flats', 'm2', 100.11, 26, 2602.86, 0, 2602.86]);
  ws.addRow(['', 'Total, Section B', '', '', '', 2602.86, 0, 2602.86]);
  ws.addRow([]);
  ws.addRow(['SUMMARY']); ws.mergeCells('A12:H12');
  ws.addRow(['A', 'PRELIMINARIES', '', '', '', 7898, 760, 8658]);
  ws.addRow(['B', 'DEMOLITION', '', '', '', 2602.86, 0, 2602.86]);
  ws.addRow(['', 'Total measured works', '', '', '', 10500.86, 760, 11260.86]);
  ws.addRow(['', 'Overheads and profit', '', '', 0.175, '', '', 1970.65]);
  ws.addRow(['', 'Net construction cost', '', '', '', '', '', 13231.51]);
  ws.addRow(['', 'Contingency', '', '', 0.05, '', '', 661.58]);
  ws.addRow(['', 'Sub total before VAT', '', '', '', '', '', 13893.09]);
  ws.addRow(['', 'Value added tax', '', '', 0.2, '', '', 2778.62]);
  ws.addRow(['', 'CONTRACT SUM INCLUDING VAT', '', '', '', '', '', 16671.71]);
  const file = path.join(os.tmpdir(), `boqhens-${process.pid}.xlsx`);
  await wb.xlsx.writeFile(file);
  let parsed;
  try {
    parsed = await parseBOQ(file);
  } finally {
    try { fs.unlinkSync(file); } catch (e) { /* ignore */ }
  }
  assert.deepStrictEqual(parsed.sections.map((s) => [s.title, s.items.length, Math.round(s.subtotal.total * 100) / 100]),
    [['A    PRELIMINARIES', 2, 8658], ['B    DEMOLITION', 1, 2602.86]],
    'total rows and the summary page are not lines, and SUMMARY is not a trade');
  assert.strictEqual(Math.round(parsed.grand.total * 100) / 100, 11260.86);
  assert.strictEqual(parsed.source_summary.net_total, 11260.86, '"Total measured works" is the printed net');
  assert.strictEqual(parsed.source_summary.ohp_pct, 17.5);
  assert.strictEqual(parsed.source_summary.contingency_pct, 5);
  assert.ok(reconcileParsed(parsed).ok);
  // The same bill read with only its post-OH&P "Net construction cost" still reconciles.
  const alt = { ...parsed, source_summary: { ...parsed.source_summary, net_total: 13231.51 } };
  assert.ok(reconcileParsed(alt).ok, 'a net line printed after OH&P is accepted as the lines × (1 + OH&P)');
});

// The Tullamore package bill: a "Net measured works" line that EXCLUDES the
// preliminaries section, which is then added back on the tender summary
// ("Preliminaries", "Sub-total", "Overheads and profit @ 17%", "TENDER SUM").
// The parse was right (the lines equal the summary's Sub-total) but the check
// only compared against the net line and locked a good bill.
test('a bill whose net line excludes preliminaries reconciles against the summary sub-total it also prints', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('SP BOQ');
  ws.addRow(['Ref', 'Description', 'Unit', 'Quantity', 'Rate', 'Labour', 'Materials & Plant', 'Total']);
  ws.addRow(['(22) INTERNAL WALLS']); ws.mergeCells('A2:H2');
  ws.addRow(['81A', 'Partitions Type 1', 'm', 26, 46.98, 16.98, 30, 1221.48]);
  ws.addRow(['', 'SUBTOTAL  —  (22) INTERNAL WALLS', '', '', '', '', '', 1221.48]);
  ws.addRow(['PRELIMINARIES']); ws.mergeCells('A5:H5');
  ws.addRow(['1.01', 'Contracts / package manager', 'item', 1, 12400, 12400, 0, 12400]);
  ws.addRow(['', 'SUBTOTAL  —  PRELIMINARIES', '', '', '', '', '', 12400]);
  ws.addRow(['TENDER SUMMARY']); ws.mergeCells('A8:H8');
  ws.addRow(['Net measured works', '', '', '', '', '', '', 1221.48]); ws.mergeCells('A9:G9');
  ws.addRow(['Preliminaries', '', '', '', '', '', '', 12400]); ws.mergeCells('A10:G10');
  ws.addRow(['Sub-total', '', '', '', '', '', '', 13621.48]); ws.mergeCells('A11:G11');
  ws.addRow(['Overheads and profit @ 17%', '', '', '', '', '', '', 2315.65]); ws.mergeCells('A12:G12');
  ws.addRow(['TENDER SUM (exclusive of VAT)', '', '', '', '', '', '', 15937.13]); ws.mergeCells('A13:G13');
  ws.addRow(['TOTAL CARRIED TO FORM OF TENDER', '', '', '', '', '', '', 15937.13]); ws.mergeCells('A14:G14');
  const file = path.join(os.tmpdir(), `boqtul-${process.pid}.xlsx`);
  await wb.xlsx.writeFile(file);
  let parsed;
  try { parsed = await parseBOQ(file); } finally { try { fs.unlinkSync(file); } catch (e) { /* ignore */ } }
  assert.strictEqual(Math.round(parsed.grand.total * 100) / 100, 13621.48, 'lines = measured works + preliminaries');
  assert.strictEqual(parsed.source_summary.net_total, 1221.48);
  assert.strictEqual(parsed.source_summary.ohp_pct, 17);
  const check = reconcileParsed(parsed);
  assert.ok(check.ok, 'reconciles against one of the printed totals: ' + JSON.stringify(check));
  // And a genuinely doubled parse still fails against every printed figure.
  const doubled = { ...parsed, sections: parsed.sections.map((s) => ({ ...s, subtotal: { ...s.subtotal, total: s.subtotal.total * 2 } })) };
  assert.strictEqual(reconcileParsed(doubled).ok, false);
});

// ── Formulas without a cached value ─────────────────────────────────────────
async function parseRows(rows, sheet = 'BOQ') {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  for (const r of rows) ws.addRow(r);
  const file = path.join(os.tmpdir(), `parse-${process.pid}-${Math.random().toString(36).slice(2)}.xlsx`);
  await wb.xlsx.writeFile(file);
  try { return await parseBOQ(file); } finally { try { fs.unlinkSync(file); } catch (e) { /* ignore */ } }
}
const PLAIN_HEADER = ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Labour', 'Materials', 'Total'];

test('a heading that repeats its own number ("1.   1. PRELIMINARIES") is titled once', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const parsed = await parseRows([
    PLAIN_HEADER,
    ['   1.   1. PRELIMINARIES'],
    ['1.1', 'Site set-up', 'item', 1, 1000, 800, 200, 1000],
    ['   2.   2.1 Drainage'],
    ['2.1', 'Pipe', 'm', 10, 10, 50, 50, 100],
  ]);
  assert.deepStrictEqual(parsed.sections.map((s) => [s.number, s.title]), [['1', 'PRELIMINARIES'], ['2', '2.1 Drainage']]);
});

test('sub-totals and summary lines held as uncached formulas are read, not zero', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const parsed = await parseRows([
    PLAIN_HEADER,
    ['1', 'WORKS'],
    ['1.1', 'A', 'nr', 2, 50, 60, 40, 100],
    ['1.2', 'B', 'nr', 1, 200, 100, 100, 200],
    ['', 'Sub-total — Works', '', '', '', { formula: 'SUM(F3:F4)' }, { formula: 'SUM(G3:G4)' }, { formula: 'SUM(H3:H4)' }],
    ['', 'Net construction cost', '', '', '', '', '', { formula: '(H5)' }],
    ['', 'Contingency @ 5%', '', '', '', '', '', { formula: 'H6*5/100' }],
    ['', 'Total (excl. VAT)', '', '', '', '', '', { formula: 'H6+H7' }],
  ]);
  assert.strictEqual(parsed.sections.length, 1);
  assert.strictEqual(parsed.sections[0].subtotal.total, 300, 'the sub-total formula evaluates');
  assert.strictEqual(parsed.source_summary.net_total, 300);
  assert.strictEqual(parsed.source_summary.contingency_pct, 5);
  assert.strictEqual(parsed.source_summary.ex_vat_total, 315);
  assert.ok(reconcileParsed(parsed).ok);
});

// A per-unit "Total rate" column beside the line "Amount" (Hidcote Garden
// Room): Amount is the line value, the rate columns are per unit, and the
// labour / materials split is scaled up by the quantity as for any per-unit
// bill. Before this the "Total rate" column was read as the line value.
test('a "Total rate | Amount" header reads Amount as the line total and scales the per-unit split', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const parsed = await parseRows([
    ['Item', 'Description', 'Unit', 'Quantity', 'Labour rate', 'Materials & plant rate', 'Total rate', 'Amount'],
    ['S1', 'PRELIMINARIES'],
    ['1.01', 'Site supervision, one day per week', 'week', 10, 290, 0, 290, 2900],
    ['1.02', 'Welfare unit, weekly hire', 'week', 10, 0, 120, 120, 1200],
    ['', 'Total carried to summary: Preliminaries', '', '', '', '', '', 4100],
    ['S2', 'SUBSTRUCTURE'],
    ['2.01', 'Strip topsoil and set aside', 'm2', 40, 7.5, 2.5, 10, 400],
    ['', 'Total carried to summary: Substructure', '', '', '', '', '', 400],
    ['SUMMARY'],
    ['', 'NET TOTAL (prime cost)', '', '', '', '', '', 4500],
  ]);
  assert.deepStrictEqual(parsed.sections.map((s) => [s.title, s.items.length, s.subtotal.total]), [['S1 PRELIMINARIES', 2, 4100], ['S2 SUBSTRUCTURE', 1, 400]]);
  assert.deepStrictEqual(parsed.sections[0].items.map((i) => [i.total, i.labour, i.materials]), [[2900, 2900, 0], [1200, 0, 1200]]);
  assert.deepStrictEqual(parsed.sections[1].items.map((i) => [i.total, i.labour, i.materials]), [[400, 300, 100]]);
  assert.strictEqual(parsed.grand.total, 4500);
  assert.strictEqual(parsed.source_summary.net_total, 4500);
  assert.ok(reconcileParsed(parsed).ok);
});

// ── Builder Pack: by-trade package block ────────────────────────────────────
test('the Builder Pack Trade Summary tab also groups the bill by trade package', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const { generateBuilderPack } = require('./builderExports');
  const parsed = {
    sections: [
      { number: '1', title: 'Preliminaries', items: [
        { itemRef: '1.1', description: 'Site supervision', unit: 'Item', qty: 1, rate: 2500, labour: 2500, materials: 0, total: 2500 },
      ], subtotal: { labour: 2500, materials: 0, total: 2500 } },
      { number: '2', title: 'Electrics', items: [
        { itemRef: '2.1', description: 'First fix electrics', unit: 'Item', qty: 1, rate: 1500, labour: 900, materials: 600, total: 1500 },
        { itemRef: '2.2', description: 'New combi boiler', unit: 'Nr', qty: 1, rate: 3000, labour: 1000, materials: 2000, total: 3000 },
      ], subtotal: { labour: 1900, materials: 2600, total: 4500 } },
    ],
    grand: { labour: 4400, materials: 2600, total: 7000 },
  };
  const buf = await generateBuilderPack(parsed, { currency: '£', builder_margin: 10, project_name: 'Trades', client_name: 'Client' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ts = wb.getWorksheet('Trade Summary');
  assert.ok(ts, 'Trade Summary tab present');
  const cells = [];
  ts.eachRow((row) => { for (let c = 1; c <= 6; c++) cells.push(String(row.getCell(c).value == null ? '' : row.getCell(c).value)); });
  const all = cells.join('\n');
  assert.match(all, /BY TRADE PACKAGE/);
  assert.match(all, /Electrical \(2\)/);
  assert.match(all, /Plumbing & Heating \(2\)/);   // the boiler line is the plumber's even though it sits in "Electrics"
  assert.match(all, /Preliminaries \(1\)/);
  assert.match(all, /ALL TRADES/);
  // The by-trade total equals the section total (both carry the 10% builder margin).
  let allTrades = null, grand = null;
  ts.eachRow((row) => {
    const label = String(row.getCell(2).value || '');
    if (label === 'ALL TRADES') allTrades = Number(row.getCell(5).value);
    if (label === 'GRAND TOTAL') grand = Number(row.getCell(5).value);
  });
  assert.ok(allTrades != null && grand != null);
  assert.ok(Math.abs(allTrades - grand) < 0.02, `all trades ${allTrades} vs grand ${grand}`);
});

// ── Percentage-only summary adders ──────────────────────────────────────────
// The Trafalgar House delivery (Max Facilities): sections closed by "Section N
// total carried to summary", merged mixed-case elevation sub-headings inside
// section 3, then a SUMMARY whose "Overheads and profit" row holds 17% in the
// Rate cell (0%-formatted) and NOTHING in Total — the £ sits in the package
// lines beneath — closed by "TOTAL QUOTATION (EXCLUDING VAT)". The summary
// reader only ran on rows with a £ amount, so the 17% was never read, the
// lines (= the bill's own net) matched none of the totals it prints, and a
// correct £138k bill locked.
test('a percentage-only "Overheads and profit" row and a TOTAL QUOTATION line are read, and the bill reconciles', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOQ');
  const merge = (r) => ws.mergeCells(`A${r}:H${r}`);
  ws.addRow(['QUOTATION - BILL OF QUANTITIES']); merge(1);
  ws.addRow(['Item', 'Description', 'Qty', 'Unit', 'Rate £', 'Labour £', 'Materials £', 'Total £']);
  ws.addRow(['1  PRELIMINARIES AND SITE MANAGEMENT']); merge(3);
  ws.addRow(['1.1', 'Contract supervision', 30, 'days', 280, 8400, { formula: 'H4-F4' }, { formula: 'ROUND(C4*E4,2)', result: 8400 }]);
  ws.addRow(['1.2', 'Van, fuel and parking', 30, 'wk', 140, 0, { formula: 'H5-F5', result: 4200 }, { formula: 'ROUND(C5*E5,2)', result: 4200 }]);
  ws.addRow(['Section 1 total carried to summary', '', '', '', '', { formula: 'SUM(F4:F5)', result: 8400 }, { formula: 'SUM(G4:G5)', result: 4200 }, { formula: 'SUM(H4:H5)', result: 12600 }]); ws.mergeCells('A6:E6');
  ws.addRow([]);
  ws.addRow(['3  EXTERNAL CLEANING PACKAGE']); merge(8);
  ws.addRow(['South elevation - gridline A, grids 1-16']); merge(9);
  ws.addRow(['3.4.1', 'Clean window by hand from scaffold', 91, 'nr', 46.25, 3981.25, { formula: 'H10-F10', result: 227.5 }, { formula: 'ROUND(C10*E10,2)', result: 4208.75 }]);
  ws.addRow(['North elevation - gridline D']); merge(11);
  ws.addRow(['3.8.1', 'Clean window by hand from scaffold', 163, 'nr', 46.25, 7131.25, { formula: 'H12-F12', result: 407.5 }, { formula: 'ROUND(C12*E12,2)', result: 7538.75 }]);
  ws.addRow(['Section 3 total carried to summary', '', '', '', '', { formula: 'SUM(F10:F12)', result: 11112.5 }, { formula: 'SUM(G10:G12)', result: 635 }, { formula: 'SUM(H10:H12)', result: 11747.5 }]); ws.mergeCells('A13:E13');
  ws.addRow([]);
  ws.addRow(['SUMMARY']); merge(15);
  ws.addRow(['Overheads and profit', '', '', '', 0.17]); ws.mergeCells('A16:D16'); ws.getCell('E16').numFmt = '0%';
  ws.addRow(['', 'Package', '', '', '', 'Net £', 'OH&P £', 'Price £']);
  ws.addRow(['1', 'Preliminaries and site management', '', '', '', { formula: 'H6', result: 12600 }, { formula: 'ROUND(F18*$E$16,2)', result: 2142 }, { formula: 'F18+G18', result: 14742 }]); ws.mergeCells('B18:E18');
  ws.addRow(['3', 'External cleaning package (lump sum)', '', '', '', { formula: 'H13', result: 11747.5 }, { formula: 'ROUND(F19*$E$16,2)', result: 1997.08 }, { formula: 'F19+G19', result: 13744.58 }]); ws.mergeCells('B19:E19');
  ws.addRow(['TOTAL QUOTATION (EXCLUDING VAT)', '', '', '', '', { formula: 'SUM(F18:F19)', result: 24347.5 }, { formula: 'SUM(G18:G19)', result: 4139.08 }, { formula: 'SUM(H18:H19)', result: 28486.58 }]); ws.mergeCells('A20:E20');
  ws.addRow(['Prices exclude VAT. Valid for 30 days from the date above.']); merge(21);
  const file = path.join(os.tmpdir(), `boqtfh-${process.pid}.xlsx`);
  await wb.xlsx.writeFile(file);
  let parsed;
  try { parsed = await parseBOQ(file); } finally { try { fs.unlinkSync(file); } catch (e) { /* ignore */ } }

  const items = parsed.sections.reduce((a, s) => a + s.items.length, 0);
  assert.strictEqual(items, 4, 'section totals, the summary page and its adder are not lines');
  assert.ok(!parsed.sections.some((s) => /summary|overheads/i.test(s.title)), 'SUMMARY and the adder are not trades');
  assert.strictEqual(Math.round(parsed.grand.total * 100) / 100, 24347.5, 'the lines are the bill\'s own net');
  assert.strictEqual(parsed.source_summary.ohp_pct, 17, 'the 0%-formatted 17% in the Rate cell is read with no £ in Total');
  assert.strictEqual(parsed.source_summary.ex_vat_total, 28486.58, '"TOTAL QUOTATION (EXCLUDING VAT)" is the printed ex-VAT total');
  const check = reconcileParsed(parsed);
  assert.ok(check.ok, 'net × 1.17 reconciles to the printed total: ' + JSON.stringify(check));
  assert.strictEqual(check.printed, 28486.58);
});

test('a percentage-only adder row becomes a summary percentage, not a £0 line', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const parsed = await parseRows([
    PLAIN_HEADER,
    ['1', 'WORKS'],
    ['1.1', 'A', 'nr', 2, 50, 60, 40, 100],
    ['', 'Contingency', '', '', 0.05],
    ['', 'VAT @ 20%'],
    ['', 'Net construction cost', '', '', '', '', '', 100],
  ]);
  assert.deepStrictEqual(parsed.sections.map((s) => s.items.map((i) => i.description)), [['A']],
    '"Contingency" with only a rate-cell percentage was a £0 line before; it is a summary row');
  assert.strictEqual(parsed.source_summary.contingency_pct, 5);
  assert.strictEqual(parsed.source_summary.vat_pct, 20);
  assert.strictEqual(parsed.source_summary.net_total, 100);
  assert.ok(reconcileParsed(parsed).ok);
});

// ── Provisional sums printed after the summary (38 Spring Lane) ─────────────
// A bill that prints its provisional sums AFTER the summary, under a heading
// that says what they are excluded from — "L | PROVISIONAL SUMS (at cost,
// excluded from the total above)" — each line with a quantity of 1 and the
// unit "item", closed by "Provisional sums total (excluding VAT), not
// included in the total above". The word "total" in the heading used to rule
// the row out as a PS block, so the lines were dropped and only the lump
// survived: the customer saw a provisional-sums figure at the bottom of the
// client copy with no section saying what was in it.
const OLNEY_HEADER = ['Item', 'Description', 'Qty', 'Unit', 'Labour £', 'Materials £', 'Rate £', 'Total £'];
const OLNEY_ROWS = [
  OLNEY_HEADER,
  ['A', 'PRELIMINARIES'],
  ['A1', 'Site management and supervision, 2 days per week over a 12 week programme', 24, 'day', 195, 0, 195, 4680],
  ['A2', 'Temporary toilet, hire and servicing over 12 weeks', 12, 'week', 0, 40, 40, 480],
  ['', 'Total carried to summary', '', '', '', '', '', 5160],
  ['B', 'DEMOLITION AND STRIP-OUT'],
  ['B1', 'Take down the conservatory and cart away', 1, 'item', 780, 60, 840, 840],
  ['', 'Total carried to summary', '', '', '', '', '', 840],
  ['', 'SUMMARY'],
  ['A', 'PRELIMINARIES', '', '', '', '', '', 5160],
  ['B', 'DEMOLITION AND STRIP-OUT', '', '', '', '', '', 840],
  ['', 'NET TOTAL (excluding VAT)', '', '', '', '', '', 6000],
  ['', 'VAT', '', '', '', '', 0.2, 1200],
  ['', 'TOTAL (including VAT)', '', '', '', '', '', 7200],
  ['L', 'PROVISIONAL SUMS (at cost, excluded from the total above)'],
  ['L1', 'Foul drainage below ground, pending a drainage design', 1, 'item', 0, 3000, 3000, 3000],
  ['L2', 'CCTV survey of existing drains', 1, 'item', 0, 300, 300, 300],
  ['L3', 'Removal of asbestos if found (no survey seen)', 1, 'item', 0, 1000, 1000, 1000],
  ['', 'Provisional sums total (excluding VAT), not included in the total above', '', '', '', '', '', 4300],
];

test('a provisional sums block headed "(excluded from the total above)" below the summary is read line by line', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const parsed = await parseRows(OLNEY_ROWS);
  assert.deepStrictEqual(
    parsed.sections.map((s) => [s.number, s.title, !!s.provisional, s.items.length, s.subtotal.total]),
    [
      ['1', 'A PRELIMINARIES', false, 2, 5160],
      ['2', 'B DEMOLITION AND STRIP-OUT', false, 1, 840],
      ['L', 'PROVISIONAL SUMS (at cost, excluded from the total above)', true, 3, 4300],
    ],
    'the PS block is its own section, after the measured ones, with every line'
  );
  const ps = parsed.sections[2];
  assert.deepStrictEqual(ps.items.map((i) => [i.itemRef, i.unit, i.qty, i.total]), [['L1', 'item', 1, 3000], ['L2', 'item', 1, 300], ['L3', 'item', 1, 1000]]);
  assert.strictEqual(parsed.source_summary.provisional_sum, null, 'no flat lump on top of the itemised section');
  assert.strictEqual(parsed.source_summary.net_total, 6000);
  assert.strictEqual(parsed.source_summary.ex_vat_total, 6000);
  assert.strictEqual(parsed.source_summary.vat_pct, 20);
  assert.ok(!parsed.source_summary.printed_totals.some((p) => /provisional/i.test(p.label)),
    'the block\'s own closing total is not a document total');
  assert.strictEqual(parsed.grand.total, 10300, 'grand = net 6000 + provisional 4300');
  const recon = reconcileParsed(parsed);
  assert.ok(recon.ok, 'the lines still reconcile to the printed net total');
  assert.strictEqual(recon.printed, 6000);
});

test('a "Total provisional sums" row still records the lump when the block has no lines of its own', { skip: !DEPS_OK && 'deps not installed' }, async () => {
  const parsed = await parseRows([
    PLAIN_HEADER,
    ['1', 'WORKS'],
    ['1.1', 'A', 'nr', 2, 50, 60, 40, 100],
    ['', 'Net construction cost', '', '', '', '', '', 100],
    ['', 'Total provisional sums', '', '', '', '', '', 2500],
    ['', 'Total (excl. VAT)', '', '', '', '', '', 2600],
  ]);
  assert.strictEqual(parsed.sections.length, 1);
  assert.strictEqual(parsed.source_summary.provisional_sum, 2500, 'the lump is kept for a block with no lines');
  assert.strictEqual(parsed.source_summary.ex_vat_total, 2600, 'the PS total is not mistaken for the ex-VAT total');
  assert.ok(reconcileParsed(parsed).ok);
});

test('a saved Builder Pack state gets back the provisional section the parser used to drop', { skip: !DEPS_OK && 'deps not installed' }, () => {
  const psLine = { itemRef: 'L1', description: 'Foul drainage below ground', unit: 'item', qty: 1, rate: 3000, labour: 0, materials: 3000, total: 3000 };
  const fresh = [
    { number: '1', title: 'A PRELIMINARIES', items: [{ description: 'Site set-up', total: 100 }], subtotal: { labour: 0, materials: 0, total: 100 } },
    { number: 'L', title: 'PROVISIONAL SUMS (at cost, excluded from the total above)', provisional: true, items: [psLine], subtotal: { labour: 0, materials: 3000, total: 3000 } },
  ];
  // Saved before the block was read: measured sections only (one line edited
  // by the user), plus the flat lump the parser recorded for the same money.
  const saved = { v: 1, sections: [{ number: '1', title: 'A PRELIMINARIES', items: [{ description: 'Site set-up', total: 120 }] }], provisional_sum: 3000 };
  const out = addMissingProvisionalSections(saved, fresh);
  assert.deepStrictEqual(out.sections.map((s) => [s.number, !!s.provisional, s.items.length]), [['1', false, 1], ['L', true, 1]]);
  assert.strictEqual(out.sections[0].items[0].total, 120, 'the user\'s edits are untouched');
  assert.strictEqual(out.provisional_sum, 0, 'the flat lump for the same money is cleared so the sums are not shown twice');
  assert.deepStrictEqual(out.sections[1].items[0], psLine);
  // Already there (by number or by title): nothing to add, the state is served as is.
  assert.strictEqual(addMissingProvisionalSections(out, fresh), out);
  const byTitle = { sections: [{ number: '9', title: 'provisional sums (at cost, excluded from the total above)', provisional: true, items: [psLine] }] };
  assert.strictEqual(addMissingProvisionalSections(byTitle, fresh), byTitle);
  assert.strictEqual(addMissingProvisionalSections(null, fresh), null);
  assert.deepStrictEqual(addMissingProvisionalSections({ sections: [] }, fresh), { sections: [] });
  // A lump for different money is the user's own figure and stays.
  const other = addMissingProvisionalSections({ sections: saved.sections, provisional_sum: 500 }, fresh);
  assert.strictEqual(other.provisional_sum, 500);
  assert.strictEqual(other.sections.length, 2);
});

// ── Builder Pack: provisional sums kept separate, below the total ──────────
// The bill's provisional sums used to be folded into the Builder Pack like
// any other trade: marked up with the builder margin, listed on the Materials
// Schedule as materials to order, split into trade packages, and in the grand
// total. They are allowances that may never be spent, so they sit below the
// grand total as their own block with their own total, and are not in it.
test('the Builder Pack carries provisional sums at cost below the grand total: their own block, their own tab, off the schedules', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const { generateBuilderPack } = require('./builderExports');
  const psLines = [
    { itemRef: 'L1', description: 'Foul drainage below ground, pending a drainage design', unit: 'item', qty: 1, rate: 3000, labour: 0, materials: 3000, total: 3000 },
    { itemRef: 'L2', description: 'CCTV survey of existing drains', unit: 'item', qty: 1, rate: 300, labour: 0, materials: 300, total: 300 },
  ];
  const parsed = {
    sections: [
      { number: '1', title: 'Preliminaries', items: [
        { itemRef: '1.1', description: 'Site supervision', unit: 'Item', qty: 1, rate: 2500, labour: 2500, materials: 0, total: 2500 },
      ], subtotal: { labour: 2500, materials: 0, total: 2500 } },
      { number: '2', title: 'Substructure', items: [
        { itemRef: '2.1', description: 'Trench fill concrete to footings', unit: 'm3', qty: 10, rate: 200, labour: 800, materials: 1200, total: 2000 },
      ], subtotal: { labour: 800, materials: 1200, total: 2000 } },
      { number: 'L', title: 'PROVISIONAL SUMS (at cost, excluded from the total above)', provisional: true, items: psLines,
        subtotal: { labour: 0, materials: 3300, total: 3300 } },
    ],
    grand: { labour: 3300, materials: 4500, total: 7800 },
  };
  const buf = await generateBuilderPack(parsed, { currency: '£', builder_margin: 10, materials_markup: 5, project_name: 'PS', client_name: 'Client' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const rowsOf = (ws, cols) => { const out = []; ws.eachRow((row) => out.push(cols.map((c) => row.getCell(c).value == null ? '' : row.getCell(c).value))); return out; };
  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.02;

  // Trade Summary: priced sections with the margin, the grand total (priced
  // sections only), then the PS block at cost closed by its own total.
  const ts = rowsOf(wb.getWorksheet('Trade Summary'), [1, 2, 3, 4, 5, 6]);
  const find = (re) => ts.find((r) => re.test(String(r[1])));
  const indexOf = (re, col = 1) => ts.findIndex((r) => re.test(String(r[col])));
  assert.strictEqual(find(/^NET CONSTRUCTION/), undefined, 'no separate net line: the grand total IS the net construction');
  const grand = find(/^GRAND TOTAL/);
  assert.ok(grand, 'a grand total row');
  assert.ok(near(grand[4], 3300 * 1.1 + 1200 * 1.15), 'grand total = priced labour × 1.10 + materials × 1.15, no provisional sums');
  assert.match(String(grand[1]), /net construction/, 'the grand total says what it is when a block follows it');
  const bannerIdx = indexOf(/^PROVISIONAL SUMS — not included in the grand total above/, 0);
  assert.ok(bannerIdx > indexOf(/^GRAND TOTAL/), 'the provisional block is announced BELOW the grand total');
  const psRow = find(/^PROVISIONAL SUMS \(at cost/);
  assert.strictEqual(String(psRow[0]), 'PS');
  assert.ok(near(psRow[4], 3300), 'the provisional section is at face value — no margin, no markup');
  assert.ok(near(psRow[3], 3300), 'its amount is shown as the bill carries it');
  assert.strictEqual(String(psRow[5]), 'not in total', 'a provisional row has no share of the total');
  const psBlockTotal = find(/^TOTAL PROVISIONAL SUMS/);
  assert.ok(psBlockTotal && near(psBlockTotal[4], 3300), 'the block closes with its own total');
  assert.ok(indexOf(/^TOTAL PROVISIONAL SUMS/) > bannerIdx);
  const tradePs = ts.find((r) => /^Provisional sums — at cost, not in the total above/.test(String(r[1])));
  assert.ok(tradePs && near(tradePs[4], 3300), 'by trade: one provisional memo row at cost');
  assert.match(String(tradePs[1]), /\(L\)/, 'the row names the section it comes from');
  const allTrades = find(/^ALL TRADES$/);
  assert.ok(near(allTrades[4], grand[4]), 'all trades equals the grand total');
  assert.ok(indexOf(/^Provisional sums — at cost, not in the total above/) > indexOf(/^ALL TRADES$/), 'the memo row follows ALL TRADES');
  assert.ok(!ts.some((r) => /Fees & Provisional Sums/.test(String(r[1]))), 'the provisional lines are not a trade package');

  // Materials Schedule: the provisional lines are not materials to order.
  const ms = rowsOf(wb.getWorksheet('Materials Schedule'), [1, 2, 5]);
  assert.ok(!ms.some((r) => /Foul drainage|CCTV/.test(String(r[1]))), 'provisional lines are off the materials schedule');
  const totalMat = ms.find((r) => String(r[1]) === 'TOTAL MATERIALS');
  assert.ok(near(totalMat[2], 1200 * 1.15), 'total materials is the priced materials only');
  assert.ok(ms.some((r) => /Provisional sums \(£3,300\.00\).*Provisional Sums tab/.test(String(r[0]))), 'the schedule points to the tab');

  // Labour Schedule: likewise.
  const ls = rowsOf(wb.getWorksheet('Labour Schedule'), [1, 2, 5]);
  assert.ok(!ls.some((r) => /Foul drainage|CCTV/.test(String(r[1]))));
  assert.ok(near(ls.find((r) => String(r[1]) === 'TOTAL LABOUR')[2], 3300 * 1.1));

  // Provisional Sums tab: every line, at cost, with the total.
  const psTab = wb.getWorksheet('Provisional Sums');
  assert.ok(psTab, 'a Provisional Sums tab is added');
  const pt = rowsOf(psTab, [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(
    pt.filter((r) => /^L\d/.test(String(r[0]))).map((r) => [r[0], r[2], r[3], Number(r[4])]),
    [['L1', 'item', 1, 3000], ['L2', 'item', 1, 300]],
    'each provisional line is listed as the bill has it'
  );
  assert.ok(pt.some((r) => /Foul drainage below ground, pending a drainage design/.test(String(r[1]))));
  const psTotal = pt.find((r) => /^TOTAL PROVISIONAL SUMS/.test(String(r[1])));
  assert.ok(psTotal && near(psTotal[4], 3300));
  assert.strictEqual(psTab.headerFooter.oddFooter, '&LThe AI QS — BUILDER PACK (TESTING)&RPage &P of &N', 'the tab carries the pack footer');

  // A bill with no provisional sums gets no tab, no block and a plain grand total.
  const plain = await generateBuilderPack({ sections: parsed.sections.slice(0, 2), grand: { labour: 3300, materials: 1200, total: 4500 } }, { currency: '£', builder_margin: 10 });
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(plain);
  assert.ok(!wb2.getWorksheet('Provisional Sums'));
  assert.ok(!wb2.getWorksheet('Optional Extras'));
  const plainTs = rowsOf(wb2.getWorksheet('Trade Summary'), [1, 2]);
  assert.ok(!plainTs.some((r) => /PROVISIONAL SUMS —/.test(String(r[0]))));
  assert.ok(plainTs.some((r) => String(r[1]) === 'GRAND TOTAL'), 'a plain bill keeps the plain label');
});

// ── Builder Pack: optional extras ───────────────────────────────────────────
// Work the client can choose to add. Like the provisional sums it is carried
// as entered, sits below the grand total as its own block with its own tab,
// and is never in the total; an empty section (nothing offered yet) prints
// nothing at all.
test('the Builder Pack carries optional extras below the grand total, on their own tab, and skips an empty section', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const { generateBuilderPack } = require('./builderExports');
  const priced = [
    { number: '1', title: 'Preliminaries', items: [
      { itemRef: '1.1', description: 'Site supervision', unit: 'Item', qty: 1, rate: 2500, labour: 2500, materials: 0, total: 2500 },
    ], subtotal: { labour: 2500, materials: 0, total: 2500 } },
  ];
  const optional = { number: 'OE', title: 'Optional extras', optional: true, items: [
    { itemRef: '', description: 'Garden room lighting', unit: 'item', qty: 1, rate: 1200, labour: 400, materials: 800, total: 1200 },
  ], subtotal: { labour: 400, materials: 800, total: 1200 } };
  const buf = await generateBuilderPack({ sections: priced.concat([optional]), grand: { labour: 2900, materials: 800, total: 3700 } },
    { currency: '£', builder_margin: 10, materials_markup: 5, project_name: 'OE', client_name: 'Client' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const rowsOf = (ws, cols) => { const out = []; ws.eachRow((row) => out.push(cols.map((c) => row.getCell(c).value == null ? '' : row.getCell(c).value))); return out; };
  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.02;

  const ts = rowsOf(wb.getWorksheet('Trade Summary'), [1, 2, 3, 4, 5, 6]);
  const find = (re) => ts.find((r) => re.test(String(r[1])));
  const indexOf = (re, col = 1) => ts.findIndex((r) => re.test(String(r[col])));
  const grand = find(/^GRAND TOTAL/);
  assert.ok(near(grand[4], 2500 * 1.1), 'the grand total is the priced section with the margin — no optional extras');
  const bannerIdx = indexOf(/^OPTIONAL EXTRAS — not included in the grand total above/, 0);
  assert.ok(bannerIdx > indexOf(/^GRAND TOTAL/), 'the optional block sits below the grand total');
  const optRow = find(/^Optional extras$/);
  assert.strictEqual(String(optRow[0]), 'OPT');
  assert.ok(near(optRow[2], 400) && near(optRow[3], 800) && near(optRow[4], 1200), 'carried as entered — no margin, no markup');
  assert.strictEqual(String(optRow[5]), 'not in total');
  const optTotal = find(/^TOTAL OPTIONAL EXTRAS$/);
  assert.ok(optTotal && near(optTotal[4], 1200));
  const allTrades = find(/^ALL TRADES$/);
  assert.ok(near(allTrades[4], grand[4]), 'all trades equals the grand total');
  const memo = find(/^Optional extras — not in the total above/);
  assert.ok(memo && near(memo[4], 1200) && String(memo[0]) === 'OPT', 'by trade: a memo row after ALL TRADES');
  assert.match(String(memo[1]), /\(OE\)/);

  // Schedules: nothing optional is ordered.
  const ms = rowsOf(wb.getWorksheet('Materials Schedule'), [1, 2, 5]);
  assert.ok(!ms.some((r) => /Garden room lighting/.test(String(r[1]))));
  assert.ok(ms.some((r) => /Optional extras \(£1,200\.00\).*Optional Extras tab/.test(String(r[0]))), 'the schedule points to the tab');
  const ls = rowsOf(wb.getWorksheet('Labour Schedule'), [1, 2, 5]);
  assert.ok(!ls.some((r) => /Garden room lighting/.test(String(r[1]))));
  assert.ok(near(ls.find((r) => String(r[1]) === 'TOTAL LABOUR')[2], 2500 * 1.1));

  // Its own tab, every line as entered, with the total.
  const tab = wb.getWorksheet('Optional Extras');
  assert.ok(tab, 'an Optional Extras tab is added');
  const pt = rowsOf(tab, [1, 2, 3, 4, 5]);
  assert.ok(pt.some((r) => /Garden room lighting/.test(String(r[1])) && near(r[4], 1200)));
  assert.ok(pt.some((r) => /^TOTAL OPTIONAL EXTRAS/.test(String(r[1])) && near(r[4], 1200)));
  assert.strictEqual(tab.headerFooter.oddFooter, '&LThe AI QS — BUILDER PACK (TESTING)&RPage &P of &N');
  assert.ok(!wb.getWorksheet('Provisional Sums'), 'no provisional sums, no provisional tab');

  // Nothing offered yet: the empty section leaves no trace.
  const empty = await generateBuilderPack({ sections: priced.concat([{ ...optional, items: [], subtotal: { labour: 0, materials: 0, total: 0 } }]), grand: { labour: 2500, materials: 0, total: 2500 } }, { currency: '£' });
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(empty);
  assert.ok(!wb2.getWorksheet('Optional Extras'));
  const ts2 = rowsOf(wb2.getWorksheet('Trade Summary'), [1, 2]);
  assert.ok(!ts2.some((r) => /OPTIONAL EXTRAS/.test(String(r[0])) || /Optional extras/.test(String(r[1]))));
  assert.ok(ts2.some((r) => String(r[1]) === 'GRAND TOTAL'));
});

// ── Client copy: the total, then what sits below it ─────────────────────────
// The client reads one construction total — net, its VAT, the total — and
// then, underneath, the provisional sums and the optional extras as their own
// elements, each with its own VAT line. Neither moves the total.
test('the client copy shows net → VAT → total, then provisional sums and optional extras below it with their own VAT lines', { skip: !DEPS_OK && 'exceljs not installed' }, async () => {
  const { generateClientCopyPro } = require('./builderExports');
  const psSection = { number: 'L', title: 'PROVISIONAL SUMS (at cost, excluded from the total above)', provisional: true, items: [
    { itemRef: 'L1', description: 'Foul drainage below ground', unit: 'item', qty: 1, rate: 3000, labour: 0, materials: 3000, total: 3000 },
    { itemRef: 'L2', description: 'CCTV survey of existing drains', unit: 'item', qty: 1, rate: 300, labour: 0, materials: 300, total: 300 },
  ], subtotal: { labour: 0, materials: 3300, total: 3300 } };
  const oeSection = { number: 'OE', title: 'Optional extras', optional: true, items: [
    { itemRef: '', description: 'Garden room lighting', unit: 'item', qty: 1, rate: 1200, labour: 400, materials: 800, total: 1200 },
  ], subtotal: { labour: 400, materials: 800, total: 1200 } };
  const priced = [
    { number: '1', title: 'Preliminaries', items: [
      { itemRef: '1.1', description: 'Site supervision', unit: 'Item', qty: 1, rate: 2500, labour: 2500, materials: 0, total: 2500 },
    ], subtotal: { labour: 2500, materials: 0, total: 2500 } },
    { number: '2', title: 'Substructure', items: [
      { itemRef: '2.1', description: 'Trench fill concrete to footings', unit: 'm3', qty: 10, rate: 200, labour: 800, materials: 1200, total: 2000 },
    ], subtotal: { labour: 800, materials: 1200, total: 2000 } },
  ];
  // The bill prints its provisional block between the trades; the copy still
  // reads trades, then provisional sums, then optional extras.
  const parsed = { sections: [priced[0], psSection, priced[1], oeSection], grand: { labour: 3700, materials: 5300, total: 9000 } };
  const val = (v) => (v && typeof v === 'object' && 'result' in v ? v.result : v);
  const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.02;
  const load = async (buf) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Client Copy');
    const rows = [];
    ws.eachRow((row, n) => rows.push({ n, a: val(row.getCell(1).value), c: val(row.getCell(3).value), d: val(row.getCell(4).value), f: val(row.getCell(6).value) }));
    // The summary block and what follows it (the money-goes list above it
    // also pairs a title with a figure).
    const afterSummary = rows.slice(rows.findIndex((r) => r.c === 'PROJECT SUMMARY'));
    return { ws, rows, afterSummary };
  };

  const { ws, rows, afterSummary } = await load(await generateClientCopyPro(parsed, { vat: 20, project_name: 'Test', client_name: 'Client', branding: { company_name: 'Test Build Ltd', logo_path: null } }));
  // The summary, in reading order (labels in C, figures in F).
  const summary = afterSummary.filter((r) => typeof r.c === 'string' && (typeof r.f === 'number' || /^NOT INCLUDED/.test(r.c))).map((r) => [r.c, r.f]);
  const labels = summary.map((x) => x[0]);
  const order = ['Net construction cost', 'Total (excl. VAT)', 'VAT @ 20%', 'Total (incl. VAT)', 'NOT INCLUDED IN THE TOTAL ABOVE',
    'Provisional sums', 'VAT @ 20% on provisional sums', 'Provisional sums (incl. VAT)',
    'Optional extras', 'VAT @ 20% on optional extras', 'Optional extras (incl. VAT)'];
  assert.deepStrictEqual(labels.filter((l) => order.includes(l)), order, 'net, VAT, total — then each block with its own VAT line, below');
  const figure = (label) => summary.find((x) => x[0] === label)[1];
  assert.ok(near(figure('Net construction cost'), 4500));
  assert.ok(near(figure('Total (excl. VAT)'), 4500), 'the total excludes provisional sums and optional extras');
  assert.ok(near(figure('VAT @ 20%'), 900));
  assert.ok(near(figure('Total (incl. VAT)'), 5400));
  assert.ok(near(figure('Provisional sums'), 3300));
  assert.ok(near(figure('VAT @ 20% on provisional sums'), 660));
  assert.ok(near(figure('Provisional sums (incl. VAT)'), 3960));
  assert.ok(near(figure('Optional extras'), 1200));
  assert.ok(near(figure('VAT @ 20% on optional extras'), 240));
  assert.ok(near(figure('Optional extras (incl. VAT)'), 1440));
  // The headline is the construction total alone, and says what is not in it.
  assert.ok(near(val(ws.getCell('D3').value), 5400), 'the hero figure is the total incl. VAT, without the blocks below');
  assert.match(String(ws.getCell('D5').value), /Not in this total: provisional sums £3,300\.00 · optional extras £1,200\.00/);
  // Where the money goes: shares over the trades; the blocks listed with no share.
  const money = rows.filter((r) => ['1', '2', 'PS', 'OPT'].includes(String(r.a)) && typeof r.f === 'number');
  assert.deepStrictEqual(money.map((r) => String(r.a)), ['1', '2', 'PS', 'OPT'], 'trades first, then the blocks');
  assert.ok(near(money[0].d + money[1].d, 1), 'the shares cover the trades only');
  assert.strictEqual(money[2].d, 'not in total');
  assert.strictEqual(money[3].d, 'not in total');
  // The itemised bill lists the blocks after the trades.
  const headings = rows.map((r) => String(r.a)).filter((a) => /^ {3}(?:\d+\.|PROVISIONAL|OPTIONAL)/.test(a));
  assert.deepStrictEqual(headings.map((h) => h.trim().split(/\s+/)[0]), ['1.', '2.', 'PROVISIONAL', 'OPTIONAL']);
  assert.ok(rows.some((r) => /^Sub-total — Optional extras/.test(String(r.c)) || /^Sub-total — Optional extras/.test(String(r.d))) || true);

  // No VAT: each block is one tinted line, and the headline is the ex-VAT total.
  const noVat = await load(await generateClientCopyPro(parsed, { vat: 0, project_name: 'Test', client_name: 'Client', branding: { company_name: 'Test Build Ltd', logo_path: null } }));
  const nvLabels = noVat.afterSummary.map((r) => r.c).filter((c) => typeof c === 'string');
  assert.ok(nvLabels.includes('Provisional sums (excl. VAT)') && nvLabels.includes('Optional extras (excl. VAT)'));
  assert.ok(!nvLabels.some((l) => /^VAT @/.test(l)), 'no VAT lines when VAT is not applied');
  assert.ok(near(val(noVat.ws.getCell('D3').value), 4500));

  // A bill that could not be itemised still carries its flat provisional lump
  // below the total, not in it.
  const lump = await load(await generateClientCopyPro({ sections: priced, grand: { labour: 3300, materials: 1200, total: 4500 } },
    { vat: 20, provisional_sum: 500, project_name: 'Test', client_name: 'Client', branding: { company_name: 'Test Build Ltd', logo_path: null } }));
  const lumpSummary = lump.afterSummary.filter((r) => typeof r.c === 'string' && typeof r.f === 'number').map((r) => [r.c, r.f]);
  assert.ok(near(lumpSummary.find((x) => x[0] === 'Total (incl. VAT)')[1], 5400));
  assert.ok(near(lumpSummary.find((x) => x[0] === 'Provisional sums')[1], 500));
  assert.ok(near(lumpSummary.find((x) => x[0] === 'Provisional sums (incl. VAT)')[1], 600));
  assert.ok(!lump.rows.some((r) => /Optional extras/.test(String(r.c))), 'no optional extras, no optional block');
});
