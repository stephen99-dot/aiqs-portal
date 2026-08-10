const { test } = require('node:test');
const assert = require('node:assert');
const { recommendTier, FEATURES, TIERS } = require('./suitability');

test('sole trader with entry features stays on Platform', () => {
  const r = recommendTier({ features: ['documents', 'boq', 'materials'], teamSize: 'solo', jobsPerMonth: 'adhoc' });
  assert.strictEqual(r.tier, 'platform');
  assert.deepStrictEqual(r.covered, ['documents', 'boq', 'materials']);
  assert.deepStrictEqual(r.uncovered, []);
});

test('trade-level features pull a sole trader up one tier', () => {
  const r = recommendTier({ features: ['valuations', 'cost_tracking'], teamSize: 'solo', jobsPerMonth: 'adhoc' });
  assert.strictEqual(r.tier, 'trade');
});

test('features never pull more than one tier above business size', () => {
  const all = Object.keys(FEATURES); // "all of the above", incl. multi_site (contractor)
  const solo = recommendTier({ features: all, teamSize: 'solo', jobsPerMonth: 'adhoc' });
  assert.strictEqual(solo.tier, 'trade');
  assert.ok(solo.uncovered.includes('client_signoff'));
  assert.ok(solo.uncovered.includes('multi_site'));
});

test('size sets the floor even with modest feature picks', () => {
  const r = recommendTier({ features: ['documents'], teamSize: 's11_25', jobsPerMonth: 'adhoc' });
  assert.strictEqual(r.tier, 'builder');
});

test('jobs-per-month alone can set the base tier', () => {
  const r = recommendTier({ features: ['boq'], teamSize: 'solo', jobsPerMonth: 's2_5' });
  assert.strictEqual(r.tier, 'builder');
});

test('big multi-site firm picking everything lands on Contractor with all covered', () => {
  const all = Object.keys(FEATURES);
  const r = recommendTier({ features: all, teamSize: 's26plus', jobsPerMonth: 's6plus' });
  assert.strictEqual(r.tier, 'contractor');
  assert.deepStrictEqual(r.uncovered, []);
  assert.deepStrictEqual(r.addons, ['ai_call_handler']);
});

test('add-on features never drive the tier and are reported separately', () => {
  const r = recommendTier({ features: ['ai_call_handler'], teamSize: 'solo', jobsPerMonth: 'adhoc' });
  assert.strictEqual(r.tier, 'platform');
  assert.deepStrictEqual(r.addons, ['ai_call_handler']);
  assert.deepStrictEqual(r.covered, []);
});

test('unknown feature ids are ignored, unknown sizes default to platform', () => {
  const r = recommendTier({ features: ['nonsense', 'documents'], teamSize: 'weird', jobsPerMonth: undefined });
  assert.strictEqual(r.tier, 'platform');
  assert.deepStrictEqual(r.covered, ['documents']);
});

test('recommendation carries display label and monthly price', () => {
  const r = recommendTier({ features: ['valuations'], teamSize: 's2_10', jobsPerMonth: 'monthly' });
  assert.strictEqual(r.tier, 'trade');
  assert.strictEqual(r.label, TIERS.trade.label);
  assert.strictEqual(r.monthly, 149);
});
