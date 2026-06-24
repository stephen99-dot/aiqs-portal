// verifyTakeoff.js — deterministic, no-model verification of an extracted takeoff
// (Phase 9, the recalc step). Asserts the machine-checkable invariants a good QS
// would catch, and returns a machine-readable failure list the agentic loop can
// feed back to the model as a correction turn.
//
// Every check is guarded: if an input isn't available the check is skipped rather
// than firing a false positive. Failures carry severity 'error' (must fix) or
// 'warn' (flag); ok === true means no 'error' failures.

const { getBaseRate, BASE_RATES, unitFamily } = require('./deterministicPricer');

const ALLOWED_UNITS = new Set(['m', 'm2', 'm²', 'm3', 'm³', 'nr', 'no', 'item', 'sum', 'ls', 'kg', 't', 'hr', 'day', 'week', '%']);

// Per-m² construction-cost bands by broad project type (£/m²), reused from the
// Stage 1b validation prompt. Used only as a sanity range, not a hard price.
const PER_M2_BANDS = [
  { test: /refurb|renovat|damage|reinstat|conversion/i, low: 800, high: 1800, label: 'refurb/conversion' },
  { test: /heritage|listed/i, low: 1500, high: 3500, label: 'heritage' },
  { test: /new\s*build|newbuild/i, low: 1600, high: 2800, label: 'new build' },
  { test: /extension|loft|garage|outbuilding/i, low: 1800, high: 3000, label: 'extension' },
];

function normUnit(u) { return String(u || '').trim().toLowerCase(); }
function normDesc(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function bandFor(projectType) {
  for (const b of PER_M2_BANDS) if (b.test.test(projectType || '')) return b;
  return null;
}

// Count window/door line items (each is normally qty 1 Nr per the prompt rules).
function countOpenings(items, kind) {
  const re = kind === 'window' ? /window|\bw\d{2}\b/i : /\bdoor\b|bifold|\bd\d{2}\b|french door|patio door/i;
  let n = 0;
  for (const it of items) {
    const hay = `${it.key || ''} ${it.description || ''}`;
    if (normUnit(it.unit) === 'nr' && re.test(hay)) n += Number(it.qty) || 0;
  }
  return n;
}

// Pull window/door counts out of whatever the zip processor parsed, if present.
function scheduleCounts(zipData) {
  if (!zipData) return null;
  const openings = zipData.all_openings || zipData.openings
    || (zipData.summary && zipData.summary.openings) || null;
  if (Array.isArray(openings) && openings.length) {
    let windows = 0, doors = 0;
    for (const o of openings) {
      const t = String(o.type || '').toLowerCase();
      if (t.startsWith('w')) windows++;
      else if (t.startsWith('d')) doors++;
    }
    return { windows, doors };
  }
  const s = zipData.summary || {};
  if (s.total_windows != null || s.total_doors != null) {
    return { windows: Number(s.total_windows) || 0, doors: Number(s.total_doors) || 0 };
  }
  return null;
}

function verifyTakeoff(input = {}) {
  const {
    items = [],
    floorAreaM2 = null,
    projectType = '',
    zipData = null,
    pricedResult = null,
    planNotes = null,           // { replications: [{ storey, like }], storeyCounts: {storey: n} }
    duplicateThreshold = 0.92,  // (reserved) future fuzzy-dup tuning
  } = input;

  const failures = [];
  const add = (severity, code, message, detail) => failures.push({ severity, code, message, ...(detail ? { detail } : {}) });

  if (!Array.isArray(items) || items.length === 0) {
    add('error', 'NO_ITEMS', 'Takeoff has no items.');
    return { ok: false, failures };
  }

  // 1) Per-item integrity: unit allowed, qty > 0, a rate can be resolved.
  items.forEach((it, i) => {
    const u = normUnit(it.unit);
    if (!u || !ALLOWED_UNITS.has(u)) add('error', 'BAD_UNIT', `Item ${i} "${it.description || it.key}" has invalid unit "${it.unit}".`, { index: i });
    const qty = Number(it.qty);
    if (!(qty > 0)) add('error', 'BAD_QTY', `Item ${i} "${it.description || it.key}" has non-positive qty (${it.qty}).`, { index: i });
    const known = it.key && getBaseRate(it.key);
    if (!known && !normDesc(it.description)) add('warn', 'NO_RATE_BASIS', `Item ${i} has neither a known rate key nor a description to price from.`, { index: i });
    // Wrong-key unit collision: a known key whose unit family differs from the line's
    // (e.g. an m² wall keyed to a per-Nr ties rate). Almost always the wrong key, or
    // an element that should be split into per-unit keys — make the model fix it.
    if (known) {
      const itemFam = unitFamily(it.unit), keyFam = unitFamily(known.unit);
      if (itemFam && keyFam && itemFam !== 'item' && keyFam !== 'item' && itemFam !== keyFam) {
        add('error', 'UNIT_KEY_MISMATCH', `Item ${i} "${it.description || it.key}" is measured per ${it.unit} but its rate key '${it.key}' prices per ${known.unit} — pick the right key, or split the element into per-${it.unit} keys.`, { index: i, key: it.key, itemUnit: it.unit, keyUnit: known.unit });
      }
    }
  });

  // 2) Schedule reconciliation: window/door counts in items vs the parsed schedule.
  const sched = scheduleCounts(zipData);
  if (sched) {
    const w = countOpenings(items, 'window');
    const d = countOpenings(items, 'door');
    if (sched.windows && w !== sched.windows) add('error', 'WINDOW_COUNT_MISMATCH', `Schedule lists ${sched.windows} windows but takeoff has ${w}.`, { schedule: sched.windows, items: w });
    if (sched.doors && d !== sched.doors) add('error', 'DOOR_COUNT_MISMATCH', `Schedule lists ${sched.doors} doors but takeoff has ${d}.`, { schedule: sched.doors, items: d });
  }

  // 3) Floor-area sanity: slab/screed/insulation/DPM areas ~ the authoritative area.
  const area = Number(floorAreaM2);
  if (area > 0) {
    const floorRe = /slab|screed|insulation|dpm|damp proof membrane|oversite|floor finish/i;
    for (const it of items) {
      if (!['m2', 'm²'].includes(normUnit(it.unit))) continue;
      if (!floorRe.test(`${it.key || ''} ${it.description || ''}`)) continue;
      const qty = Number(it.qty) || 0;
      if (qty > area * 1.5 || qty < area * 0.5) {
        add('error', 'FLOOR_AREA_OUTLIER', `"${it.description || it.key}" area ${qty}m² is outside 0.5–1.5× the floor area (${area}m²).`, { qty, area });
      }
    }
  }

  // 4) Near-duplicate descriptions across different sections.
  const seen = new Map();
  for (const it of items) {
    const key = normDesc(it.description);
    if (!key) continue;
    const sec = it.section || '';
    if (seen.has(key)) {
      const prev = seen.get(key);
      if (prev.section !== sec) add('warn', 'NEAR_DUPLICATE', `"${it.description}" appears in both "${prev.section}" and "${sec}".`, { description: it.description });
    } else seen.set(key, { section: sec });
  }

  // 5) Per-m² construction total within the project-type band.
  const band = bandFor(projectType);
  const constructionTotal = pricedResult && pricedResult.summary ? pricedResult.summary.construction_total : null;
  if (band && area > 0 && constructionTotal != null) {
    const perM2 = constructionTotal / area;
    if (perM2 < band.low || perM2 > band.high) {
      add('error', 'PER_M2_OUT_OF_BAND', `£${Math.round(perM2)}/m² is outside the ${band.label} band (£${band.low}–£${band.high}/m²).`, { perM2: Math.round(perM2), low: band.low, high: band.high });
    }
  }

  // 6) Replication check: storeys flagged "as Ground Floor" must match GF count.
  if (planNotes && Array.isArray(planNotes.replications) && planNotes.storeyCounts) {
    const gf = planNotes.storeyCounts['ground'] ?? planNotes.storeyCounts['Ground Floor'] ?? planNotes.storeyCounts['gf'];
    for (const rep of planNotes.replications) {
      if (!/ground/i.test(rep.like || '')) continue;
      const n = planNotes.storeyCounts[rep.storey];
      if (gf != null && n != null && Math.abs(n - gf) > Math.max(2, gf * 0.2)) {
        add('error', 'REPLICATION_MISMATCH', `${rep.storey} is "as Ground Floor" but has ${n} items vs GF ${gf}.`, { storey: rep.storey, count: n, gf });
      }
    }
  }

  const ok = !failures.some((f) => f.severity === 'error');
  return { ok, failures };
}

module.exports = { verifyTakeoff, ALLOWED_UNITS, PER_M2_BANDS };
