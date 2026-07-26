// Guards the rate figures embedded in chat.js's system prompts against drifting away
// from the pricer's rate library.
//
// This used to be a live problem. Two hand-typed "FIXED UK RATES — use these exact
// figures, no deviations" tables disagreed with each other and with deterministicPricer
// on excavation (95 vs 75), facing brick (95 vs 82), OSB sarking (18 vs 22), breather
// membrane (4.50 vs 8) and tile battens (9.50 vs 12). The model was told to price off
// figures the pricer would then overrule.
//
// Those two tables are now rendered from BASE_RATES via renderRateCribSheet(), so they
// cannot drift. What remains hand-written is the AVAILABLE ITEM KEYS block, which pairs
// each canonical key with a "(~£N)" hint alongside guidance that is not in BASE_RATES
// and is worth keeping. These tests pin those hints to the library.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { BASE_RATES, renderRateCribSheet } = require('./deterministicPricer');

const CHAT_SRC = fs.readFileSync(path.join(__dirname, 'chat.js'), 'utf8');

// The hand-written key vocabulary, sliced out of the prompt. Scoped deliberately: prose
// elsewhere in the prompt uses the same "(~£5,000)" shape for things that are not keys
// (e.g. "PC sum for supply (~£5,000-£10,000)"), and scanning the whole file mistakes
// those for key hints.
const KEYS_BLOCK = (() => {
  const start = CHAT_SRC.indexOf('AVAILABLE ITEM KEYS');
  assert.ok(start > 0, 'AVAILABLE ITEM KEYS block not found in chat.js');
  const end = CHAT_SRC.indexOf('PROJECT TYPE DETECTION', start);
  assert.ok(end > start, 'end of AVAILABLE ITEM KEYS block not found');
  return CHAT_SRC.slice(start, end);
})();

// Pull every "some_item_key (~£1,234" pairing out of the key vocabulary. A hint only
// counts when the "~£" figure follows the key immediately, so ranges and prose asides
// are not mistaken for a per-key rate.
function promptRateHints(src) {
  const hints = [];
  const re = /(^|[\s,(])([a-z][a-z0-9_]{3,})\s*\(~£([\d,]+(?:\.\d+)?)(?!\s*-\s*£)/gm;
  let m;
  while ((m = re.exec(src))) {
    hints.push({ key: m[2], value: parseFloat(m[3].replace(/,/g, '')) });
  }
  return hints;
}

test('every (~£N) hint in the prompt names a real rate key', () => {
  const unknown = promptRateHints(KEYS_BLOCK).filter(h => !BASE_RATES[h.key]);
  assert.deepStrictEqual(unknown.map(h => h.key), [],
    'prompt advertises item keys that do not exist in BASE_RATES');
});

test('every (~£N) hint in the prompt matches the rate library', () => {
  const drifted = promptRateHints(KEYS_BLOCK)
    .filter(h => BASE_RATES[h.key])
    .filter(h => Math.abs(BASE_RATES[h.key].rate - h.value) > 0.005)
    .map(h => `${h.key}: prompt ~£${h.value} vs library £${BASE_RATES[h.key].rate}`);
  assert.deepStrictEqual(drifted, [],
    'prompt rate hints have drifted from BASE_RATES — update the prompt, not the library');
});

test('the prompt carries no hand-typed prose rate table', () => {
  // The old tables looked like "Brick outer leaf facing: 95/m2 | Cavity insulation...".
  // Anything matching that shape is a reintroduced copy.
  const proseRates = CHAT_SRC.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /[A-Za-z][A-Za-z ]{3,}: ?\d+(\.\d+)?\/(m2|m²|m3|m³|Nr|ea|m)\s*\|/.test(line))
    .map(({ n, line }) => `${n}: ${line.slice(0, 80)}`);
  assert.deepStrictEqual(proseRates, [],
    'a prose rate table is back in chat.js — render it from BASE_RATES instead');
});

test('the generated crib-sheet is byte-stable, so the cached prompt prefix is too', () => {
  // chat.js renders this once at module load into a cached prefix. If it were unstable
  // (unsorted keys, a timestamp) every turn would miss the prompt cache.
  const a = renderRateCribSheet();
  const b = renderRateCribSheet();
  assert.strictEqual(a, b, 'renderRateCribSheet must be deterministic');
  const keys = a.split('\n').join(' | ').split(' | ').map(s => s.split(' ')[0]);
  assert.deepStrictEqual(keys, [...keys].sort(), 'entries must be sorted for stability');
  assert.ok(!/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}/.test(a), 'must contain no date or time');
});

test('the crib-sheet covers the whole rate library with a rate and a unit', () => {
  const sheet = renderRateCribSheet();
  const libraryKeys = Object.keys(BASE_RATES);
  for (const key of libraryKeys) {
    const m = sheet.match(new RegExp(`(?:^|\\| )${key} ([\\d.]+)/(\\S+)`, 'm'));
    assert.ok(m, `${key} missing from the crib-sheet`);
    assert.strictEqual(parseFloat(m[1]), BASE_RATES[key].rate, `${key} rate`);
  }
  assert.ok(libraryKeys.length > 300, `expected the full library, saw ${libraryKeys.length}`);
});

test('the rate library declares each key exactly once', () => {
  // A duplicate key in an object literal is silently overwritten, so the earlier
  // definition becomes dead code that looks editable. stair_opening_formation was
  // declared twice (750/Item, then 850/Nr) and the first copy never applied.
  const src = fs.readFileSync(path.join(__dirname, 'deterministicPricer.js'), 'utf8').split('\n');
  const seen = new Map();
  const dups = [];
  let inObject = false;
  src.forEach((line, i) => {
    if (/^const BASE_RATES\s*=/.test(line)) inObject = true;
    else if (inObject && /^\};/.test(line)) inObject = false;
    if (!inObject) return;
    const m = line.match(/^\s*'([a-z0-9_]+)':\s*\{\s*rate:/);
    if (!m) return;
    if (seen.has(m[1])) dups.push(`${m[1]} (lines ${seen.get(m[1])} and ${i + 1})`);
    else seen.set(m[1], i + 1);
  });
  assert.deepStrictEqual(dups, [], 'duplicate keys in BASE_RATES');
});
