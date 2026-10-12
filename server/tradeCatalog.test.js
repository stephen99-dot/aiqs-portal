// Tests for the trade catalogue behind the onboarding live search.
//
// What matters: typing a few characters finds the right trade (by name OR by
// what builders actually call it — "sparky", "chippy"), every trade yields a
// usable question set split into business and pricing sections, every trade
// gets a complete rate sheet (universal Labour and Preliminaries groups plus
// its own), and a trade we've never heard of still gets questions and the
// universal groups rather than dead-ending the flow.

const test = require('node:test');
const assert = require('node:assert');

const { TRADES, RATE_SHEETS, DEFAULT_DAY_RATE, searchTrades, findTrade, getQuestionsForTrade, getRateSheetForTrade, getRateItemsForTrade } = require('./tradeCatalog');
const { BASE_RATES } = require('./deterministicPricer');

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

test('questions are tagged by section, business first then pricing, ids unique', () => {
  const qs = getQuestionsForTrade('Plumber');
  assert.ok(qs.every(q => q.section === 'business' || q.section === 'pricing'), 'every question has a section');
  const firstPricing = qs.findIndex(q => q.section === 'pricing');
  assert.ok(firstPricing > 0);
  assert.ok(qs.slice(firstPricing).every(q => q.section === 'pricing'), 'pricing questions come after business ones');
  assert.strictEqual(new Set(qs.map(q => q.id)).size, qs.length, 'question ids repeat');
  // Specialisms and certifications sit on the business screen.
  assert.strictEqual(qs.find(q => q.id === 'specialisms').section, 'business');
  assert.strictEqual(qs.find(q => q.id === 'certifications').section, 'business');
});

test('the pricing screen asks how they price, their terms and the margins the pricer reads', () => {
  const ids = getQuestionsForTrade('Electrician').filter(q => q.section === 'pricing').map(q => q.id);
  for (const id of ['day_rate', 'pricing_basis', 'materials_supply', 'materials_markup_pct', 'ohp_pct', 'contingency_pct', 'payment_terms', 'deposit_pct', 'quote_includes', 'quote_validity', 'guarantee']) {
    assert.ok(ids.includes(id), 'pricing screen is missing ' + id);
  }
  // Percentages are never prefilled: a blank means nothing is added, which is
  // what the pricer assumes by default.
  const qs = getQuestionsForTrade('Electrician');
  for (const id of ['materials_markup_pct', 'ohp_pct', 'contingency_pct', 'deposit_pct']) {
    const q = qs.find(x => x.id === id);
    assert.strictEqual(q.type, 'number');
    assert.strictEqual(q.unit, '%');
    assert.strictEqual(q.default, undefined, id + ' must not be prefilled');
  }
  // Every pills question has at least two options.
  for (const q of qs) if (q.type === 'pills' || q.type === 'pills-multi') assert.ok(q.options.length >= 2, q.id);
});

test('a known trade gets its own certs and specialisms', () => {
  const qs = getQuestionsForTrade('Electrician');
  const certs = qs.find(q => q.id === 'certifications');
  assert.ok(certs.options.includes('NICEIC'));
  const spec = qs.find(q => q.id === 'specialisms');
  assert.ok(spec && spec.options.includes('Rewires'));
});

test('every trade has its own rate sheet and every row is complete', () => {
  const names = new Set(TRADES.map(t => t.name));
  for (const t of TRADES) assert.ok(RATE_SHEETS[t.name] && RATE_SHEETS[t.name].length > 0, t.name + ' has no rate sheet of its own');
  for (const [tradeName, groups] of Object.entries(RATE_SHEETS)) {
    assert.ok(names.has(tradeName), `rate sheet for unknown trade "${tradeName}"`);
    for (const g of groups) {
      assert.ok(g.key && g.title && Array.isArray(g.items) && g.items.length > 0, tradeName + ' has an empty or unnamed group: ' + JSON.stringify(g.title));
    }
  }
  for (const t of TRADES) {
    const items = getRateItemsForTrade(t.name);
    assert.ok(items.length >= 12, t.name + ' sheet is thin: ' + items.length + ' rows');
    const keys = new Set();
    for (const item of items) {
      assert.ok(item.key && item.label && item.unit && item.group, t.name + ' has an incomplete item: ' + JSON.stringify(item));
      assert.match(item.unit, /^(£\/\S+|%)$/, t.name + '/' + item.key + ' has an odd unit ' + item.unit);
      assert.ok(item.typical > 0, t.name + '/' + item.key + ' has no typical figure');
      assert.ok(!keys.has(item.key), t.name + ' repeats key ' + item.key);
      keys.add(item.key);
    }
  }
});

test('every trade gets the Labour group derived from its day rate; site trades get Preliminaries', () => {
  const sheet = getRateSheetForTrade('Electrician');
  assert.strictEqual(sheet[0].key, 'labour');
  assert.strictEqual(sheet[1].key, 'prelims');
  const hourly = sheet[0].items.find(i => i.key === 'hourly_rate');
  assert.strictEqual(hourly.typical, 45, 'electrician at £360/day is £45/hour');
  assert.strictEqual(hourly.category, 'labour');
  assert.strictEqual(hourly.scale, false, 'derived rows are flagged so the locale layer does not convert them twice');
  assert.ok(sheet[1].items.every(i => i.category === 'prelims'));
  assert.ok(sheet[1].items.some(i => i.key === 'skip_hire_8yd'));
  // Trade rows carry no category — they save under the trade's own slug.
  assert.ok(sheet.slice(2).every(g => g.items.every(i => !i.category)));
  // A different day rate (the Rand one) re-derives the labour figures.
  assert.strictEqual(getRateSheetForTrade('Electrician', { dayRate: 2000 })[0].items.find(i => i.key === 'hourly_rate').typical, 250);
});

test('office trades bill time, not site prelims', () => {
  const sheet = getRateSheetForTrade('qs');
  assert.strictEqual(sheet[0].title, 'Your time');
  assert.ok(sheet[0].items.some(i => i.key === 'hourly_rate'));
  assert.ok(!sheet.some(g => g.key === 'prelims'));
  assert.ok(getRateItemsForTrade('Architect / architectural services').some(i => i.unit === '%'), 'a fee as % of build cost');
});

test('rate sheets resolve through aliases; unknown trades get the universal groups only', () => {
  assert.ok(getRateItemsForTrade('sparky').some(i => i.key === 'rewire_3bed'));
  assert.ok(getRateItemsForTrade('Roofer').some(i => i.key === 'roof_tiles_interlocking'));
  const custom = getRateSheetForTrade('Thatcher');
  assert.deepStrictEqual(custom.map(g => g.key), ['labour', 'prelims']);
  assert.strictEqual(custom[0].items.find(i => i.key === 'hourly_rate').typical, DEFAULT_DAY_RATE / 8);
});

test('rows that reuse a base-library key match its unit family and sit inside the pricer sanity band', () => {
  // A client rate more than 5x or under 0.1x the base is rejected as corrupt,
  // so a reused key must mean the same thing: same unit family, similar money.
  const family = (u) => (/m²/.test(u) ? 'm2' : /m³/.test(u) ? 'm3' : /\/(lm|m)$/.test(u) ? 'm' : /(Nr|Item|job|door|window|room|item|skip|pane|unit|post)/i.test(u) ? 'each' : u);
  let reused = 0;
  for (const t of TRADES) {
    for (const it of getRateItemsForTrade(t.name)) {
      const base = BASE_RATES[it.key];
      if (!base) continue;
      reused++;
      const ratio = it.typical / base.rate;
      assert.ok(ratio >= 0.25 && ratio <= 4, `${t.name}/${it.key}: typical ${it.typical} vs base ${base.rate}`);
      assert.strictEqual(family(it.unit), family(base.unit), `${t.name}/${it.key}: unit ${it.unit} vs base ${base.unit}`);
    }
  }
  assert.ok(reused >= 20, 'expected a good number of rows to feed the pricer directly, got ' + reused);
});

test('an unknown custom trade still gets the common questions', () => {
  const qs = getQuestionsForTrade('Thatcher');
  assert.ok(qs.some(q => q.id === 'years_trading'));
  assert.ok(qs.some(q => q.id === 'day_rate'));
  assert.ok(qs.some(q => q.id === 'pricing_basis'));
  const certs = qs.find(q => q.id === 'certifications');
  assert.ok(certs.options.includes('Public liability insurance'));
  assert.ok(!qs.some(q => q.id === 'specialisms'), 'unknown trades have no specialism list to offer');
});
