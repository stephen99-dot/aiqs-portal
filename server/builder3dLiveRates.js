// 3D Builder — live scraped material prices.
//
// Grounds the estimate in the real supplier prices we've scraped
// (server/materials-live.json: ~400 products with name, aliases, unit, supplier,
// price, in_stock). For each priced element we attach the best-matching live
// product as a benchmark (`line.live`). For count-based component lines whose
// unit matches a product's unit cleanly (a window, a door, a boiler, a
// radiator, sanitaryware, a sheet/board), the live price can also drive the
// material cost — those are flagged `priceable: true`.
//
// We deliberately do NOT substitute retail pack prices into area/volume trade
// rates (e.g. a £/bag of concrete into a £/m³ trench-fill rate) — that would
// make the estimate less accurate, not more.

'use strict';

const fs = require('fs');
const path = require('path');

let CACHE = null;
function load() {
  if (CACHE) return CACHE;
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'materials-live.json'), 'utf8');
    const arr = JSON.parse(raw);
    CACHE = Array.isArray(arr) ? arr : [];
  } catch (e) {
    CACHE = [];
  }
  return CACHE;
}

// Element code -> { keywords, priceable }. `priceable` means the scraped unit
// price can legitimately stand in for the element's material cost (the units
// line up: a product per nr/board ≈ one element).
const MAP = {
  // Count-based components — live price is directly usable.
  'CJ-022': { keywords: ['window'], priceable: true },
  'CJ-019': { keywords: ['external door', 'composite door', 'front door'], priceable: true },
  'CJ-013': { keywords: ['internal door'], priceable: true },
  'PH-001': { keywords: ['combi boiler', 'boiler'], priceable: true },
  'PH-006': { keywords: ['radiator'], priceable: true },
  'PH-012': { keywords: ['toilet', 'close coupled', 'wc'], priceable: true },
  'PH-015': { keywords: ['basin', 'wash hand basin'], priceable: true },
  'PH-017': { keywords: ['bath'], priceable: true },
  'EL-002': { keywords: ['consumer unit'], priceable: true },
  'EL-004': { keywords: ['double socket', 'socket'], priceable: true },
  'EL-012': { keywords: ['downlight'], priceable: true },
  'GW-021': { keywords: ['celotex', 'pir board', 'rigid insulation', '100mm insulation'], priceable: true },
  'RF-018': { keywords: ['loft roll', 'loft insulation', 'mineral wool'], priceable: true },
  'BW-016': { keywords: ['cavity insulation', 'mineral wool'], priceable: false },
  // Material-dominant elements — benchmark only (units differ from trade rate).
  'BW-001': { keywords: ['facing brick', 'engineering brick'], priceable: false },
  'BW-007': { keywords: ['concrete block', 'dense block'], priceable: false },
  'BW-008': { keywords: ['aerated block', 'aircrete', 'thermalite'], priceable: false },
  'GW-035': { keywords: ['mot type 1', 'sub-base', 'hardcore'], priceable: false },
  'RF-001': { keywords: ['concrete roof tile', 'interlocking tile', 'roof tile'], priceable: false },
  'RF-003': { keywords: ['clay roof tile', 'plain tile'], priceable: false },
  'RF-004': { keywords: ['slate'], priceable: false },
  'PL-001': { keywords: ['plasterboard standard', 'plasterboard 12.5', 'plasterboard'], priceable: false },
  'CJ-007': { keywords: ['chipboard'], priceable: false },
  'DC-001': { keywords: ['emulsion'], priceable: false },
};

// Score a product against keywords: a hit in the product NAME counts much more
// than one only in the aliases/category, and the first keyword is the strongest
// signal. This keeps "trench fill / concrete" from matching a "concrete kerb".
function scoreRow(row, keywords) {
  const name = (row.material || '').toLowerCase();
  const alias = `${row.aliases || ''} ${row.category || ''}`.toLowerCase();
  let s = 0;
  keywords.forEach((k, i) => {
    const w = i === 0 ? 3 : 1;
    if (name.includes(k)) s += w;
    else if (alias.includes(k)) s += w * 0.4;
  });
  return s;
}

function nameHit(row, keywords) {
  const name = (row.material || '').toLowerCase();
  return keywords.some((k) => name.includes(k));
}

function findLive(keywords) {
  const scored = load()
    .map((r) => ({ r, s: scoreRow(r, keywords) }))
    // Require the match to land in the product NAME, not just a stray alias/
    // category — stops "bath" matching a wall tile in the bathroom category.
    .filter((x) => nameHit(x.r, keywords))
    .sort((a, b) => (b.s - a.s) || (Number(b.r.in_stock) - Number(a.r.in_stock)) || (a.r.price - b.r.price));
  if (!scored.length) return null;
  const r = scored[0].r;
  return {
    material: r.material,
    price: r.price,
    unit: r.unit,
    supplier: r.supplier,
    source_url: r.source_url,
    in_stock: !!r.in_stock,
  };
}

// Attach `live` benchmarks to each line in-place; return how many were matched.
function enrich(groups) {
  let matched = 0;
  for (const g of groups || []) {
    for (const it of g.items || []) {
      const m = MAP[it.code];
      if (!m) continue;
      const live = findLive(m.keywords);
      if (live) { it.live = { ...live, priceable: m.priceable }; matched++; }
    }
  }
  return matched;
}

module.exports = { enrich, findLive, load };
