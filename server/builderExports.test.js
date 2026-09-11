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

let ExcelJS, generateBOQExcel, parseBOQ, sniffBOQ, reconcileParsed, isTotalRowItem;
let DEPS_OK = true;
try {
  ExcelJS = require('exceljs');
  ({ generateBOQExcel } = require('./boqGenerator'));
  ({ parseBOQ, sniffBOQ, reconcileParsed, isTotalRowItem } = require('./builderExports'));
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
