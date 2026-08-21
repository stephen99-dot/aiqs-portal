// Tests for the trade catalogue behind the onboarding live search.
//
// What matters: typing a few characters finds the right trade (by name OR by
// what builders actually call it — "sparky", "chippy"), every trade yields a
// usable question set, and a trade we've never heard of still gets questions
// rather than dead-ending the flow.

const test = require('node:test');
const assert = require('node:assert');

const { TRADES, searchTrades, findTrade, getQuestionsForTrade } = require('./tradeCatalog');

test('search matches on name prefix first', () => {
  const results = searchTrades('plu');
  assert.strictEqual(results[0], 'Plumber');
});

test('search matches aliases — the words builders actually type', () => {
  assert.ok(searchTrades('sparky').includes('Electrician'));
  assert.ok(searchTrades('chippy').includes('Carpenter / joiner'));
  assert.ok(searchTrades('qs').includes('Quantity surveyor / estimator'));
});

test('search is case-insensitive and copes with substrings', () => {
  assert.ok(searchTrades('ROOF').includes('Roofer'));
  assert.ok(searchTrades('heat').includes('Heating engineer'));
});

test('empty query returns a starter list, capped at the limit', () => {
  assert.strictEqual(searchTrades('').length, 8);
  assert.strictEqual(searchTrades('e', 3).length, 3);
});

test('gibberish returns no matches', () => {
  assert.deepStrictEqual(searchTrades('zzzqqq'), []);
});

test('findTrade resolves exact names and exact aliases, not fragments', () => {
  assert.strictEqual(findTrade('Electrician').name, 'Electrician');
  assert.strictEqual(findTrade('sparky').name, 'Electrician');
  assert.strictEqual(findTrade('elec'), null);
});

test('every catalogue trade produces a question set with a day rate', () => {
  for (const t of TRADES) {
    const qs = getQuestionsForTrade(t.name);
    const dayRate = qs.find(q => q.id === 'day_rate');
    assert.ok(dayRate, t.name + ' is missing a day_rate question');
    assert.ok(dayRate.default > 0, t.name + ' has no prefilled day rate');
    assert.ok(qs.some(q => q.id === 'certifications'), t.name + ' is missing certifications');
  }
});

test('a known trade gets its own certs and specialisms', () => {
  const qs = getQuestionsForTrade('Electrician');
  const certs = qs.find(q => q.id === 'certifications');
  assert.ok(certs.options.includes('NICEIC'));
  const spec = qs.find(q => q.id === 'specialisms');
  assert.ok(spec && spec.options.includes('Rewires'));
});

test('an unknown custom trade still gets the common questions', () => {
  const qs = getQuestionsForTrade('Thatcher');
  assert.ok(qs.some(q => q.id === 'years_trading'));
  assert.ok(qs.some(q => q.id === 'day_rate'));
  const certs = qs.find(q => q.id === 'certifications');
  assert.ok(certs.options.includes('Public liability insurance'));
  assert.ok(!qs.some(q => q.id === 'specialisms'), 'unknown trades have no specialism list to offer');
});
