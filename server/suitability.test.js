const { test } = require('node:test');
const assert = require('node:assert');
const { recommendTier, FEATURES, TIERS, TIER_ORDER } = require('./suitability');

// 2026-08 packaging: Sales & Marketing £99 / Unlimited £199 / Bundle £249
// (both packages, £49 off the pair).

test('the ladder is sales → unlimited → bundle with the agreed prices', () => {
  assert.deepStrictEqual(TIER_ORDER, ['sales', 'unlimited', 'bundle']);
  assert.strictEqual(TIERS.sales.monthly, 99);
  assert.strictEqual(TIERS.unlimited.monthly, 199);
  assert.strictEqual(TIERS.bundle.monthly, 249);
  assert.strictEqual(TIERS.sales.monthly + TIERS.unlimited.monthly - TIERS.bundle.monthly, 49);
});

test('win-the-work picks alone land on Sales & Marketing', () => {
  const r = recommendTier({ features: ['crm_leads', 'letters'], teamSize: 'solo', jobsPerMonth: 'adhoc' });
  assert.strictEqual(r.tier, 'sales');
  assert.deepStrictEqual(r.covered, ['crm_leads', 'letters']);
  assert.deepStrictEqual(r.uncovered, []);
});

test('job-running picks land on Unlimited', () => {
  const r = recommendTier({ features: ['documents', 'boq', 'materials'], teamSize: 'solo', jobsPerMonth: 'adhoc' });
  assert.strictEqual(r.tier, 'unlimited');
  assert.deepStrictEqual(r.covered, ['documents', 'boq', 'materials']);
  assert.deepStrictEqual(r.uncovered, []);
});

test('picking from both sides recommends the Bundle with everything covered', () => {
  const all = Object.keys(FEATURES); // "all of the above"
  const r = recommendTier({ features: all, teamSize: 'solo', jobsPerMonth: 'adhoc' });
  assert.strictEqual(r.tier, 'bundle');
  assert.deepStrictEqual(r.uncovered, []);
  assert.ok(r.covered.includes('crm_leads') && r.covered.includes('multi_site'));
});

test('pricing work regularly pulls the recommendation to Unlimited (or Bundle with sales picks)', () => {
  const jobsOnly = recommendTier({ features: [], teamSize: 'solo', jobsPerMonth: 's2_5' });
  assert.strictEqual(jobsOnly.tier, 'unlimited');
  const withSales = recommendTier({ features: ['crm_leads'], teamSize: 'solo', jobsPerMonth: 'monthly' });
  assert.strictEqual(withSales.tier, 'bundle');
});

test('a bigger team nudges towards Unlimited even with modest picks', () => {
  const r = recommendTier({ features: ['documents'], teamSize: 's11_25', jobsPerMonth: 'adhoc' });
  assert.strictEqual(r.tier, 'unlimited');
});

test('add-on features never drive the plan and are reported separately', () => {
  const r = recommendTier({ features: ['ai_call_handler'], teamSize: 'solo', jobsPerMonth: 'adhoc' });
  assert.strictEqual(r.tier, 'sales');
  assert.deepStrictEqual(r.addons, ['ai_call_handler']);
  assert.deepStrictEqual(r.covered, []);
});

test('unknown feature ids are ignored, unknown sizes default to sales', () => {
  const r = recommendTier({ features: ['made_up'], teamSize: 'nonsense', jobsPerMonth: undefined });
  assert.strictEqual(r.tier, 'sales');
  assert.deepStrictEqual(r.covered, []);
});

test('recommendation carries display label and monthly price', () => {
  const r = recommendTier({ features: ['boq'], teamSize: 'solo', jobsPerMonth: 'adhoc' });
  assert.strictEqual(r.label, 'Unlimited');
  assert.strictEqual(r.monthly, 199);
  const b = recommendTier({ features: ['boq', 'letters'], teamSize: 'solo', jobsPerMonth: 'adhoc' });
  assert.strictEqual(b.label, 'Bundle');
  assert.strictEqual(b.monthly, 249);
});
