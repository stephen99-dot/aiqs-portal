// The client copy with section totals only: one priced row per section and
// nothing underneath, the same bottom line as the full breakdown.
const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { generateClientCopyPro } = require('./builderExports');

const PARSED = {
  sections: [
    { number: '1', title: 'Preliminaries', items: [
      { itemRef: '1.1', description: 'Site set-up', unit: 'item', qty: 1, labour: 800, materials: 200, total: 1000 },
      { itemRef: '1.2', description: 'Skips', unit: 'no', qty: 4, labour: 0, materials: 1200, total: 1200 },
    ] },
    { number: '2', title: 'Groundworks', items: [
      { itemRef: '2.1', description: 'Excavate foundations', unit: 'm³', qty: 12.5, labour: 900, materials: 350, total: 1250 },
    ] },
  ],
};

async function sheetText(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Client Copy');
  const cells = [];
  ws.eachRow((row) => row.eachCell((cell) => {
    const v = cell.value;
    const text = v && typeof v === 'object' ? (v.richText ? v.richText.map((r) => r.text).join('') : v.result != null ? v.result : v.formula || '') : v;
    cells.push({ addr: cell.address, text: String(text == null ? '' : text), raw: v });
  }));
  return cells;
}
// Merged ranges report their text once per cell, so matches are counted by row.
const find = (cells, re) => { const rows = new Set(); return cells.filter((c) => { if (!re.test(c.text)) return false; const r = c.addr.replace(/[A-Z]+/, ''); if (rows.has(r)) return false; rows.add(r); return true; }); };
const totalInclVat = (cells) => {
  const label = find(cells, /total \(incl\. vat\)/i)[0];
  assert.ok(label, 'the summary names the total incl. VAT');
  const rowNo = label.addr.replace(/[A-Z]+/, '');
  const amount = cells.find((c) => c.addr === 'F' + rowNo);
  const v = amount.raw && typeof amount.raw === 'object' ? amount.raw.result : amount.raw;
  return Math.round(Number(v) * 100) / 100;
};

test('section totals only: no line items, one row per section, the same total', async () => {
  const opts = { vat: 20, overhead_pct: 10, profit_pct: 5, rounding: 0, project_name: 'Test', client_name: 'Client', branding: { company_name: 'Test Build Ltd' } };
  const full = await sheetText(await generateClientCopyPro(PARSED, { ...opts, detail: 'full' }));
  const sections = await sheetText(await generateClientCopyPro(PARSED, { ...opts, detail: 'sections' }));

  assert.ok(find(full, /Excavate foundations/).length === 1 && find(full, /Site set-up/).length === 1, 'the full copy lists every item');
  assert.equal(find(sections, /Excavate foundations|Site set-up|Skips/).length, 0, 'the sections copy lists no items');
  assert.equal(find(sections, /PRICED SUMMARY/).length, 1, 'and says so in the masthead');
  assert.equal(find(full, /BILL OF QUANTITIES/).length, 1);
  assert.equal(find(sections, /all work in this section/i).length, 2, 'one priced row per section');
  assert.equal(find(sections, /2 sections, priced as totals/).length, 1);
  assert.ok(find(full, /3 items in 2 trades/).length === 1);

  assert.equal(totalInclVat(sections), totalInclVat(full), 'the bottom line does not move');
  assert.equal(totalInclVat(full), Math.round(3450 * 1.1 * 1.05 * 1.2 * 100) / 100);
});
