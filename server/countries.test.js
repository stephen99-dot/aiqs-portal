// Tests for per-country pricing: the South Africa rates library, how a job
// decides its country, and the onboarding reset used to redo a UK-adapted
// onboarding.
//
// In-memory database throughout — never the developer's data/ database.

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

const countries = require('./lib/countries');
const { priceLockedQuantities, BASE_RATES } = require('./deterministicPricer');
const { resetOnboarding } = require('./onboardingReset');
const { localiseQuestions, localiseRateItems } = require('./onboardingLocale');
const tradeCatalog = require('./tradeCatalog');

const ZA_USER = { country: 'ZA', region: null };
const price = (items, location, user, opts = {}) =>
  priceLockedQuantities(items.map((i) => ({ ...i })), location, {}, { ...opts, ...countries.pricingOptions(user, location) });

// ── The library itself ─────────────────────────────────────────────────────

test('the SA library loads with Gauteng as the 1.00 base region', () => {
  const lib = countries.zaLibrary();
  assert.strictEqual(lib.currency, 'ZAR');
  assert.strictEqual(lib.vatPct, 15);
  assert.ok(lib.rates.length > 250, 'expected the full rate sheet');
  const base = lib.regions.find((r) => r.isBase);
  assert.match(base.name, /^Gauteng/);
  assert.strictEqual(base.factor, 1);
});

test('sell rates are NET plus the library margin, as column T of the workbook', () => {
  const lib = countries.zaLibrary();
  const pr01 = lib.byCode.PR01;
  assert.strictEqual(pr01.sell, Math.round(pr01.net * (1 + lib.marginPct / 100) * 100) / 100);
  assert.strictEqual(pr01.sell, 12109.2); // T6 in SA-RL-2609-01
});

test('every UK→SA mapping names a real UK key and a real SA code', () => {
  const lib = countries.zaLibrary();
  for (const [key, m] of Object.entries(lib.ukKeyMap)) {
    assert.ok(BASE_RATES[key], `unknown UK key ${key}`);
    for (const p of (m.codes || [{ code: m.code }])) assert.ok(lib.byCode[p.code], `${key}: unknown SA code ${p.code}`);
  }
});

// The parity factor prices every UK key the SA library has no equivalent for.
// It must stay the median SA/UK ratio of the mapped pairs — if a library
// update moves that median, this fails and the constant needs re-calibrating.
test('the GBP→ZAR cost-parity factor matches the median of the mapped pairs', () => {
  const lib = countries.zaLibrary();
  const ratios = Object.keys(lib.ukKeyMap).map((k) => countries.zaRateForUkKey(k).rate / BASE_RATES[k].rate).sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)];
  const drift = Math.abs(median - countries.ZA_GBP_PARITY) / countries.ZA_GBP_PARITY;
  assert.ok(drift < 0.1, `median ${median.toFixed(2)} vs ZA_GBP_PARITY ${countries.ZA_GBP_PARITY}`);
});

// ── Pricing a South African job ────────────────────────────────────────────

const mappedKey = Object.keys(countries.zaLibrary().ukKeyMap).find((k) => BASE_RATES[k].unit === 'm²');
const unmappedKey = Object.keys(BASE_RATES).find((k) => !countries.zaLibrary().ukKeyMap[k] && BASE_RATES[k].unit === 'm²');

test('a South African account prices in Rand at 15% VAT', () => {
  const r = price([{ key: mappedKey, qty: 10, unit: 'm²', section: 'A' }], 'Sandton', ZA_USER);
  assert.strictEqual(r.summary.currency, 'ZAR');
  assert.strictEqual(r.summary.vat_rate, 15);
  assert.strictEqual(r.summary.country, 'ZA');
});

test('a mapped key is priced from the SA library, an unmapped one at parity', () => {
  const r = price([
    { key: mappedKey, qty: 1, unit: 'm²', section: 'A' },
    { key: unmappedKey, qty: 1, unit: 'm²', section: 'A' },
  ], 'Pretoria', ZA_USER);
  const items = r.sections.flatMap((s) => s.items);
  const sa = countries.zaRateForUkKey(mappedKey).rate;
  assert.strictEqual(items.find((i) => i.key === mappedKey).rate, Math.round(sa * 100) / 100);
  assert.strictEqual(items.find((i) => i.key === unmappedKey).rate, Math.round(BASE_RATES[unmappedKey].rate * countries.ZA_GBP_PARITY * 100) / 100);
});

test('the job address sets the SA region factor (Cape Town 1.08)', () => {
  const jhb = price([{ key: mappedKey, qty: 1, unit: 'm²', section: 'A' }], 'Johannesburg', ZA_USER);
  const cpt = price([{ key: mappedKey, qty: 1, unit: 'm²', section: 'A' }], 'Cape Town', ZA_USER);
  const rate = (r) => r.sections[0].items[0].rate;
  assert.ok(Math.abs(rate(cpt) / rate(jhb) - 1.08) < 0.001);
  assert.match(cpt.location.label, /Cape Town/);
});

test('the account region applies when the address names no SA place', () => {
  const r = price([{ key: mappedKey, qty: 1, unit: 'm²', section: 'A' }], '12 Main Road', { country: 'ZA', region: 'Western Cape - Cape Town metro & Winelands' });
  assert.match(r.location.label, /Cape Town/);
});

test('a South African address prices in Rand even on a UK account', () => {
  const r = price([{ key: mappedKey, qty: 1, unit: 'm²', section: 'A' }], 'Umhlanga Rocks, Durban', { country: 'GB' });
  assert.strictEqual(r.summary.currency, 'ZAR');
});

test('a UK postcode still prices in pounds on a South African account', () => {
  const r = price([{ key: mappedKey, qty: 1, unit: 'm²', section: 'A' }], '1 Park Row, Leeds LS1 5AB', ZA_USER);
  assert.strictEqual(r.summary.currency, 'GBP');
  assert.strictEqual(r.summary.vat_rate, 20);
});

test('an SA town that contains an Irish county name is not priced as Ireland', () => {
  // 'clare' is in Clarens — the Irish place list matches substrings.
  const r = price([{ key: mappedKey, qty: 1, unit: 'm²', section: 'A' }], 'Clarens', ZA_USER);
  assert.strictEqual(r.summary.currency, 'ZAR');
});

test('UK place names that are also SA ones stay UK on a UK account', () => {
  for (const loc of ['East London', 'George Street, Edinburgh', 'Kimberley, Nottingham']) {
    assert.strictEqual(countries.detectCountryFromLocation(loc), null, loc);
    const r = price([{ key: mappedKey, qty: 1, unit: 'm²', section: 'A' }], loc, { country: 'GB' });
    assert.strictEqual(r.summary.currency, 'GBP', loc);
  }
});

test('UK and unset accounts are priced exactly as before', () => {
  const items = [{ key: mappedKey, qty: 3, unit: 'm²', section: 'A' }];
  const plain = priceLockedQuantities(items.map((i) => ({ ...i })), 'Manchester', {}, {});
  for (const user of [null, { country: null }, { country: 'GB' }, { country: 'OTHER', country_name: 'Kenya' }]) {
    const r = price(items, 'Manchester', user);
    assert.strictEqual(r.summary.grand_total, plain.summary.grand_total);
    assert.strictEqual(r.summary.currency, 'GBP');
  }
});

// ── Country input + prompt ─────────────────────────────────────────────────

test('country input is validated', () => {
  assert.ok(countries.validateCountryInput({ country: 'XX' }).error);
  assert.ok(countries.validateCountryInput({ country: 'OTHER' }).error, 'other needs a name');
  assert.ok(countries.validateCountryInput({ country: 'ZA', region: 'Atlantis' }).error);
  assert.deepStrictEqual(countries.validateCountryInput({ country: 'za', region: 'Limpopo - Polokwane' }), { country: 'ZA', region: 'Limpopo - Polokwane', countryName: null });
  assert.strictEqual(countries.validateCountryInput({ country: 'GB', region: 'London' }).region, null);
});

test('the assistant is told about South Africa, and UK users see no change', () => {
  assert.strictEqual(countries.promptBlock({ country: 'GB' }), '');
  assert.strictEqual(countries.promptBlock({ country: null }), '');
  const za = countries.promptBlock({ country: 'ZA', region: 'Gauteng (Johannesburg / Pretoria / Midrand)' });
  assert.match(za, /South African Rand/);
  assert.match(za, /15%/);
  assert.match(za, /SA-RL-2609-01/);
});

test('onboarding asks a South African builder in Rand with SA certifications', () => {
  const qs = localiseQuestions(tradeCatalog.getQuestionsForTrade('Electrician'), 'Electrician', ZA_USER);
  const day = qs.find((q) => q.id === 'day_rate');
  assert.strictEqual(day.unit, 'R/day');
  assert.ok(day.default > 1000, 'SA electrician day rate in Rand');
  assert.ok(qs.find((q) => q.id === 'certifications').options.includes('NHBRC registered'));
  assert.ok(!qs.find((q) => q.id === 'certifications').options.includes('NICEIC'));
  assert.ok(qs.find((q) => q.id === 'typical_job_value').options.every((o) => !o.includes('£')));
  const items = localiseRateItems(tradeCatalog.getRateItemsForTrade('Flooring installer'), ZA_USER);
  assert.ok(items.every((i) => i.unit.startsWith('R/')));
  // UK accounts: untouched
  assert.deepStrictEqual(localiseQuestions(tradeCatalog.getQuestionsForTrade('Electrician'), 'Electrician', { country: 'GB' }), tradeCatalog.getQuestionsForTrade('Electrician'));
});

// ── Onboarding reset ───────────────────────────────────────────────────────

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, country TEXT, region TEXT, country_name TEXT,
      onboarding_completed_at DATETIME, onboarding_skipped INTEGER DEFAULT 0, onboarding_reset_at DATETIME, updated_at DATETIME);
    CREATE TABLE user_memories (id TEXT PRIMARY KEY, user_id TEXT, content TEXT, source TEXT, is_active INTEGER DEFAULT 1, updated_at DATETIME);
    CREATE TABLE client_rate_library (id TEXT PRIMARY KEY, user_id TEXT, item_key TEXT, value REAL, unit TEXT, is_active INTEGER DEFAULT 1, updated_at DATETIME);
  `);
  return db;
}

test('reset sends a South African client back through onboarding and sets aside their £ rates', () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id, email, country, onboarding_completed_at) VALUES ('u1', 'a@b.co.za', 'ZA', CURRENT_TIMESTAMP)").run();
  db.prepare("INSERT INTO user_memories (id, user_id, content, source) VALUES ('m1','u1','Typical job value: £5k – £25k','onboarding'), ('m2','u1','Prefers face brick','chat')").run();
  db.prepare("INSERT INTO client_rate_library (id, user_id, item_key, value, unit) VALUES ('r1','u1','electrician_day',360,'£/day'), ('r2','u1','tiling',450,'R/m²'), ('r3','u1','brick',60,'£/m2')").run();

  const out = resetOnboarding(db, 'u1');
  assert.deepStrictEqual({ m: out.memoriesCleared, r: out.ratesCleared, c: out.currency }, { m: 1, r: 2, c: 'ZAR' });

  const u = db.prepare('SELECT * FROM users WHERE id = ?').get('u1');
  assert.strictEqual(u.onboarding_completed_at, null);
  assert.ok(u.onboarding_reset_at);
  const active = db.prepare('SELECT id FROM user_memories WHERE is_active = 1').all().map((r) => r.id);
  assert.deepStrictEqual(active, ['m2'], 'only onboarding memories are set aside');
  const rates = db.prepare('SELECT id FROM client_rate_library WHERE is_active = 1').all().map((r) => r.id);
  assert.deepStrictEqual(rates, ['r2'], 'Rand rates are kept');
});

test('reset on a UK account keeps its £ rates (and never reads PER/day as Rand)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO users (id, email, onboarding_completed_at) VALUES ('u2', 'x@y.co.uk', CURRENT_TIMESTAMP)").run();
  db.prepare("INSERT INTO client_rate_library (id, user_id, item_key, value, unit) VALUES ('r1','u2','a',300,'£/day'), ('r2','u2','b',50,'PER/day'), ('r3','u2','c',80,'€/m2')").run();
  const out = resetOnboarding(db, 'u2');
  assert.strictEqual(out.ratesCleared, 1);
  const rates = db.prepare('SELECT id FROM client_rate_library WHERE is_active = 1').all().map((r) => r.id).sort();
  assert.deepStrictEqual(rates, ['r1', 'r2']);
});

test('a South African library rate is not clipped by the GBP unit ceilings', () => {
  // SS01 structural steel is ~R56,600/t — far above £2,500/t x parity.
  const r = price([{ key: 'comm_structural_steel_erected', qty: 2, unit: 't', section: 'Frame' }], 'Midrand', ZA_USER);
  const line = r.sections[0].items[0];
  assert.strictEqual(line.rate_source, 'base_library');
  assert.strictEqual(line.rate, Math.round(countries.zaRateForUkKey('comm_structural_steel_erected').rate * 100) / 100);
});

// ── Rate detail ────────────────────────────────────────────────────────────

test('every library rate breaks down into labour + materials + plant that sum to the rate', () => {
  for (const region of [null, 'Western Cape - Cape Town metro & Winelands']) {
    const v = countries.zaLibraryView(region);
    for (const sec of v.sections) for (const r of sec.rates) {
      assert.ok(Math.abs(r.labour + r.materials + r.plant - r.sell) < 0.05, `${r.code}: ${r.labour}+${r.materials}+${r.plant} != ${r.sell}`);
    }
  }
});

test('the library view is adjusted to the region asked for', () => {
  const base = countries.zaLibraryView(null);
  const cpt = countries.zaLibraryView('Western Cape - Cape Town metro & Winelands');
  const a = base.sections[0].rates[0], b = cpt.sections[0].rates[0];
  assert.ok(Math.abs(b.sell / a.sell - 1.08) < 0.001);
  assert.strictEqual(cpt.region.factor, 1.08);
  assert.ok(base.elemental.length > 40, 'R/m2 benchmarks imported');
});

test('a South African BOQ line names the SA-RL rate that priced it', () => {
  const r = price([
    { key: mappedKey, qty: 1, unit: 'm²', section: 'A' },
    { key: unmappedKey, qty: 1, unit: 'm²', section: 'A' },
  ], 'Sandton', ZA_USER);
  const items = r.sections.flatMap((s) => s.items);
  assert.strictEqual(items.find((i) => i.key === mappedKey).library_ref, countries.zaRateForUkKey(mappedKey).codes.join('+'));
  assert.strictEqual(items.find((i) => i.key === unmappedKey).converted_from_uk, true);
  // UK lines carry neither.
  const uk = price([{ key: mappedKey, qty: 1, unit: 'm²', section: 'A' }], 'Leeds', { country: 'GB' });
  assert.strictEqual(uk.sections[0].items[0].library_ref, undefined);
});
