// The scale gate — brief §15 acceptance test 1: Atlas must refuse to record a
// takeoff item before prove_scale has returned two independent proofs.
const test = require('node:test');
const assert = require('node:assert');
const { checkScaleGate } = require('./agent');

test('refuses to record anything before the scale is proven', () => {
  const g = checkScaleGate({ evidenceAvailable: true, scaleProofs: {} });
  assert.strictEqual(g.ok, false);
  assert.match(g.message, /^REFUSED/);
  assert.match(g.message, /TWO independent/);
  assert.match(g.message, /opinion, not a measurement/);
});

test('still refuses when only one proof was supplied', () => {
  const g = checkScaleGate({
    evidenceAvailable: true,
    scaleProofs: { 'plan.pdf': { usable: false, verdict: 'ONE PROOF ONLY (figured dimensions). The rule is two independent proofs per sheet.' } },
  });
  assert.strictEqual(g.ok, false);
  assert.match(g.message, /not yet settled/);
  assert.match(g.message, /ONE PROOF ONLY/);
  assert.match(g.message, /second, independent proof/);
});

test('a pack that cannot be proven is told to produce no BOQ', () => {
  const g = checkScaleGate({
    evidenceAvailable: true,
    scaleProofs: { 'scan.pdf': { usable: false, verdict: 'NO PROOF. Nothing on this sheet establishes its scale.' } },
  });
  assert.strictEqual(g.ok, false);
  assert.match(g.message, /no BOQ, not an estimate/);
});

test('allows recording once a sheet is settled', () => {
  const g = checkScaleGate({
    evidenceAvailable: true,
    scaleProofs: { 'plan.pdf': { usable: true, verdict: '2 independent proofs agree to 0.04%.' } },
  });
  assert.strictEqual(g.ok, true);
});

test('one settled sheet is enough even when another is still unproven', () => {
  const g = checkScaleGate({
    evidenceAvailable: true,
    scaleProofs: {
      'plan.pdf': { usable: true, verdict: 'settled' },
      'elevation.pdf': { usable: false, verdict: 'ONE PROOF ONLY' },
    },
  });
  assert.strictEqual(g.ok, true);
});

// The safety property: a portal running WITHOUT the sidecar must never be
// blocked. A missing evidence layer lowers confidence; it does not stop work.
test('does not block when the evidence layer was never reachable', () => {
  const never = checkScaleGate({ evidenceAvailable: null, scaleProofs: {} });
  assert.strictEqual(never.ok, true);
  assert.strictEqual(never.visualOnly, true);

  const down = checkScaleGate({ evidenceAvailable: false, scaleProofs: {} });
  assert.strictEqual(down.ok, true);
  assert.strictEqual(down.visualOnly, true);
});

test('an empty run state is safe rather than crashing', () => {
  assert.strictEqual(checkScaleGate({}).ok, true);
});
