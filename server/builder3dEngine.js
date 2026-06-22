// 3D Builder — parametric quantity take-off + pricing engine (Phase 1).
//
// This is the "brain" behind the /builder3d page: given a simple rectangular
// building (footprint, wall height, storeys, roof pitch, openings and a couple
// of material choices) it derives real construction quantities from the
// geometry — m² of wall, m³ of trench fill, m² of roof slope, counts of
// windows/doors — and prices each one against the existing seeded `rates`
// library (the same UK Master Rates the estimator uses).
//
// It is deliberately pure: the rate lookup is injected so this module can be
// unit-tested without a database (see builder3dEngine.test.js). The Express
// route in builder3dRoutes.js supplies a SQLite-backed lookup.
//
// Phase 1 scope: single rectangular footprint, gable roof. L/T/U-shaped
// footprints, hips, dormers and a full element-recipe library are Phase 2.

'use strict';

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) {
  return Math.round((num(n) + Number.EPSILON) * 100) / 100;
}

// Clamp a user input to a sane range so a stray "999" storeys can't produce a
// nonsense quote.
function clamp(v, min, max, fallback) {
  const n = num(v, fallback);
  return Math.min(max, Math.max(min, n));
}

// Average glazed area (m²) assumed per opening, used both to net the wall area
// down and to choose a window rate band.
const WINDOW_AVG_M2 = 1.6;
const DOOR_AVG_M2 = 1.9;

// Material choices map to a primary rate code (with a description fallback so
// the engine still works if a deployment's seed used a slightly different code).
const WALL_TYPES = {
  cavity: { code: 'BW-013', descLike: 'full cavity wall with full fill insulation', label: 'Cavity wall (full-fill insulated)' },
  cavity_brick: { code: 'BW-012', descLike: 'full cavity wall (brick/block)', label: 'Cavity wall (brick/block)' },
  facing_brick: { code: 'BW-003', descLike: 'one brick wall (215mm) facing brick', label: 'Solid facing brick (215mm)' },
};

const ROOF_COVERINGS = {
  concrete_tile: { code: 'RF-001', descLike: 'concrete interlocking tiles', label: 'Concrete interlocking tiles' },
  clay_tile: { code: 'RF-003', descLike: 'clay plain tiles', label: 'Clay plain tiles' },
  slate: { code: 'RF-004', descLike: 'natural slate', label: 'Natural slate' },
};

/**
 * Normalise + validate the raw inputs from the client into a clean model.
 */
function normaliseInputs(raw = {}) {
  const wallType = WALL_TYPES[raw.wallType] ? raw.wallType : 'cavity';
  const roofCovering = ROOF_COVERINGS[raw.roofCovering] ? raw.roofCovering : 'concrete_tile';
  return {
    length: clamp(raw.length, 2, 60, 8),
    width: clamp(raw.width, 2, 60, 6),
    wallHeight: clamp(raw.wallHeight, 2, 6, 2.6),
    storeys: Math.round(clamp(raw.storeys, 1, 4, 1)),
    roofPitch: clamp(raw.roofPitch, 5, 60, 35),
    windows: Math.round(clamp(raw.windows, 0, 60, 6)),
    doors: Math.round(clamp(raw.doors, 0, 20, 2)),
    wallType,
    roofCovering,
    ohpPct: clamp(raw.ohpPct, 0, 60, 15),
    vatPct: clamp(raw.vatPct, 0, 25, 20),
  };
}

/**
 * Derive construction quantities from the geometry. Returns plain numbers in
 * SI-ish units (m, m², m³, nr) so the pricing step is trivial.
 */
function computeQuantities(m) {
  const perimeter = 2 * (m.length + m.width);
  const footprint = m.length * m.width;
  const longSide = Math.max(m.length, m.width);

  // Walls: gross external face over every storey, less the openings.
  const wallGross = perimeter * m.wallHeight * m.storeys;
  const openingsArea = m.windows * WINDOW_AVG_M2 + m.doors * DOOR_AVG_M2;
  const wallNet = Math.max(wallGross - openingsArea, 0);

  // Foundations: trench fill around the perimeter (600mm wide × 800mm deep is a
  // common domestic strip), a ground-bearing slab and DPM over the footprint.
  const trenchVolume = perimeter * 0.6 * 0.8;
  const slabArea = footprint;

  // Roof: a gable roof. Each slope is the half-footprint divided by cos(pitch);
  // both slopes together ≈ footprint / cos(pitch). Trusses are priced on plan.
  const pitchRad = (m.roofPitch * Math.PI) / 180;
  const roofSlopeArea = footprint / Math.cos(pitchRad);
  const ridgeLength = longSide;
  const eavesLength = 2 * longSide;

  // Internal finishes: one plastered face of the external walls plus ceilings.
  const ceilingArea = footprint * m.storeys;
  const plasterArea = wallNet + ceilingArea;

  return {
    perimeter: round2(perimeter),
    footprint: round2(footprint),
    wallGross: round2(wallGross),
    wallNet: round2(wallNet),
    openingsArea: round2(openingsArea),
    trenchVolume: round2(trenchVolume),
    slabArea: round2(slabArea),
    roofSlopeArea: round2(roofSlopeArea),
    ridgeLength: round2(ridgeLength),
    eavesLength: round2(eavesLength),
    downpipeLength: round2(2 * m.wallHeight * m.storeys),
    ceilingArea: round2(ceilingArea),
    plasterArea: round2(plasterArea),
    windows: m.windows,
    doors: m.doors,
  };
}

/**
 * The element recipe: each line maps a building element to a rate (by code,
 * with a description fallback) and a quantity drawn from the take-off above.
 * Grouped into the same buckets the PriceAJob screenshot uses.
 */
function buildRecipe(m, q) {
  return [
    // ── STRUCTURE ──
    { category: 'Structure', label: 'Foundations — trench fill', code: 'GW-011', descLike: 'trench fill (concrete c25)', unit: 'm³', qty: q.trenchVolume },
    { category: 'Structure', label: 'Ground floor slab (100mm)', code: 'GW-016', descLike: 'ground floor slab 100mm', unit: 'm²', qty: q.slabArea },
    { category: 'Structure', label: 'Damp-proof membrane', code: 'GW-020', descLike: 'dpm', unit: 'm²', qty: q.slabArea },
    { category: 'Structure', label: 'Floor insulation (100mm)', code: 'GW-021', descLike: 'rigid insulation (100mm', unit: 'm²', qty: q.slabArea },
    { category: 'Structure', label: WALL_TYPES[m.wallType].label, code: WALL_TYPES[m.wallType].code, descLike: WALL_TYPES[m.wallType].descLike, unit: 'm²', qty: q.wallNet },
    { category: 'Structure', label: 'Windows (UPVC casement)', code: 'CJ-022', descLike: 'upvc window 1.2-2.0', unit: 'nr', qty: q.windows },
    { category: 'Structure', label: 'External doors (composite)', code: 'CJ-019', descLike: 'external door (composite)', unit: 'nr', qty: q.doors },

    // ── ROOF ──
    { category: 'Roof', label: 'Trussed rafters (Fink)', code: 'CJ-006', descLike: 'trussed rafters', unit: 'm²', qty: q.footprint },
    { category: 'Roof', label: 'Breathable roofing membrane', code: 'CJ-012', descLike: 'breathable roofing membrane', unit: 'm²', qty: q.roofSlopeArea },
    { category: 'Roof', label: 'Roof battens', code: 'CJ-011', descLike: 'roof battens', unit: 'm²', qty: q.roofSlopeArea },
    { category: 'Roof', label: ROOF_COVERINGS[m.roofCovering].label, code: ROOF_COVERINGS[m.roofCovering].code, descLike: ROOF_COVERINGS[m.roofCovering].descLike, unit: 'm²', qty: q.roofSlopeArea },
    { category: 'Roof', label: 'Ridge tiles', code: 'RF-011', descLike: 'ridge tiles', unit: 'm', qty: q.ridgeLength },
    { category: 'Roof', label: 'Fascia board', code: 'CJ-009', descLike: 'fascia board', unit: 'm', qty: q.eavesLength },
    { category: 'Roof', label: 'Soffit board', code: 'CJ-010', descLike: 'soffit board', unit: 'm', qty: q.eavesLength },
    { category: 'Roof', label: 'Gutter', code: 'RF-013', descLike: 'half round gutter', unit: 'm', qty: q.eavesLength },
    { category: 'Roof', label: 'Downpipe', code: 'RF-014', descLike: 'downpipe', unit: 'm', qty: q.downpipeLength },

    // ── FINISHES ──
    { category: 'Finishes', label: 'Plasterboard (walls & ceilings)', code: 'PL-001', descLike: 'plasterboard to walls', unit: 'm²', qty: q.plasterArea },
    { category: 'Finishes', label: 'Emulsion (2 coats + mist)', code: 'DC-001', descLike: 'mist coat + 2 coats emulsion', unit: 'm²', qty: q.plasterArea },
  ];
}

/**
 * Price the model. `lookupRate(code, descLike)` must return
 * { description, unit, labour_rate, material_rate, total_rate } or null.
 *
 * Returns the full priced breakdown: grouped lines + cost/profit/VAT/total
 * rollup, mirroring the estimate sidebar in the reference software.
 */
function priceModel(rawInputs, lookupRate) {
  if (typeof lookupRate !== 'function') {
    throw new Error('priceModel requires a lookupRate(code, descLike) function');
  }
  const m = normaliseInputs(rawInputs);
  const q = computeQuantities(m);
  const recipe = buildRecipe(m, q);

  const lines = [];
  const missing = [];
  for (const r of recipe) {
    if (!(r.qty > 0)) continue; // skip elements with no quantity (e.g. 0 doors)
    const rate = lookupRate(r.code, r.descLike);
    if (!rate) {
      missing.push(r.code);
      continue;
    }
    const totalRate = num(rate.total_rate) || (num(rate.labour_rate) + num(rate.material_rate));
    const lineTotal = round2(r.qty * totalRate);
    lines.push({
      category: r.category,
      label: r.label,
      code: r.code,
      description: rate.description || r.label,
      unit: r.unit,
      qty: round2(r.qty),
      rate: round2(totalRate),
      labour: round2(r.qty * num(rate.labour_rate)),
      materials: round2(r.qty * num(rate.material_rate)),
      total: lineTotal,
    });
  }

  // Group, preserving the recipe's category order.
  const order = ['Structure', 'Roof', 'Finishes'];
  const groups = order
    .map((category) => ({
      category,
      items: lines.filter((l) => l.category === category),
      subtotal: round2(lines.filter((l) => l.category === category).reduce((s, l) => s + l.total, 0)),
    }))
    .filter((g) => g.items.length > 0);

  const cost = round2(lines.reduce((s, l) => s + l.total, 0));
  const labour = round2(lines.reduce((s, l) => s + l.labour, 0));
  const materials = round2(lines.reduce((s, l) => s + l.materials, 0));
  const profit = round2(cost * (m.ohpPct / 100));
  const subtotal = round2(cost + profit);
  const vat = round2(subtotal * (m.vatPct / 100));
  const total = round2(subtotal + vat);

  return {
    inputs: m,
    quantities: q,
    groups,
    missing,
    totals: { cost, labour, materials, profit, subtotal, vat, total },
  };
}

module.exports = {
  normaliseInputs,
  computeQuantities,
  buildRecipe,
  priceModel,
  WALL_TYPES,
  ROOF_COVERINGS,
};
