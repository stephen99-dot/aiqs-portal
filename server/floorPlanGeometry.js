// ═══════════════════════════════════════════════════════════════════════════
// FLOOR PLAN GEOMETRY — server/floorPlanGeometry.js
//
// Turns a RoomPlan capture into the flat, measured lines a floor plan is made
// of. Pure maths, no drawing and no PDF — so it can be tested on its own, and
// floorPlanPdf.js can stay about ink.
//
// RoomPlan describes every wall, door and window as a box: `dimensions`
// [width, height, thickness] in metres, and a 4×4 `transform` saying where
// that box sits and which way it faces. Y is up, so the floor is the XZ plane
// and a plan view is simply "ignore Y".
//
// A wall's length runs along its own local X axis. Rotating that axis by the
// transform gives the direction the wall runs in the room, and the transform's
// last column is its centre — so the wall is a line segment of `width` metres,
// centred there, pointing that way. Doors and windows are the same shape and
// are matched onto whichever wall they lie along.
// ═══════════════════════════════════════════════════════════════════════════

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }

// simd hands us 16 numbers column by column, so column c row r is m[c * 4 + r].
function col(m, c) {
  return { x: num(m[c * 4]), y: num(m[c * 4 + 1]), z: num(m[c * 4 + 2]) };
}

/**
 * One surface → a line on the floor.
 *
 * Returns null for anything without a usable transform, so a partial scan
 * degrades to a plan of the walls it did get rather than throwing.
 */
function segmentOf(surface) {
  const dims = surface && (surface.dimensions || surface.dimension || surface.size);
  const m = surface && surface.transform;
  if (!Array.isArray(dims) || !Array.isArray(m) || m.length < 16) return null;

  const width = num(dims[0]);
  if (width <= 0.01) return null;

  const centre = col(m, 3);          // where it is
  const along = col(m, 0);           // its local X axis, rotated into the room

  // Flatten to the floor. A wall leaning a degree or two off vertical still
  // reads as a straight line in plan, which is what a plan wants.
  const len = Math.hypot(along.x, along.z);
  if (len < 1e-6) return null;
  const dx = along.x / len;
  const dz = along.z / len;
  const half = width / 2;

  return {
    a: { x: centre.x - dx * half, z: centre.z - dz * half },
    b: { x: centre.x + dx * half, z: centre.z + dz * half },
    centre: { x: centre.x, z: centre.z },
    width,
    height: num(dims[1]),
    thickness: num(dims[2]),
  };
}

function segmentsOf(list) {
  return (Array.isArray(list) ? list : []).map(segmentOf).filter(Boolean);
}

/**
 * A thing's footprint on the floor, as its four corners.
 *
 * Walls use this to be drawn as solid bodies rather than fat lines, and
 * furniture uses it to be drawn as the rectangle it occupies. `depth` is the
 * box's third dimension for an object, or its thickness for a wall.
 */
function footprint(seg, depth) {
  const vx = seg.b.x - seg.a.x;
  const vz = seg.b.z - seg.a.z;
  const len = Math.hypot(vx, vz) || 1;
  // The direction across the thing, at right angles to its length.
  const nx = -vz / len;
  const nz = vx / len;
  const h = Math.max(depth, 0.02) / 2;   // never zero-width, or it vanishes
  return [
    { x: seg.a.x + nx * h, z: seg.a.z + nz * h },
    { x: seg.b.x + nx * h, z: seg.b.z + nz * h },
    { x: seg.b.x - nx * h, z: seg.b.z - nz * h },
    { x: seg.a.x - nx * h, z: seg.a.z - nz * h },
  ];
}

/** Furniture: the same box maths, kept with its category for labelling. */
function objectsOf(list) {
  return (Array.isArray(list) ? list : []).map((o) => {
    const seg = segmentOf(o);
    if (!seg) return null;
    const dims = o.dimensions || [];
    const depth = num(dims[2]) || 0.4;
    return {
      category: String(o.category || 'object').replace(/([A-Z])/g, ' $1').trim().toLowerCase(),
      centre: seg.centre,
      corners: footprint(seg, depth),
      width: seg.width,
      depth,
    };
  }).filter(Boolean);
}

/** Distance from a point to a segment, and how far along that segment it lands. */
function projectOnto(seg, p) {
  const vx = seg.b.x - seg.a.x;
  const vz = seg.b.z - seg.a.z;
  const lenSq = vx * vx + vz * vz;
  if (lenSq < 1e-9) return { distance: Infinity, t: 0 };
  let t = ((p.x - seg.a.x) * vx + (p.z - seg.a.z) * vz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = seg.a.x + vx * t;
  const cz = seg.a.z + vz * t;
  return { distance: Math.hypot(p.x - cx, p.z - cz), t };
}

/**
 * Put each opening on the wall it belongs to.
 *
 * RoomPlan reports doors and windows separately from walls with no link
 * between them, so the plan has to work out which wall each one interrupts.
 * The nearest wall within half a metre wins — openings sit in their wall, so
 * anything further away is a scanning artefact and is better dropped than
 * drawn through the middle of a room.
 */
function assignOpenings(walls, openings, kind) {
  for (const opening of openings) {
    let best = null;
    let bestDist = 0.5;
    for (const wall of walls) {
      const { distance, t } = projectOnto(wall, opening.centre);
      if (distance < bestDist) { bestDist = distance; best = { wall, t }; }
    }
    if (!best) continue;
    // Where along the wall it starts and stops, as a fraction, so the drawing
    // can break the wall line there whatever scale it ends up at.
    const span = opening.width / Math.max(best.wall.width, 1e-6) / 2;
    best.wall.openings = best.wall.openings || [];
    best.wall.openings.push({
      kind,
      from: Math.max(0, best.t - span),
      to: Math.min(1, best.t + span),
      width: opening.width,
      height: opening.height,
    });
  }
}

/**
 * A RoomPlan capture → everything needed to draw it.
 *
 * Lengths are metres throughout; the drawing decides its own scale.
 */
function planOf(room, label) {
  const walls = segmentsOf(room && room.walls);
  const doors = segmentsOf(room && room.doors);
  const windows = segmentsOf(room && room.windows);
  const openingGaps = segmentsOf(room && room.openings);

  assignOpenings(walls, doors, 'door');
  assignOpenings(walls, windows, 'window');
  assignOpenings(walls, openingGaps, 'opening');

  for (const w of walls) {
    if (w.openings) w.openings.sort((p, q) => p.from - q.from);
  }

  const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
  const zs = walls.flatMap((w) => [w.a.z, w.b.z]);
  const bounds = xs.length
    ? { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
    : { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

  const outline = roomOutline(walls);

  return {
    label: label || 'Room',
    walls,
    // The room's own shape, for filling the floor and placing its name in the
    // middle of it rather than guessing at a centre.
    outline,
    centroid: outline.length
      ? centroidOf(outline)
      : { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 },
    objects: objectsOf(room && room.objects),
    bounds,
    // The tallest wall is the ceiling height; a short one is a scanning
    // artefact or a stub, not the room.
    height: walls.reduce((h, w) => Math.max(h, w.height), 0),
    floorArea: polygonArea(walls),
    perimeter: walls.reduce((s, w) => s + w.width, 0),
    doorCount: doors.length,
    windowCount: windows.length,
  };
}

// Two wall ends this close together are the same corner. RoomPlan's corners
// rarely meet exactly; the outline is tried at the tightest tolerance first
// (so a 30 cm chimney-breast jog survives) and loosened only when nothing
// closes at it.
const CORNER_TOLERANCES_M = [0.25, 0.4, 0.7, 1.0];
const CORNER_TOLERANCE_M = CORNER_TOLERANCES_M[1];

function dist(p, q) { return Math.hypot(p.x - q.x, p.z - q.z); }

/**
 * The outline of a scanned room: which walls go round it, in walking order,
 * and which the scanner saw inside it.
 *
 * RoomPlan lists walls in whatever order they were scanned, with corners that
 * rarely meet exactly, and it often throws in walls that are not part of the
 * outline at all: the front of a built-in wardrobe read as a wall, a
 * half-height partition, a stub where the scan began. Chaining nearest ends
 * blindly stitches those in, the walk crosses itself and the floor is drawn
 * (and measured) as a figure of eight.
 *
 * So the outline is found the way a drawing is read. Wall ends within a corner
 * tolerance are one corner. A wall with a loose end — nothing meets it — is
 * inside the room, not round it, and so is anything that only hangs off such
 * a wall. Where a wall still cuts across the room with both ends on corners,
 * the walk round the outside keeps to the outside: at each corner it takes the
 * outermost turn. When nothing closes at any tolerance the scan left a gap,
 * and the walls are simply chained by nearest ends as a best effort.
 *
 * Returns { points, order, interior, closed }: the corners in walking order;
 * the walls in that order as { index, reversed }; the indices of walls left
 * out of the outline; whether the outline closed.
 */
function traceOutline(walls) {
  const list = Array.isArray(walls) ? walls : [];
  for (const tol of CORNER_TOLERANCES_M) {
    const found = traceAt(list, tol);
    if (found) return found;
  }
  return greedyOutline(list);
}

function traceAt(walls, tol) {
  const n = walls.length;
  if (n < 3) return null;
  // Corners: wall ends within the tolerance of each other, merged transitively.
  const ends = [];
  walls.forEach((w, i) => { ends.push({ w: i, p: w.a }); ends.push({ w: i, p: w.b }); });
  const parent = ends.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      if (ends[i].w === ends[j].w) continue;
      if (dist(ends[i].p, ends[j].p) <= tol) parent[find(i)] = find(j);
    }
  }
  const nodeOf = new Map();
  const nodes = [];
  ends.forEach((e, i) => {
    const root = find(i);
    if (!nodeOf.has(root)) { nodeOf.set(root, nodes.length); nodes.push({ x: 0, z: 0, count: 0 }); }
    const node = nodes[nodeOf.get(root)];
    node.x += e.p.x; node.z += e.p.z; node.count += 1;
  });
  for (const node of nodes) { node.x /= node.count; node.z /= node.count; }
  const endNode = (i) => nodeOf.get(find(i));
  // Each wall is an edge between two corners. A wall whose ends fell into the
  // same corner is shorter than the tolerance: a stub, left out.
  const edges = [];
  for (let i = 0; i < n; i++) {
    const u = endNode(i * 2); const v = endNode(i * 2 + 1);
    if (u !== v) edges.push({ wall: i, u, v, alive: true });
  }
  // Peel off anything with a loose end, and whatever is left hanging after it.
  let peeled = true;
  while (peeled) {
    peeled = false;
    const degree = new Map();
    for (const e of edges) if (e.alive) { degree.set(e.u, (degree.get(e.u) || 0) + 1); degree.set(e.v, (degree.get(e.v) || 0) + 1); }
    for (const e of edges) if (e.alive && ((degree.get(e.u) || 0) < 2 || (degree.get(e.v) || 0) < 2)) { e.alive = false; peeled = true; }
  }
  const live = edges.filter((e) => e.alive);
  if (live.length < 3) return null;
  // Walk round the outside. Start at the leftmost corner (which must be on
  // the outline) as if arriving from further left, and at every corner take
  // the edge that is the smallest turn clockwise from the way back.
  const at = new Map();
  for (const e of live) {
    if (!at.has(e.u)) at.set(e.u, []);
    if (!at.has(e.v)) at.set(e.v, []);
    at.get(e.u).push({ e, to: e.v, reversed: false });
    at.get(e.v).push({ e, to: e.u, reversed: true });
  }
  let start = null;
  for (const id of at.keys()) if (start === null || nodes[id].x < nodes[start].x - 1e-9 || (Math.abs(nodes[id].x - nodes[start].x) <= 1e-9 && nodes[id].z < nodes[start].z)) start = id;
  const angle = (from, to) => Math.atan2(nodes[to].z - nodes[from].z, nodes[to].x - nodes[from].x);
  const turn = (back, a) => { let t = back - a; while (t < 0) t += 2 * Math.PI; while (t >= 2 * Math.PI) t -= 2 * Math.PI; return t; };
  const order = []; const points = [];
  let here = start; let back = Math.PI; let arrived = null;
  for (let step = 0; step <= live.length; step++) {
    const options = at.get(here).filter((o) => o.e !== arrived || at.get(here).length === 1);
    if (!options.length) return null;
    let best = options[0]; let bestTurn = Infinity;
    for (const o of options) { const t = turn(back, angle(here, o.to)); if (t < bestTurn) { bestTurn = t; best = o; } }
    if (order.some((x) => x.index === best.e.wall)) return null;   // looped without closing
    points.push({ x: nodes[here].x, z: nodes[here].z });
    order.push({ index: best.e.wall, reversed: best.reversed });
    back = angle(best.to, here); arrived = best.e; here = best.to;
    if (here === start) break;
  }
  if (here !== start || order.length < 3) return null;
  if (selfIntersects(points)) return null;
  const onOutline = new Set(order.map((o) => o.index));
  const interior = [];
  for (let i = 0; i < n; i++) if (!onOutline.has(i)) interior.push(i);
  return { points, order, interior, closed: true, tolerance: tol };
}

// Does the polygon cross itself? Only non-adjacent sides are compared.
function selfIntersects(pts) {
  const n = pts.length;
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const crosses = (p, q, r, s) => {
    const d1 = cross(r, s, p); const d2 = cross(r, s, q); const d3 = cross(p, q, r); const d4 = cross(p, q, s);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (crosses(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

// Nothing closed: chain every wall by its nearest end, as a best effort, and
// say so (closed: false). The old behaviour, kept for scans with a gap.
function greedyOutline(walls) {
  const n = walls.length;
  if (!n) return { points: [], order: [], interior: [], closed: false };
  const used = new Set([0]);
  const order = [{ index: 0, reversed: false }];
  const points = [walls[0].a];
  let cursor = walls[0].b;
  while (used.size < n) {
    let best = -1; let bestD = Infinity; let reversed = false;
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      if (dist(walls[i].a, cursor) < bestD) { bestD = dist(walls[i].a, cursor); best = i; reversed = false; }
      if (dist(walls[i].b, cursor) < bestD) { bestD = dist(walls[i].b, cursor); best = i; reversed = true; }
    }
    if (best < 0) break;
    used.add(best);
    const w = walls[best];
    points.push(reversed ? w.b : w.a);
    order.push({ index: best, reversed });
    cursor = reversed ? w.a : w.b;
  }
  return { points, order, interior: [], closed: false };
}

/**
 * The outline of the room, as the corners in the order you'd walk them.
 * See traceOutline; this is just its corners.
 */
function roomOutline(walls) {
  if (!walls || walls.length < 3) return [];
  return traceOutline(walls).points;
}

/**
 * Where to write the room's name: the centroid of its area, not the average of
 * its corners. On an L-shape the corner average drifts towards whichever leg
 * has more corners, and can land outside the room entirely.
 */
function centroidOf(outline) {
  if (outline.length < 3) {
    if (!outline.length) return { x: 0, z: 0 };
    return {
      x: outline.reduce((t, p) => t + p.x, 0) / outline.length,
      z: outline.reduce((t, p) => t + p.z, 0) / outline.length,
    };
  }
  let twiceArea = 0;
  let x = 0;
  let z = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    const cross = p.x * q.z - q.x * p.z;
    twiceArea += cross;
    x += (p.x + q.x) * cross;
    z += (p.z + q.z) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) return outline[0];
  return { x: x / (3 * twiceArea), z: z / (3 * twiceArea) };
}

/**
 * Floor area from the room's outline rather than length × width.
 *
 * The shoelace formula over the corners, which is right for an L-shape or a
 * bay where multiplying the two longest walls together is not.
 *
 * It has to be the corners: an earlier version used the wall midpoints, which
 * for a plain rectangle traces a diamond inside it and reports exactly half
 * the real floor area.
 */
function polygonArea(walls) {
  const outline = roomOutline(walls);
  if (outline.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    sum += p.x * q.z - q.x * p.z;
  }
  return Math.abs(sum) / 2;
}

module.exports = { planOf, segmentOf, segmentsOf, polygonArea, projectOnto, roomOutline, traceOutline, footprint, objectsOf, centroidOf, CORNER_TOLERANCE_M };
