const test = require('node:test');
const assert = require('node:assert');
const { pageInventory, evidenceConfidence } = require('./evidenceClient');

test('an absent sidecar degrades instead of throwing', async () => {
  const prev = process.env.EVIDENCE_URL;
  process.env.EVIDENCE_URL = 'http://127.0.0.1:9';   // nothing listening
  delete require.cache[require.resolve('./evidenceClient')];
  const client = require('./evidenceClient');
  const r = await client.pageInventory('/tmp/whatever.pdf');
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.ok, false);
  if (prev === undefined) delete process.env.EVIDENCE_URL; else process.env.EVIDENCE_URL = prev;
  delete require.cache[require.resolve('./evidenceClient')];
});

test('without the evidence layer a takeoff is declared visual, not proven', () => {
  const c = evidenceConfidence({ available: false }, null);
  assert.strictEqual(c.level, 'visual_only');
  assert.match(c.note, /estimates, not proven measurements/);
});

test('an unproven scale is provisional even when the sidecar ran', () => {
  const c = evidenceConfidence({ available: true }, { usable: false, verdict: 'ONE PROOF ONLY (figured dimensions).' });
  assert.strictEqual(c.level, 'unproven_scale');
  assert.match(c.note, /ONE PROOF ONLY/);
});

test('a settled scale reports as proven', () => {
  const c = evidenceConfidence({ available: true }, { usable: true, verdict: '2 independent proofs agree to 0.04%.' });
  assert.strictEqual(c.level, 'proven');
});

test('pageInventory is exported and callable', () => {
  assert.strictEqual(typeof pageInventory, 'function');
});
