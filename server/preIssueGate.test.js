const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { runPreIssueGate } = require('./preIssueGate');
const { generateBOQExcel } = require('./boqGenerator');

const SECTIONS = [
  { title: 'Substructure', items: [
    { item: '1.01', description: 'Machine excavate trench foundation', unit: 'm3', qty: 24.5, rate: 88, labour: 1300, materials: 856, total: 2156 },
    { item: '1.02', description: 'Concrete C25 to trench', unit: 'm3', qty: 18.2, rate: 195, labour: 1100, materials: 2449, total: 3549 },
  ] },
  { title: 'Superstructure', items: [
    { item: '2.01', description: 'Facing brickwork half brick', unit: 'm2', qty: 96, rate: 142, labour: 6800, materials: 6832, total: 13632 },
  ] },
];

// Build a minimal workbook so each defect can be provoked in isolation.
async function buildSheet(mutate) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BOQ', {
    pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' },
  });
  ws.getRow(1).values = ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Labour', 'Materials', 'Total'];
  const r = ws.getRow(2);
  r.getCell(1).value = '1.01';
  r.getCell(2).value = 'Excavate trench';
  r.getCell(3).value = 'm3';
  r.getCell(4).value = 10;
  r.getCell(5).value = 100;
  r.getCell(6).value = 600;
  r.getCell(7).value = 400;
  r.getCell(8).value = 1000;
  const sub = ws.getRow(3);
  sub.getCell(2).value = 'SUB-TOTAL';
  sub.getCell(8).value = { formula: 'SUM(H2:H2)', result: 1000 };
  if (mutate) mutate(ws);
  return wb.xlsx.writeBuffer();
}

test('passes a well-formed bill', async () => {
  const buf = await buildSheet();
  const report = await runPreIssueGate(buf);
  assert.strictEqual(report.blocking, false, report.errors.join('; '));
});

test('blocks a formula with no cached value (the previewer defect)', async () => {
  const buf = await buildSheet((ws) => {
    ws.getRow(3).getCell(8).value = { formula: 'SUM(H2:H2)' };
  });
  const report = await runPreIssueGate(buf);
  assert.ok(report.blocking);
  assert.ok(report.errors.some((e) => /no cached value/.test(e)));
  assert.strictEqual(report.stats.uncachedFormulas, 1);
});

test('blocks a priced line whose Labour + Materials misses the Total', async () => {
  const buf = await buildSheet((ws) => { ws.getRow(2).getCell(6).value = 500; });
  const report = await runPreIssueGate(buf);
  assert.ok(report.blocking);
  assert.ok(report.errors.some((e) => /does not equal Total/.test(e)));
});

test('blocks a zero total on a priced line', async () => {
  const buf = await buildSheet((ws) => {
    ws.getRow(2).getCell(6).value = 0;
    ws.getRow(2).getCell(7).value = 0;
    ws.getRow(2).getCell(8).value = 0;
  });
  const report = await runPreIssueGate(buf);
  assert.ok(report.blocking);
  assert.ok(report.errors.some((e) => /blank or zero Total/.test(e)));
});

test('blocks a summary row that lost its label to a merge', async () => {
  const buf = await buildSheet((ws) => { ws.getRow(3).getCell(2).value = null; });
  const report = await runPreIssueGate(buf);
  assert.ok(report.blocking);
  assert.ok(report.errors.some((e) => /no label/.test(e)));
});

test('blocks a literal %% in a client-facing cell', async () => {
  const buf = await buildSheet((ws) => { ws.getRow(3).getCell(2).value = 'Contingency at 5.0%%'; });
  const report = await runPreIssueGate(buf);
  assert.ok(report.blocking);
  assert.ok(report.errors.some((e) => /%%/.test(e)));
});

test('blocks internal-process wording reaching the client', async () => {
  const buf = await buildSheet((ws) => { ws.getRow(3).getCell(2).value = 'SUB-TOTAL (first pass)'; });
  const report = await runPreIssueGate(buf);
  assert.ok(report.blocking);
  assert.ok(report.errors.some((e) => /internal-process wording/.test(e)));
});

test('blocks the fitToHeight print-scale collapse', async () => {
  const buf = await buildSheet((ws) => { ws.pageSetup.fitToHeight = 1; });
  const report = await runPreIssueGate(buf);
  assert.ok(report.blocking);
  assert.ok(report.errors.some((e) => /fitToHeight/.test(e)));
});

test('blocks frozen panes (house format rule)', async () => {
  const buf = await buildSheet((ws) => { ws.views = [{ state: 'frozen', ySplit: 1 }]; });
  const report = await runPreIssueGate(buf);
  assert.ok(report.blocking);
  assert.ok(report.errors.some((e) => /frozen panes/.test(e)));
});

test('a real generated BOQ passes the gate end to end', async () => {
  const buf = await generateBOQExcel(SECTIONS, 'Gate Test', 'Test Client', {
    contingency_pct: 5, ohp_pct: 10, vat_rate: 20,
  });
  const report = await runPreIssueGate(buf);
  assert.strictEqual(report.blocking, false, report.errors.join('; '));
  assert.ok(report.stats.formulaCells > 0, 'expected the bill to carry formulas');
  assert.strictEqual(report.stats.uncachedFormulas, 0);
});
