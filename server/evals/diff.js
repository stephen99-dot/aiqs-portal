// Pure diffing + valuation logic for the takeoff eval harness (Phase 7).
// No model calls, no I/O — unit-testable. runEval.js wires this to fixtures.

const { priceLockedQuantities } = require('../deterministicPricer');

// Normalise a description for fuzzy matching: lowercase, strip punctuation,
// collapse whitespace. Used when an item has no stable `key`.
function normalizeDesc(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Matching key for an item: prefer the rate-library key, fall back to the
// normalised description so we still match across runs that omit keys.
function keyOf(item) {
  if (item && item.key) return String(item.key).toLowerCase();
  return normalizeDesc(item && item.description);
}

// Multiset diff of two item lists by matching key. Returns the items present in
// `expected` but not matched in `actual` (missing) and vice-versa (extra).
function diffItems(expected = [], actual = []) {
  const bucket = (items) => {
    const m = new Map();
    for (const it of items) {
      const k = keyOf(it);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return m;
  };
  const ex = bucket(expected);
  const ac = bucket(actual);

  const missing = [];
  for (const [k, list] of ex) {
    const have = (ac.get(k) || []).length;
    for (let i = have; i < list.length; i++) missing.push(list[i]);
  }
  const extra = [];
  for (const [k, list] of ac) {
    const want = (ex.get(k) || []).length;
    for (let i = want; i < list.length; i++) extra.push(list[i]);
  }
  return {
    expectedCount: expected.length,
    actualCount: actual.length,
    countDelta: actual.length - expected.length,
    missing,
    extra,
  };
}

// Deterministic construction total for a set of items (the priced line-item sum,
// before % add-ons — the most stable value metric for regression detection).
function constructionTotal(items, { location = '', options = {} } = {}) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  const priced = priceLockedQuantities(items, location, {}, options);
  return priced.summary.construction_total;
}

// Full comparison of one job: count delta, value delta %, missing/extra items.
function compareJob(expected, actual, opts = {}) {
  const items = diffItems(expected.items || [], actual.items || []);
  const expTotal = constructionTotal(expected.items || [], { location: expected.location, options: expected.options });
  const actTotal = constructionTotal(actual.items || [], { location: expected.location, options: expected.options });
  const valueDeltaPct = expTotal ? ((actTotal - expTotal) / expTotal) * 100 : (actTotal ? 100 : 0);
  return {
    ...items,
    expectedTotal: round2(expTotal),
    actualTotal: round2(actTotal),
    valueDeltaPct: round2(valueDeltaPct),
  };
}

function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

module.exports = { normalizeDesc, keyOf, diffItems, constructionTotal, compareJob };
