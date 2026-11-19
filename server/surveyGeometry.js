// ═══════════════════════════════════════════════════════════════════════════════
// ROOM SURVEYS — server/surveyGeometry.js
//
// The arithmetic behind a surveyed room: the quantities a trade prices from,
// worked out deterministically from what the builder (or the AI, or a LiDAR
// capture) recorded. Pure functions, no database, no model — the same maths
// runs on the client for the live preview (src/utils/surveyGeometry.js), so
// keep the two in step.
//
// Shapes
//   rectangular  length × width
//   l_shape      a length × width rectangle with a notch_length × notch_width
//                corner cut out — the perimeter is the same as the bounding
//                rectangle, the floor area is less the notch
//   custom       a list of walls (lengths) and a stated floor area, which is
//                what a LiDAR capture gives
//
// Openings deduct from the wall area; doors also shorten the skirting run.
// ═══════════════════════════════════════════════════════════════════════════════

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(num(n) * 100) / 100;
const r1 = (n) => Math.round(num(n) * 10) / 10;

const DEFAULT_HEIGHT = 2.4;
// A scanned room can have a dozen or more wall segments (bays, chimney
// breasts, boxed-in pipes), so the letters run the whole alphabet.
const WALL_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function parseJson(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { const x = JSON.parse(v); return x == null ? fallback : x; } catch (e) { return fallback; }
}

// The walls of the room as a list of { label, length_m, height_m }, derived
// from the shape unless the room carries its own (custom / LiDAR).
function wallsOf(room) {
  const H = num(room.height_m) || DEFAULT_HEIGHT;
  const L = num(room.length_m); const W = num(room.width_m);
  const shape = room.shape || 'rectangular';
  if (shape === 'custom') {
    const own = parseJson(room.walls, []);
    return (Array.isArray(own) ? own : []).filter((w) => num(w.length_m) > 0).map((w, i) => ({
      label: w.label || WALL_LABELS[i] || String(i + 1), length_m: r2(w.length_m), height_m: r2(num(w.height_m) || H),
    }));
  }
  if (L <= 0 || W <= 0) return [];
  if (shape === 'l_shape') {
    const a = Math.min(num(room.notch_length_m), L * 0.95);
    const b = Math.min(num(room.notch_width_m), W * 0.95);
    if (a > 0 && b > 0) {
      // Walking clockwise from the top-left: top (full length), right (down to
      // the notch), notch step in, notch step down, bottom (what's left), left.
      return [
        { label: 'A', length_m: r2(L), height_m: H },
        { label: 'B', length_m: r2(W - b), height_m: H },
        { label: 'C', length_m: r2(a), height_m: H },
        { label: 'D', length_m: r2(b), height_m: H },
        { label: 'E', length_m: r2(L - a), height_m: H },
        { label: 'F', length_m: r2(W), height_m: H },
      ];
    }
  }
  return [
    { label: 'A', length_m: r2(L), height_m: H },
    { label: 'B', length_m: r2(W), height_m: H },
    { label: 'C', length_m: r2(L), height_m: H },
    { label: 'D', length_m: r2(W), height_m: H },
  ];
}

function floorAreaOf(room, walls) {
  const shape = room.shape || 'rectangular';
  const override = num(room.floor_area_override_m2);
  if (shape === 'custom') return override > 0 ? override : 0;
  const L = num(room.length_m); const W = num(room.width_m);
  if (L <= 0 || W <= 0) return override > 0 ? override : 0;
  let area = L * W;
  if (shape === 'l_shape') {
    const a = Math.min(num(room.notch_length_m), L * 0.95);
    const b = Math.min(num(room.notch_width_m), W * 0.95);
    if (a > 0 && b > 0) area -= a * b;
  }
  return area;
}

// Normalise an openings list: kind, size, count, which wall.
function openingsOf(room) {
  const list = parseJson(room.openings, []);
  return (Array.isArray(list) ? list : []).map((o, i) => ({
    id: o.id || 'op' + (i + 1),
    kind: ['door', 'window', 'opening'].includes(o.kind) ? o.kind : 'opening',
    width_m: r2(num(o.width_m)),
    height_m: r2(num(o.height_m)),
    count: Math.max(1, Math.round(num(o.count) || 1)),
    wall: o.wall || null,
    notes: o.notes || '',
    source: o.source || 'user',
  })).filter((o) => o.width_m > 0 && o.height_m > 0);
}

// Everything a trade prices from, from one room row (JSON columns as stored).
function quantities(room) {
  const H = num(room.height_m) || DEFAULT_HEIGHT;
  const walls = wallsOf(room);
  const openings = openingsOf(room);
  const perimeter = walls.reduce((s, w) => s + w.length_m, 0);
  const floor = floorAreaOf(room, walls);
  const wallGross = walls.reduce((s, w) => s + w.length_m * (num(w.height_m) || H), 0);
  const openingsArea = openings.reduce((s, o) => s + o.width_m * o.height_m * o.count, 0);
  const doorWidths = openings.filter((o) => o.kind !== 'window').reduce((s, o) => s + o.width_m * o.count, 0);
  const doors = openings.filter((o) => o.kind === 'door').reduce((s, o) => s + o.count, 0);
  const windows = openings.filter((o) => o.kind === 'window').reduce((s, o) => s + o.count, 0);
  const plainOpenings = openings.filter((o) => o.kind === 'opening').reduce((s, o) => s + o.count, 0);
  const windowArea = openings.filter((o) => o.kind === 'window').reduce((s, o) => s + o.width_m * o.height_m * o.count, 0);
  const complete = floor > 0 && perimeter > 0;
  return {
    complete,
    height_m: r2(H),
    floor_m2: r2(floor),
    ceiling_m2: r2(floor),
    perimeter_m: r2(perimeter),
    wall_gross_m2: r2(wallGross),
    openings_m2: r2(openingsArea),
    wall_net_m2: r2(Math.max(0, wallGross - openingsArea)),
    skirting_m: r2(Math.max(0, perimeter - doorWidths)),
    coving_m: r2(perimeter),
    volume_m3: r2(floor * H),
    window_m2: r2(windowArea),
    doors, windows, openings: plainOpenings,
    walls,
    wall_count: walls.length,
  };
}

// Where each opening sits on the plan, for the sketch: openings are spread
// evenly along their wall (or, unassigned, along the walls in turn). Returns
// [{ opening, wall, from, to }] with from/to as fractions along the wall.
function layoutOpenings(room) {
  const walls = wallsOf(room);
  const openings = openingsOf(room);
  if (!walls.length) return [];
  const byWall = new Map(walls.map((w) => [w.label, []]));
  const used = (label) => byWall.get(label).reduce((s, o) => s + o.width_m, 0);
  // Assigned openings first, so the unassigned ones can find the emptiest wall.
  const assigned = openings.filter((o) => o.wall && byWall.has(o.wall));
  const loose = openings.filter((o) => !(o.wall && byWall.has(o.wall)));
  for (const o of assigned) for (let c = 0; c < o.count; c++) byWall.get(o.wall).push(o);
  for (const o of loose) {
    for (let c = 0; c < o.count; c++) {
      // The wall with the most free run takes it.
      let best = walls[0]; let bestFree = -Infinity;
      for (const w of walls) { const free = w.length_m - used(w.label); if (free > bestFree) { bestFree = free; best = w; } }
      byWall.get(best.label).push(o);
    }
  }
  const out = [];
  for (const w of walls) {
    const list = byWall.get(w.label);
    if (!list.length) continue;
    const total = list.reduce((s, o) => s + o.width_m, 0);
    const gap = Math.max(0, w.length_m - total) / (list.length + 1);
    let cursor = gap;
    for (const o of list) {
      const from = Math.max(0, Math.min(1, cursor / w.length_m));
      const to = Math.max(from, Math.min(1, (cursor + o.width_m) / w.length_m));
      out.push({ opening: o, wall: w.label, from, to });
      cursor += o.width_m + gap;
    }
  }
  return out;
}

// The polygon of the room in plan (metres, origin top-left, y down) and the
// wall segments with their labels — what the sketches draw from.
function outlineOf(room) {
  const L = num(room.length_m); const W = num(room.width_m);
  const shape = room.shape || 'rectangular';
  if (shape === 'custom' || L <= 0 || W <= 0) return null;
  if (shape === 'l_shape') {
    const a = Math.min(num(room.notch_length_m), L * 0.95);
    const b = Math.min(num(room.notch_width_m), W * 0.95);
    if (a > 0 && b > 0) {
      // Notch cut from the bottom-right corner.
      const pts = [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W - b }, { x: L - a, y: W - b }, { x: L - a, y: W }, { x: 0, y: W }];
      return { points: pts, bounds: { w: L, h: W } };
    }
  }
  return { points: [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W }], bounds: { w: L, h: W } };
}

// ── A measured room's plan, from its LiDAR capture ───────────────────────────
// floorPlanGeometry turns the capture into wall segments with the doors and
// windows placed on the walls the scanner saw them in. This puts that into
// plan coordinates (metres, x to the right, y down the page, origin at the
// top-left of the scan) so the sketch, the 3D view and the PDF can draw it
// the same way they draw a typed rectangle.
function planFromCapture(capture, name) {
  if (!capture || typeof capture !== 'object') return null;
  const FP = require('./floorPlanGeometry');
  let plan;
  try { plan = FP.planOf(capture, name || 'Room'); } catch (e) { return null; }
  if (!plan || !plan.walls.length) return null;
  const ox = plan.bounds.minX; const oz = plan.bounds.minZ;
  const P = (p) => ({ x: Math.round((p.x - ox) * 1000) / 1000, y: Math.round((p.z - oz) * 1000) / 1000 });
  const walls = plan.walls.map((w, i) => ({
    label: WALL_LABELS[i] || String(i + 1), a: P(w.a), b: P(w.b),
    length_m: r2(w.width), height_m: r2(w.height || plan.height || DEFAULT_HEIGHT), thickness_m: r2(w.thickness || 0.1),
    openings: (w.openings || []).map((o) => ({ kind: o.kind, from: Math.round(o.from * 1000) / 1000, to: Math.round(o.to * 1000) / 1000, width_m: r2(o.width), height_m: r2(o.height) })),
  }));
  const objects = (Array.isArray(capture.objects) ? capture.objects : []).map((o) => {
    const seg = FP.segmentOf(o);
    if (!seg) return null;
    const dims = o.dimensions || [];
    const depth = num(dims[2]) || 0.4;
    return {
      category: String(o.category || 'object').replace(/([A-Z])/g, ' $1').trim().toLowerCase(),
      centre: P(seg.centre), corners: FP.footprint(seg, depth).map(P),
      width_m: r2(seg.width), depth_m: r2(depth), height_m: r2(num(dims[1]) || 0.75),
    };
  }).filter(Boolean);
  return {
    walls, outline: plan.outline.map(P), centroid: P(plan.centroid),
    bounds: { w: r2(plan.bounds.maxX - ox), h: r2(plan.bounds.maxZ - oz) }, objects,
    floor_m2: r2(plan.floorArea), perimeter_m: r2(plan.perimeter), height_m: r2(plan.height || DEFAULT_HEIGHT),
  };
}

function polygonCentroid(pts) {
  if (!pts || pts.length < 3) return pts && pts.length ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length } : { x: 0, y: 0 };
  let twice = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]; const q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    twice += cross; cx += (p.x + q.x) * cross; cy += (p.y + q.y) * cross;
  }
  if (Math.abs(twice) < 1e-9) return pts[0];
  return { x: cx / (3 * twice), y: cy / (3 * twice) };
}

// Everything a drawing of the room needs, whichever way it was measured:
//   segments  the walls as { label, a, b, height_m, openings: [{ kind, from, to, width_m, height_m }] }
//   floor     the outline polygon to tint
//   bounds    { w, h } in metres; centroid; objects (furniture the scanner saw)
// A typed rectangle or L-shape comes from outlineOf/layoutOpenings; a scanned
// room from its capture (the row's JSON string, or an already-parsed object).
// Null when there is nothing to draw yet.
function sceneOf(room) {
  const shape = room.shape || 'rectangular';
  if (shape === 'custom') {
    const plan = room.plan && typeof room.plan === 'object' ? room.plan : planFromCapture(parseJson(room.capture, null), room.name);
    if (!plan) return null;
    return {
      kind: 'plan',
      segments: plan.walls.map((w) => ({ label: w.label, a: w.a, b: w.b, height_m: w.height_m, thickness_m: w.thickness_m, openings: w.openings })),
      floor: plan.outline, bounds: plan.bounds, centroid: plan.centroid, objects: plan.objects || [],
      floor_m2: plan.floor_m2, length_m: plan.bounds.w, width_m: plan.bounds.h, height_m: num(room.height_m) || plan.height_m,
    };
  }
  const outline = outlineOf(room);
  if (!outline) return null;
  const walls = wallsOf(room);
  const layout = layoutOpenings(room);
  const n = outline.points.length;
  const segments = outline.points.map((p, i) => {
    const label = walls[i] ? walls[i].label : null;
    return {
      label, a: p, b: outline.points[(i + 1) % n], height_m: walls[i] ? walls[i].height_m : (num(room.height_m) || DEFAULT_HEIGHT),
      openings: layout.filter((l) => l.wall === label).map((l) => ({ kind: l.opening.kind, from: l.from, to: l.to, width_m: l.opening.width_m, height_m: l.opening.height_m })),
    };
  });
  return {
    kind: 'outline', segments, floor: outline.points, bounds: outline.bounds, centroid: polygonCentroid(outline.points), objects: [],
    floor_m2: r2(floorAreaOf(room)), length_m: num(room.length_m), width_m: num(room.width_m), height_m: num(room.height_m) || DEFAULT_HEIGHT,
  };
}

// A short, factual description of a room for the pricing take-off: the
// quantities are stated as ground truth so the model measures nothing twice.
function describeForPricing(room, q, survey) {
  const src = { measured: 'measured by LiDAR scan', stated: 'dimensions given by the builder', estimated: 'estimated by AI from photos' }[room.dims_source] || 'dimensions not yet confirmed';
  const lines = [];
  lines.push('ROOM SURVEY: ' + (room.name || 'Room') + (room.room_type && room.room_type !== room.name ? ' (' + room.room_type + ')' : '') + (room.floor_level ? ', ' + room.floor_level + ' floor' : '') + (survey && survey.address ? ', at ' + survey.address : '') + '.');
  if (q && q.complete) {
    lines.push('Dimensions (' + src + '): ' + num(room.length_m) + 'm × ' + num(room.width_m) + 'm, ceiling ' + q.height_m + 'm' + (room.shape === 'l_shape' ? ', L-shaped' : room.shape === 'custom' ? ', ' + q.wall_count + ' walls' : '') + '.');
    lines.push('QUANTITIES — use these exactly for any area or length based item; do not re-measure:');
    lines.push('- Floor area ' + q.floor_m2 + ' m². Ceiling area ' + q.ceiling_m2 + ' m².');
    lines.push('- Wall area ' + q.wall_gross_m2 + ' m² gross, ' + q.wall_net_m2 + ' m² net of openings (' + q.openings_m2 + ' m² of doors/windows).');
    lines.push('- Perimeter ' + q.perimeter_m + ' m. Skirting ' + q.skirting_m + ' m. Coving/cornice ' + q.coving_m + ' m.');
    lines.push('- Doors ' + q.doors + ', windows ' + q.windows + (q.window_m2 ? ' (' + q.window_m2 + ' m² glazed)' : '') + (q.openings ? ', open doorways ' + q.openings : '') + '.');
  } else {
    lines.push('Dimensions not recorded yet — ask the builder for the room size before pricing area-based work.');
  }
  const features = parseJson(room.features, []);
  if (Array.isArray(features) && features.length) lines.push('Counted in the room: ' + features.filter((f) => num(f.count) > 0).map((f) => Math.round(num(f.count)) + ' × ' + f.item + (f.notes ? ' (' + f.notes + ')' : '')).join('; ') + '.');
  const fin = parseJson(room.finishes, null);
  if (fin && typeof fin === 'object') {
    const bits = ['floor', 'walls', 'ceiling', 'woodwork'].map((k) => fin[k] && (fin[k].type || fin[k].condition) ? k + ': ' + [fin[k].type, fin[k].condition ? fin[k].condition + ' condition' : null].filter(Boolean).join(', ') : null).filter(Boolean);
    if (bits.length) lines.push('Existing finishes — ' + bits.join('; ') + '.');
  }
  const hazards = parseJson(room.hazards, []);
  if (Array.isArray(hazards) && hazards.length) lines.push('Hazards / watch-outs: ' + hazards.join('; ') + '.');
  if (room.condition_notes) lines.push('Condition: ' + String(room.condition_notes).slice(0, 600));
  const notes = parseJson(room.notes, []);
  if (Array.isArray(notes) && notes.length) lines.push('Builder\'s notes: ' + notes.slice(-6).map((n) => n.text).join(' | ').slice(0, 800));
  if (room.work_wanted) lines.push('WORK TO PRICE (price only this): ' + String(room.work_wanted).slice(0, 800));
  return lines.join('\n');
}

module.exports = { quantities, wallsOf, openingsOf, layoutOpenings, outlineOf, floorAreaOf, planFromCapture, sceneOf, polygonCentroid, describeForPricing, parseJson, DEFAULT_HEIGHT, WALL_LABELS, num, r2, r1 };
