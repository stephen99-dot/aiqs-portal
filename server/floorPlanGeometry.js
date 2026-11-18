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

// Two wall ends this close together are the same corner. Generous enough for
// RoomPlan's corners, which rarely meet exactly, and still far tighter than
// any two genuinely different corners of a room.
const CORNER_TOLERANCE_M = 0.4;

function dist(p, q) { return Math.hypot(p.x - q.x, p.z - q.z); }

/**
 * The outline of the room, as the corners in the order you'd walk them.
 *
 * RoomPlan lists walls in whatever order they were scanned, so the walls are
 * chained by their ends: each wall leads to whichever unused wall starts
 * nearest to where it finished. That recovers the true outline, including for
 * an L-shape, where sorting corners by angle around the middle would cut the
 * corner off.
 */
function roomOutline(walls) {
  if (walls.length < 3) return [];
  const used = new Set([0]);
  const outline = [walls[0].a, walls[0].b];
  let cursor = walls[0].b;

  for (let step = 1; step < walls.length; step++) {
    let bestIndex = -1;
    let bestDistance = CORNER_TOLERANCE_M;
    let bestFarEnd = null;
    for (let i = 0; i < walls.length; i++) {
      if (used.has(i)) continue;
      const w = walls[i];
      // A wall can be listed either way round, so try both of its ends.
      if (dist(w.a, cursor) < bestDistance) { bestDistance = dist(w.a, cursor); bestIndex = i; bestFarEnd = w.b; }
      if (dist(w.b, cursor) < bestDistance) { bestDistance = dist(w.b, cursor); bestIndex = i; bestFarEnd = w.a; }
    }
    if (bestIndex < 0) break;   // the scan left a gap — measure what we have
    used.add(bestIndex);
    outline.push(bestFarEnd);
    cursor = bestFarEnd;
  }

  // The last wall arrives back where the first one started, so the closing
  // corner is in the list twice. Harmless for area — the shoelace formula
  // closes the loop itself — but it doubles that corner's weight when
  // averaging, which drags the room's label off to one side of centre.
  while (outline.length > 2 && dist(outline[outline.length - 1], outline[0]) < CORNER_TOLERANCE_M) {
    outline.pop();
  }
  return outline;
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

module.exports = { planOf, segmentOf, segmentsOf, polygonArea, projectOnto, roomOutline, footprint, objectsOf, centroidOf };
