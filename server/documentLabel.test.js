const test = require('node:test');
const assert = require('node:assert');
const { Writable } = require('node:stream');
const { docLabel, DOCUMENT_LABELS } = require('./documentLabel');
const { streamQuotePdf } = require('./quotePdf');

test('defaults to "quote" for an account that has never chosen', () => {
  assert.strictEqual(docLabel(null).noun, 'quote');
  assert.strictEqual(docLabel({}).noun, 'quote');
  assert.strictEqual(docLabel({ document_label: null }).Noun, 'Quote');
  // A value that isn't one of ours must not reach a document.
  assert.strictEqual(docLabel({ document_label: 'invoice' }).noun, 'quote');
});

test('reads the builder\'s choice, however it is cased', () => {
  assert.strictEqual(docLabel({ document_label: 'estimate' }).noun, 'estimate');
  assert.strictEqual(docLabel({ document_label: 'Estimate' }).Noun, 'Estimate');
  assert.strictEqual(docLabel('estimate').Formal, 'Estimate');
  // "Quotation" has no estimate equivalent — an estimate is just an estimate.
  assert.strictEqual(docLabel({ document_label: 'estimate' }).formal, 'estimate');
  assert.strictEqual(docLabel({ document_label: 'quote' }).formal, 'quotation');
});

test('every offered label is one the PDF can render', async () => {
  const q = {
    quote_number: 'Q-20260828-1234', project_name: 'Rear extension',
    project_type: 'Single-storey extension', currency: 'GBP',
    net_total: 1000, ohp_pct: 0, ohp_amount: 0,
    contingency_pct: 0, contingency_amount: 0, vat_pct: 20, vat_amount: 200,
    grand_total: 1200, status: 'sent', created_at: '2026-08-28T09:00:00Z',
  };
  const lines = [{ section: '1 — Groundwork', description: 'Excavate', unit: 'm3', qty: 10, rate: 100, line_total: 1000 }];
  for (const key of DOCUMENT_LABELS) {
    const chunks = [];
    const res = new Writable({ write(c, e, cb) { chunks.push(c); cb(); } });
    res.setHeader = () => {};
    const done = new Promise((resolve, reject) => { res.on('finish', resolve); res.on('error', reject); });
    streamQuotePdf(res, q, lines, { document_label: key }, { email: 'builder@example.com' }, null);
    await done;
    assert.ok(Buffer.concat(chunks).length > 0, key + ' produced no PDF bytes');
  }
});
