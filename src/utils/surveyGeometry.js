// Client-side mirror of server/surveyGeometry.js, so the room page can show
// quantities and the plan sketch the instant a number changes. The server
// recomputes and stores the authoritative figures on every save; keep the two
// in step.

export const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const r2 = (n) => Math.round(num(n) * 100) / 100;
export const DEFAULT_HEIGHT = 2.4;
export const WALL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function wallsOf(room) {
  const H = num(room.height_m) || DEFAULT_HEIGHT;
  const L = num(room.length_m); const W = num(room.width_m);
  const shape = room.shape || 'rectangular';
  if (shape === 'custom') {
    return (Array.isArray(room.walls) ? room.walls : []).filter((w) => num(w.length_m) > 0).map((w, i) => ({ label: w.label || WALL_LABELS[i] || String(i + 1), length_m: r2(w.length_m), height_m: r2(num(w.height_m) || H) }));
  }
  if (L <= 0 || W <= 0) return [];
  if (shape === 'l_shape') {
    const a = Math.min(num(room.notch_length_m), L * 0.95);
    const b = Math.min(num(room.notch_width_m), W * 0.95);
    if (a > 0 && b > 0) {
      return [
        { label: 'A', length_m: r2(L), height_m: H }, { label: 'B', length_m: r2(W - b), height_m: H }, { label: 'C', length_m: r2(a), height_m: H },
        { label: 'D', length_m: r2(b), height_m: H }, { label: 'E', length_m: r2(L - a), height_m: H }, { label: 'F', length_m: r2(W), height_m: H },
      ];
    }
  }
  return [{ label: 'A', length_m: r2(L), height_m: H }, { label: 'B', length_m: r2(W), height_m: H }, { label: 'C', length_m: r2(L), height_m: H }, { label: 'D', length_m: r2(W), height_m: H }];
}

export function floorAreaOf(room) {
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

export function openingsOf(room) {
  return (Array.isArray(room.openings) ? room.openings : []).map((o, i) => ({
    id: o.id || 'op' + (i + 1), kind: ['door', 'window', 'opening'].includes(o.kind) ? o.kind : 'opening',
    width_m: r2(num(o.width_m)), height_m: r2(num(o.height_m)), count: Math.max(1, Math.round(num(o.count) || 1)), wall: o.wall || null, notes: o.notes || '', source: o.source || 'user',
  })).filter((o) => o.width_m > 0 && o.height_m > 0);
}

export function quantities(room) {
  const H = num(room.height_m) || DEFAULT_HEIGHT;
  const walls = wallsOf(room);
  const openings = openingsOf(room);
  const perimeter = walls.reduce((s, w) => s + w.length_m, 0);
  const floor = floorAreaOf(room);
  const wallGross = walls.reduce((s, w) => s + w.length_m * (num(w.height_m) || H), 0);
  const openingsArea = openings.reduce((s, o) => s + o.width_m * o.height_m * o.count, 0);
  const doorWidths = openings.filter((o) => o.kind !== 'window').reduce((s, o) => s + o.width_m * o.count, 0);
  return {
    complete: floor > 0 && perimeter > 0,
    height_m: r2(H), floor_m2: r2(floor), ceiling_m2: r2(floor), perimeter_m: r2(perimeter),
    wall_gross_m2: r2(wallGross), openings_m2: r2(openingsArea), wall_net_m2: r2(Math.max(0, wallGross - openingsArea)),
    skirting_m: r2(Math.max(0, perimeter - doorWidths)), coving_m: r2(perimeter), volume_m3: r2(floor * H),
    window_m2: r2(openings.filter((o) => o.kind === 'window').reduce((s, o) => s + o.width_m * o.height_m * o.count, 0)),
    doors: openings.filter((o) => o.kind === 'door').reduce((s, o) => s + o.count, 0),
    windows: openings.filter((o) => o.kind === 'window').reduce((s, o) => s + o.count, 0),
    openings: openings.filter((o) => o.kind === 'opening').reduce((s, o) => s + o.count, 0),
    walls, wall_count: walls.length,
  };
}

export function layoutOpenings(room) {
  const walls = wallsOf(room);
  const openings = openingsOf(room);
  if (!walls.length) return [];
  const byWall = new Map(walls.map((w) => [w.label, []]));
  const used = (label) => byWall.get(label).reduce((s, o) => s + o.width_m, 0);
  const assigned = openings.filter((o) => o.wall && byWall.has(o.wall));
  const loose = openings.filter((o) => !(o.wall && byWall.has(o.wall)));
  for (const o of assigned) for (let c = 0; c < o.count; c++) byWall.get(o.wall).push(o);
  for (const o of loose) {
    for (let c = 0; c < o.count; c++) {
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

export function outlineOf(room) {
  const L = num(room.length_m); const W = num(room.width_m);
  const shape = room.shape || 'rectangular';
  if (shape === 'custom' || L <= 0 || W <= 0) return null;
  if (shape === 'l_shape') {
    const a = Math.min(num(room.notch_length_m), L * 0.95);
    const b = Math.min(num(room.notch_width_m), W * 0.95);
    if (a > 0 && b > 0) return { points: [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W - b }, { x: L - a, y: W - b }, { x: L - a, y: W }, { x: 0, y: W }], bounds: { w: L, h: W } };
  }
  return { points: [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W }], bounds: { w: L, h: W } };
}

export const SOURCE_LABEL = { measured: 'Measured', stated: 'Stated', estimated: 'Estimated from photos', unknown: 'No size yet' };
export const SOURCE_TONE = { measured: 'success', stated: 'info', estimated: 'warning', unknown: 'neutral' };
export const ROOM_TYPES = ['Living room', 'Kitchen', 'Kitchen-diner', 'Dining room', 'Bedroom', 'Double bedroom', 'Bathroom', 'En-suite', 'WC', 'Hallway', 'Landing', 'Utility', 'Office', 'Conservatory', 'Garage', 'Loft', 'Other'];
export const FLOOR_LEVELS = ['Basement', 'Ground', 'First', 'Second', 'Loft', 'Outbuilding'];
export const QUICK_FEATURES = ['Double socket', 'Single socket', 'Light switch', 'Ceiling light', 'Spotlights', 'Radiator', 'TV point', 'Extractor fan', 'Coving', 'Alcove', 'Chimney breast', 'Built-in cupboard'];
export const HAZARD_PRESETS = ['Damp / staining', 'Cracking', 'Textured ceiling (possible Artex)', 'Exposed wiring', 'Rot', 'Mould', 'Uneven floor', 'Restricted access'];
export const OPENING_DEFAULTS = { door: { width_m: 0.84, height_m: 1.98 }, window: { width_m: 1.2, height_m: 1.2 }, opening: { width_m: 0.9, height_m: 2.0 } };
