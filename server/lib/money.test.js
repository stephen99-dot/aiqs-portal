const test = require('node:test');
const assert = require('node:assert/strict');
const { num, round2, computeFinancials, cisDeduction, netFromLines } = require('./money');

test('round2 rounds to two places', () => {
  assert.equal(round2(1.234), 1.23);
  assert.equal(round2(1.236), 1.24);
  assert.equal(round2(1000 / 3), 333.33);
  assert.equal(round2('12.5'), 12.5);
  assert.equal(round2(undefined), 0);
});

test('num coerces safely', () => {
  assert.equal(num('42'), 42);
  assert.equal(num('not a number', 7), 7);
  assert.equal(num(null), 0);
});

test('computeFinancials applies the cascade correctly', () => {
  const r = computeFinancials(1000, { ohp_pct: 15, contingency_pct: 5, vat_pct: 20 });
  assert.equal(r.net_total, 1000);
  assert.equal(r.ohp_amount, 150);              // 1000 * 15%
  assert.equal(r.contingency_amount, 57.5);     // (1000+150) * 5%
  assert.equal(r.vat_amount, 241.5);            // 1207.5 * 20%
  assert.equal(r.grand_total, 1449);            // 1207.5 + 241.5
  assert.equal(r.margin_pct, 13.04);            // 150 / 1150
});

test('computeFinancials with no percentages is a pass-through', () => {
  const r = computeFinancials(500);
  assert.equal(r.net_total, 500);
  assert.equal(r.grand_total, 500);
  assert.equal(r.margin_pct, 0);
});

test('computeFinancials handles zero / garbage net', () => {
  assert.equal(computeFinancials(0, { ohp_pct: 15, vat_pct: 20 }).grand_total, 0);
  assert.equal(computeFinancials('oops', { vat_pct: 20 }).grand_total, 0);
});

test('VAT only (e.g. reverse-charge off)', () => {
  const r = computeFinancials(2000, { vat_pct: 20 });
  assert.equal(r.vat_amount, 400);
  assert.equal(r.grand_total, 2400);
});

test('cisDeduction is taken from labour only', () => {
  assert.equal(cisDeduction(1000, 20), 200);
  assert.equal(cisDeduction(0, 20), 0);
  assert.equal(cisDeduction(1234.56, 30), 370.37);
});

test('netFromLines sums qty x rate', () => {
  assert.equal(netFromLines([{ qty: 2, rate: 10 }, { qty: 3, rate: 5 }]), 35);
  assert.equal(netFromLines([{ qty: '4', rate: '2.5' }]), 10);
  assert.equal(netFromLines([]), 0);
  assert.equal(netFromLines(null), 0);
});
