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

const SHAPES = ['rect', 'L', 'T', 'U'];

// Build the building footprint for the chosen shape. Returns:
//   outline — the external wall polygon (ordered points in the X-Z plane),
//             centred on the origin so the 3D model sits nicely on the grid.
//   rects   — the non-overlapping rectangles the shape decomposes into; each
//             carries its own roof, and the union is the footprint.
// L/T/U are derived from the overall L×W bounding box plus a single `wing`
// fraction controlling the notch / stem size.
function generateFootprint(m) {
  const L = m.length, W = m.width, k = m.wing;
  let outline, rects;
  if (m.shape === 'L') {
    const nx = L * k, nz = W * k; // notch cut from the +X/+Z corner
    outline = [{ x: 0, z: 0 }, { x: L, z: 0 }, { x: L, z: W - nz }, { x: L - nx, z: W - nz }, { x: L - nx, z: W }, { x: 0, z: W }];
    rects = [{ x: 0, z: 0, w: L, d: W - nz }, { x: 0, z: W - nz, w: L - nx, d: nz }];
  } else if (m.shape === 'T') {
    const bd = W * (1 - k), sw = L * k; // bar depth + central stem width
    outline = [{ x: 0, z: 0 }, { x: L, z: 0 }, { x: L, z: bd }, { x: (L + sw) / 2, z: bd }, { x: (L + sw) / 2, z: W }, { x: (L - sw) / 2, z: W }, { x: (L - sw) / 2, z: bd }, { x: 0, z: bd }];
    rects = [{ x: 0, z: 0, w: L, d: bd }, { x: (L - sw) / 2, z: bd, w: sw, d: W - bd }];
  } else if (m.shape === 'U') {
    const nd = W * k, nw = L * k; // central notch cut from the +Z side
    outline = [{ x: 0, z: 0 }, { x: L, z: 0 }, { x: L, z: W }, { x: (L + nw) / 2, z: W }, { x: (L + nw) / 2, z: W - nd }, { x: (L - nw) / 2, z: W - nd }, { x: (L - nw) / 2, z: W }, { x: 0, z: W }];
    rects = [{ x: 0, z: 0, w: L, d: W - nd }, { x: 0, z: W - nd, w: (L - nw) / 2, d: nd }, { x: (L + nw) / 2, z: W - nd, w: (L - nw) / 2, d: nd }];
  } else {
    outline = [{ x: 0, z: 0 }, { x: L, z: 0 }, { x: L, z: W }, { x: 0, z: W }];
    rects = [{ x: 0, z: 0, w: L, d: W }];
  }
  const cx = L / 2, cz = W / 2;
  return {
    outline: outline.map((p) => ({ x: round2(p.x - cx), z: round2(p.z - cz) })),
    // Store rectangles by their centre so the renderer can place a box directly.
    rects: rects.map((r) => ({ x: round2(r.x + r.w / 2 - cx), z: round2(r.z + r.d / 2 - cz), w: round2(r.w), d: round2(r.d) })),
  };
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].z - pts[j].x * pts[i].z;
  }
  return Math.abs(a) / 2;
}

function polyPerimeter(pts) {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    p += Math.hypot(pts[j].x - pts[i].x, pts[j].z - pts[i].z);
  }
  return p;
}

// Roof linear quantities for one rectangle. Ridge runs along the rectangle's
// long axis; a hip insets the ridge by half the short span at each end and adds
// four hip runs, and has eaves all round (a gable only on the two slope sides).
function rectRoof(w, d, pitchRad, isHip) {
  const long = Math.max(w, d), short = Math.min(w, d);
  const rise = (short / 2) * Math.tan(pitchRad);
  const ridge = isHip ? Math.max(long - short, 0) : long;
  const hipLen = Math.sqrt(2 * (short / 2) * (short / 2) + rise * rise);
  return {
    ridge,
    capping: ridge + (isHip ? 4 * hipLen : 0),
    eaves: isHip ? 2 * (w + d) : 2 * long,
  };
}

/**
 * Normalise + validate the raw inputs from the client into a clean model.
 */
function normaliseInputs(raw = {}) {
  const wallType = WALL_TYPES[raw.wallType] ? raw.wallType : 'cavity';
  const roofCovering = ROOF_COVERINGS[raw.roofCovering] ? raw.roofCovering : 'concrete_tile';
  const roofType = raw.roofType === 'gable' ? 'gable' : 'hip';
  const shape = SHAPES.includes(raw.shape) ? raw.shape : 'rect';
  return {
    length: clamp(raw.length, 2, 60, 8),
    width: clamp(raw.width, 2, 60, 6),
    wallHeight: clamp(raw.wallHeight, 2, 6, 2.6),
    storeys: Math.round(clamp(raw.storeys, 1, 4, 1)),
    roofPitch: clamp(raw.roofPitch, 5, 60, 35),
    roofType,
    shape,
    wing: clamp(raw.wing, 0.2, 0.7, 0.45),
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
  const { outline, rects } = generateFootprint(m);
  const perimeter = polyPerimeter(outline);
  const footprint = polyArea(outline);

  // Walls: gross external face over every storey, less the openings.
  const wallGross = perimeter * m.wallHeight * m.storeys;
  const openingsArea = m.windows * WINDOW_AVG_M2 + m.doors * DOOR_AVG_M2;
  const wallNet = Math.max(wallGross - openingsArea, 0);

  // Foundations: trench fill around the perimeter (600mm wide × 800mm deep is a
  // common domestic strip), a ground-bearing slab and DPM over the footprint.
  const trenchVolume = perimeter * 0.6 * 0.8;
  const slabArea = footprint;

  // Roof. With equal pitch on every plane, the total slope area is the
  // horizontal projected (footprint) area / cos(pitch) — true for any footprint,
  // so this stays exact for L/T/U shapes. The linear quantities (structural
  // ridge, ridge+hip capping, eaves) are summed over the shape's rectangles,
  // each carrying its own roof. At wing junctions this slightly over-counts
  // (real roofs form valleys there) — a known Phase-2 approximation.
  const isHip = m.roofType === 'hip';
  const pitchRad = (m.roofPitch * Math.PI) / 180;
  const roofSlopeArea = footprint / Math.cos(pitchRad);
  let ridgeLength = 0, cappingLength = 0, eavesLength = 0;
  for (const r of rects) {
    const rr = rectRoof(r.w, r.d, pitchRad, isHip);
    ridgeLength += rr.ridge;
    cappingLength += rr.capping;
    eavesLength += rr.eaves;
  }

  // Internal finishes: one plastered face of the external walls plus ceilings.
  const ceilingArea = footprint * m.storeys;
  const plasterArea = wallNet + ceilingArea;

  // Services scale with usable floor area. A rough room/bathroom count drives
  // the electrical/heating/sanitary allowances (clearly an allowance, not a
  // designed layout — Phase 1).
  const floorArea = footprint * m.storeys;
  const rooms = Math.max(2, Math.round(floorArea / 14));
  const bathrooms = Math.max(1, Math.round(rooms / 4));

  return {
    perimeter: round2(perimeter),
    footprint: round2(footprint),
    floorArea: round2(floorArea),
    wallGross: round2(wallGross),
    wallNet: round2(wallNet),
    openingsArea: round2(openingsArea),
    trenchVolume: round2(trenchVolume),
    slabArea: round2(slabArea),
    roofSlopeArea: round2(roofSlopeArea),
    ridgeLength: round2(ridgeLength),
    cappingLength: round2(cappingLength),
    eavesLength: round2(eavesLength),
    downpipeLength: round2(2 * m.wallHeight * m.storeys),
    ceilingArea: round2(ceilingArea),
    plasterArea: round2(plasterArea),
    rooms,
    bathrooms,
    windows: m.windows,
    doors: m.doors,
    outline,
    rects,
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
    { category: 'Roof', label: 'Ridge & hip tiles', code: 'RF-011', descLike: 'ridge tiles', unit: 'm', qty: q.cappingLength },
    { category: 'Roof', label: 'Fascia board', code: 'CJ-009', descLike: 'fascia board', unit: 'm', qty: q.eavesLength },
    { category: 'Roof', label: 'Soffit board', code: 'CJ-010', descLike: 'soffit board', unit: 'm', qty: q.eavesLength },
    { category: 'Roof', label: 'Gutter', code: 'RF-013', descLike: 'half round gutter', unit: 'm', qty: q.eavesLength },
    { category: 'Roof', label: 'Downpipe', code: 'RF-014', descLike: 'downpipe', unit: 'm', qty: q.downpipeLength },

    // ── SERVICES ── (allowances scaled by derived room / bathroom count)
    { category: 'Services', label: 'Consumer unit (dual RCD)', code: 'EL-002', descLike: 'consumer unit (dual rcd', unit: 'nr', qty: 1 },
    { category: 'Services', label: 'Double socket outlets', code: 'EL-004', descLike: 'double socket outlet', unit: 'nr', qty: q.rooms * 4 },
    { category: 'Services', label: 'LED downlights', code: 'EL-012', descLike: 'downlight (led', unit: 'nr', qty: q.rooms * 3 },
    { category: 'Services', label: 'Light switches', code: 'EL-015', descLike: 'light switch (1 gang)', unit: 'nr', qty: q.rooms },
    { category: 'Services', label: 'Smoke detectors (interlinked)', code: 'EL-018', descLike: 'smoke detector', unit: 'nr', qty: m.storeys + 1 },
    { category: 'Services', label: 'Combi boiler', code: 'PH-001', descLike: 'combi boiler (budget', unit: 'nr', qty: 1 },
    { category: 'Services', label: 'Radiators', code: 'PH-006', descLike: 'radiator (double panel 600x1000', unit: 'nr', qty: q.rooms },
    { category: 'Services', label: 'Heating pipework (15mm)', code: 'PH-009', descLike: '15mm copper pipework', unit: 'm', qty: q.rooms * 8 },
    { category: 'Services', label: 'WC suites', code: 'PH-012', descLike: 'wc close coupled (budget', unit: 'nr', qty: q.bathrooms },
    { category: 'Services', label: 'Basins', code: 'PH-015', descLike: 'basin pedestal (budget', unit: 'nr', qty: q.bathrooms },
    { category: 'Services', label: 'Baths', code: 'PH-017', descLike: 'bath (acrylic', unit: 'nr', qty: q.bathrooms },

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
  const order = ['Structure', 'Roof', 'Services', 'Finishes'];
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
    // Everything the renderer needs to draw exactly what was priced.
    geometry: {
      outline: q.outline,
      rects: q.rects,
      wallHeight: m.wallHeight,
      storeys: m.storeys,
      roofPitch: m.roofPitch,
      roofType: m.roofType,
      windows: m.windows,
      doors: m.doors,
    },
    groups,
    missing,
    totals: { cost, labour, materials, profit, subtotal, vat, total },
  };
}

// ── Reverse-derive a building model from an existing BOQ ────────────────────
//
// Given a bill of quantities (line items with qty + unit), infer a plausible
// rectangular building so the 3D Builder can render "the look of the building".
// The trick: external wall area ÷ (storey height × storeys) ≈ perimeter, the
// largest floor slab ≈ footprint, and a rectangle is recovered by solving
// L+W = perimeter/2, L·W = footprint. Roof area ÷ footprint gives the pitch.
// Everything is an approximation — the returned `notes` say what was used.

function normUnit(u) {
  return String(u || '').toLowerCase().replace('²', '2').replace('³', '3').replace(/\s+/g, '').trim();
}

function deriveParamsFromBoq(items, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  const notes = [];
  const text = (it) => `${it.key || ''} ${it.description || ''} ${it.display_name || ''} ${it.item || ''}`.toLowerCase();
  const isArea = (it) => normUnit(it.unit) === 'm2';
  const isCount = (it) => ['nr', 'no', 'ea', 'each', 'number', 'item'].includes(normUnit(it.unit));

  const maxAreaWhere = (re) => list.reduce((mx, it) => (isArea(it) && re.test(text(it)) ? Math.max(mx, num(it.qty)) : mx), 0);
  const sumCountWhere = (re) => list.reduce((s, it) => (isCount(it) && re.test(text(it)) ? s + num(it.qty) : s), 0);

  const slabArea = maxAreaWhere(/slab|oversite|ground\s*floor|screed|floor\s*construction/);
  const wallArea = maxAreaWhere(/brick|block|outer\s*leaf|inner\s*leaf|cavity|external\s*wall|render|cladding|facing/);
  const roofArea = maxAreaWhere(/roof|rafter|truss|sarking|batten|slate|tile/);
  const windows = Math.round(sumCountWhere(/window|glazing|rooflight|velux|skylight/));
  let doors = Math.round(sumCountWhere(/door/));
  const extDoors = Math.round(sumCountWhere(/(external|composite|front|entrance|patio|bi-?fold|french)/));
  if (extDoors > 0) doors = extDoors;

  // Storeys from the project type text, else a staircase implies at least two.
  const pt = String(opts.projectType || '').toLowerCase();
  let storeys = 1;
  if (/three\s*stor|3\s*stor/.test(pt)) storeys = 3;
  else if (/two\s*stor|2\s*stor|double\s*stor/.test(pt)) storeys = 2;
  else if (sumCountWhere(/stair/) >= 1) storeys = 2;

  const h = 2.6; // assumed storey height
  const floorArea = num(opts.floorArea);
  let footprint;
  if (slabArea > 0) { footprint = slabArea; notes.push(`Footprint ${round2(footprint)} m² from the floor slab area`); }
  else if (floorArea > 0) { footprint = floorArea / storeys; notes.push(`Footprint ${round2(footprint)} m² from GIA ${round2(floorArea)} m² ÷ ${storeys} storey(s)`); }
  else { footprint = 60; notes.push('Footprint defaulted to 60 m² (no slab or GIA in the BOQ)'); }

  let perimeter;
  if (wallArea > 0) { perimeter = wallArea / (h * storeys); notes.push(`Perimeter ${round2(perimeter)} m from wall area ${round2(wallArea)} m² ÷ (${h}m × ${storeys})`); }
  else { perimeter = 4 * Math.sqrt(footprint); notes.push('Perimeter assumed from a square footprint (no wall area found)'); }

  // Recover the rectangle: roots of x² - (P/2)x + A = 0.
  let L, W;
  const half = perimeter / 2;
  const disc = half * half - 4 * footprint;
  if (disc >= 0) { L = (half + Math.sqrt(disc)) / 2; W = (half - Math.sqrt(disc)) / 2; }
  else { L = W = Math.sqrt(footprint); notes.push('Wall and floor areas were inconsistent — assumed a square footprint'); }
  L = clamp(L, 2, 60, 8); W = clamp(W, 2, 60, 6);

  let roofPitch = 35;
  if (roofArea > footprint && footprint > 0) {
    roofPitch = clamp(Math.round((Math.acos(Math.min(1, Math.max(0.2, footprint / roofArea))) * 180) / Math.PI), 5, 60, 35);
    notes.push(`Roof pitch ${roofPitch}° from roof area ${round2(roofArea)} m² vs footprint`);
  } else {
    notes.push('Roof pitch 35° (default — no usable roof area)');
  }

  const params = {
    shape: 'rect',
    length: round2(L), width: round2(W),
    wallHeight: h, storeys, roofPitch, roofType: 'hip',
    windows: clamp(windows, 0, 60, 6), doors: clamp(doors, 0, 20, 1),
    wallType: 'cavity', roofCovering: 'concrete_tile',
    ohpPct: 15, vatPct: 20,
  };
  return {
    params,
    notes,
    signals: { slabArea: round2(slabArea), wallArea: round2(wallArea), roofArea: round2(roofArea), windows, doors, storeys, footprint: round2(footprint), perimeter: round2(perimeter) },
  };
}

module.exports = {
  normaliseInputs,
  computeQuantities,
  buildRecipe,
  priceModel,
  deriveParamsFromBoq,
  generateFootprint,
  polyArea,
  polyPerimeter,
  WALL_TYPES,
  ROOF_COVERINGS,
  SHAPES,
};
