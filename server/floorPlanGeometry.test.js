const test = require('node:test');
const assert = require('node:assert');
const { planOf, segmentOf, polygonArea } = require('./floorPlanGeometry');

// A RoomPlan transform, built the way simd hands one over: 16 numbers, column
// by column. `angle` turns the wall about the vertical axis, so a wall at 0
// runs along X and one at 90° runs along Z.
function transform(x, z, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    c, 0, s, 0,      // local X, rotated about Y
    0, 1, 0, 0,      // up
    -s, 0, c, 0,     // local Z
    x, 0, z, 1,      // where it sits
  ];
}

// A plain 5m × 4m room, walls centred on the origin, 2.4m high.
function rectangularRoom() {
  return {
    walls: [
      { dimensions: [5, 2.4, 0.1], transform: transform(0, -2, 0) },    // back
      { dimensions: [5, 2.4, 0.1], transform: transform(0, 2, 0) },     // front
      { dimensions: [4, 2.4, 0.1], transform: transform(-2.5, 0, 90) }, // left
      { dimensions: [4, 2.4, 0.1], transform: transform(2.5, 0, 90) },  // right
    ],
    doors: [{ dimensions: [0.9, 2.0, 0.1], transform: transform(-1, 2, 0) }],
    windows: [{ dimensions: [1.2, 1.1, 0.1], transform: transform(0, -2, 0) }],
    openings: [],
    objects: [],
  };
}

test('a wall becomes a line of the right length in the right place', () => {
  const seg = segmentOf({ dimensions: [5, 2.4, 0.1], transform: transform(0, -2, 0) });
  assert.ok(Math.abs(seg.a.x - -2.5) < 1e-6, 'starts 2.5m left of centre');
  assert.ok(Math.abs(seg.b.x - 2.5) < 1e-6, 'ends 2.5m right of centre');
  assert.ok(Math.abs(seg.a.z - -2) < 1e-6 && Math.abs(seg.b.z - -2) < 1e-6, 'runs along z = -2');
  assert.ok(Math.abs(Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z) - 5) < 1e-6, 'is 5m long');
});

test('a rotated wall runs the other way', () => {
  const seg = segmentOf({ dimensions: [4, 2.4, 0.1], transform: transform(-2.5, 0, 90) });
  assert.ok(Math.abs(seg.a.x - -2.5) < 1e-6 && Math.abs(seg.b.x - -2.5) < 1e-6, 'stays on x = -2.5');
  assert.ok(Math.abs(Math.abs(seg.b.z - seg.a.z) - 4) < 1e-6, 'spans 4m in z');
});

test('the plan measures the room it was given', () => {
  const plan = planOf(rectangularRoom(), 'Living room');
  assert.strictEqual(plan.walls.length, 4);
  assert.ok(Math.abs(plan.floorArea - 20) < 0.2, `5 × 4 should be ~20m², got ${plan.floorArea}`);
  assert.ok(Math.abs(plan.perimeter - 18) < 1e-6, `perimeter should be 18m, got ${plan.perimeter}`);
  assert.ok(Math.abs(plan.height - 2.4) < 1e-6, 'ceiling height is the tallest wall');
  assert.strictEqual(plan.doorCount, 1);
  assert.strictEqual(plan.windowCount, 1);
});

test('bounds cover the whole room', () => {
  const { bounds } = planOf(rectangularRoom());
  assert.ok(Math.abs(bounds.minX - -2.5) < 1e-6 && Math.abs(bounds.maxX - 2.5) < 1e-6);
  assert.ok(Math.abs(bounds.minZ - -2) < 1e-6 && Math.abs(bounds.maxZ - 2) < 1e-6);
});

test('a door is placed on the wall it sits in, not the far side of the room', () => {
  const plan = planOf(rectangularRoom());
  const withDoor = plan.walls.filter((w) => (w.openings || []).some((o) => o.kind === 'door'));
  assert.strictEqual(withDoor.length, 1, 'exactly one wall gets the door');
  // The door is at x = -1 on a 5m wall running -2.5 → 2.5, so 1.5/5 = 0.3 along.
  const door = withDoor[0].openings.find((o) => o.kind === 'door');
  const middle = (door.from + door.to) / 2;
  assert.ok(Math.abs(middle - 0.3) < 0.02, `door should sit 30% along, got ${(middle * 100).toFixed(0)}%`);
  assert.ok(Math.abs((door.to - door.from) * 5 - 0.9) < 0.02, 'and be 0.9m wide');
});

test('an opening nowhere near a wall is dropped rather than drawn mid-room', () => {
  const room = rectangularRoom();
  room.doors.push({ dimensions: [0.9, 2, 0.1], transform: transform(0, 0, 0) }); // middle of the floor
  const plan = planOf(room);
  const placed = plan.walls.reduce((n, w) => n + (w.openings || []).length, 0);
  assert.strictEqual(placed, 2, 'only the real door and window are placed');
});

test('an L-shaped room is measured by its walls, not by length × width', () => {
  // 6×4 with a 2×2 bite out of one corner — 20m², where multiplying the two
  // longest walls would say 24m².
  const walls = [
    { dimensions: [6, 2.4, 0.1], transform: transform(0, -2, 0) },
    { dimensions: [4, 2.4, 0.1], transform: transform(3, 0, 90) },
    { dimensions: [2, 2.4, 0.1], transform: transform(2, 2, 0) },
    { dimensions: [2, 2.4, 0.1], transform: transform(1, 1, 90) },
    { dimensions: [4, 2.4, 0.1], transform: transform(-1, 0, 0) },
    { dimensions: [2, 2.4, 0.1], transform: transform(-3, -1, 90) },
  ];
  const plan = planOf({ walls, doors: [], windows: [], openings: [], objects: [] });
  // 6×4 is 24m²; the 2×2 bite taken out of the corner leaves 16m². Sorting
  // corners by angle instead of walking the walls would round it back up.
  assert.ok(Math.abs(plan.floorArea - 16) < 0.3, `L-shape should be ~16m², got ${plan.floorArea}`);
});

test('a scan with no usable geometry degrades instead of throwing', () => {
  const plan = planOf({ walls: [{ dimensions: [3, 2.4, 0.1] }], doors: [], windows: [] });
  assert.strictEqual(plan.walls.length, 0, 'a wall with no transform is skipped');
  assert.strictEqual(plan.floorArea, 0);
});

test('polygonArea needs three walls before it means anything', () => {
  assert.strictEqual(polygonArea([]), 0);
  assert.strictEqual(polygonArea([{ centre: { x: 0, z: 0 } }, { centre: { x: 1, z: 0 } }]), 0);
});

// ── Drawing: scale choice and projection ──────────────────────────────────
const { chooseScale, makeProjector } = require('./floorPlanPdf');

// The drawing area a landscape A4 page leaves once margins and the title
// block are taken off.
const A4_AREA = { x: 60, y: 70, width: 842 - 200, height: 595 - 150 };

test('a normal room is drawn at a scale a builder can measure off', () => {
  const plan = planOf(rectangularRoom());
  const scale = chooseScale(plan, A4_AREA);
  assert.ok([20, 25, 50].includes(scale), `expected a standard scale, got 1:${scale}`);
});

test('a big room falls back to a smaller scale rather than off the page', () => {
  const walls = [
    { dimensions: [18, 2.4, 0.1], transform: transform(0, -6, 0) },
    { dimensions: [18, 2.4, 0.1], transform: transform(0, 6, 0) },
    { dimensions: [12, 2.4, 0.1], transform: transform(-9, 0, 90) },
    { dimensions: [12, 2.4, 0.1], transform: transform(9, 0, 90) },
  ];
  const plan = planOf({ walls, doors: [], windows: [], openings: [] });
  const scale = chooseScale(plan, A4_AREA);
  const proj = makeProjector(plan, scale, A4_AREA);
  assert.ok(18 * proj.ptPerMetre <= A4_AREA.width, '18m fits across the page');
  assert.ok(12 * proj.ptPerMetre <= A4_AREA.height, '12m fits down the page');
});

test('the stated scale is the true scale on paper', () => {
  const plan = planOf(rectangularRoom());
  const scale = chooseScale(plan, A4_AREA);
  const proj = makeProjector(plan, scale, A4_AREA);
  // At 1:50, one metre is 20mm on paper, and a point is 1/72 inch.
  const expectedPt = (1000 / scale) * (72 / 25.4);
  assert.ok(Math.abs(proj.ptPerMetre - expectedPt) < 1e-9,
    `1:${scale} should put a metre at ${expectedPt.toFixed(2)}pt, got ${proj.ptPerMetre.toFixed(2)}pt`);
});

test('the room is centred inside the drawing area', () => {
  const plan = planOf(rectangularRoom());
  const scale = chooseScale(plan, A4_AREA);
  const proj = makeProjector(plan, scale, A4_AREA);
  const tl = proj.p(plan.bounds.minX, plan.bounds.minZ);
  const br = proj.p(plan.bounds.maxX, plan.bounds.maxZ);
  assert.ok(tl.x >= A4_AREA.x && tl.y >= A4_AREA.y, 'starts inside the area');
  assert.ok(br.x <= A4_AREA.x + A4_AREA.width && br.y <= A4_AREA.y + A4_AREA.height, 'ends inside it');
  const leftGap = tl.x - A4_AREA.x;
  const rightGap = (A4_AREA.x + A4_AREA.width) - br.x;
  assert.ok(Math.abs(leftGap - rightGap) < 0.5, 'equal margins left and right');
});

// ── The outline when the scanner saw more than the room ──────────────────────
const { traceOutline, roomOutline } = require('./floorPlanGeometry');
const segs = (walls) => require('./floorPlanGeometry').segmentsOf(walls);
const wall = (x, z, len, deg) => ({ dimensions: [len, 2.4, 0.1], transform: transform(x, z, deg) });
const area = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i]; const q = pts[(i + 1) % pts.length]; s += p.x * q.z - q.x * p.z; } return Math.abs(s) / 2; };

test('a wardrobe front read as a wall is left inside the room, not stitched into the outline', () => {
  // 7 × 4 room; a 2.4 m "wall" 0.6 m in from the back wall, both ends loose.
  const walls = segs([wall(0, -2, 7, 0), wall(3.5, 0, 4, 90), wall(0, 2, 7, 0), wall(-3.5, 0, 4, 90), wall(2, -1.4, 2.4, 0)]);
  const t = traceOutline(walls);
  assert.equal(t.closed, true);
  assert.deepEqual(t.interior, [4]);
  assert.equal(t.order.length, 4);
  assert.ok(Math.abs(area(t.points) - 28) < 0.05, 'the floor is the whole room: ' + area(t.points));
  assert.ok(Math.abs(polygonArea(walls) - 28) < 0.05);
});

test('a wall cutting across with both ends on corners is skipped by the walk round the outside', () => {
  const walls = segs([wall(0, -2, 7, 0), wall(3.5, 0, 4, 90), wall(0, 2, 7, 0), wall(-3.5, 0, 4, 90), wall(0, 0, 4, 90)]);
  const t = traceOutline(walls);
  assert.equal(t.closed, true);
  assert.deepEqual(t.interior, [4]);
  assert.ok(Math.abs(area(t.points) - 28) < 0.05);
});

test('a chimney breast — 30 cm jogs — stays in the outline', () => {
  // Back wall split round a breast 1.2 m wide and 0.3 m deep.
  const walls = segs([
    wall(-2.4, -2, 2.2, 0), wall(-1.3, -1.85, 0.3, 90), wall(-0.7, -1.7, 1.2, 0), wall(-0.1, -1.85, 0.3, 90), wall(1.7, -2, 3.6, 0),
    wall(3.5, 0, 4, 90), wall(0, 2, 7, 0), wall(-3.5, 0, 4, 90),
  ]);
  const t = traceOutline(walls);
  assert.equal(t.closed, true);
  assert.deepEqual(t.interior, []);
  assert.equal(t.order.length, 8);
  assert.ok(Math.abs(area(t.points) - (28 - 1.2 * 0.3)) < 0.05, area(t.points));
});

test('a corner the scanner left 60 cm open still closes, and a real gap falls back to chaining', () => {
  const open = segs([wall(0, -2, 7, 0), wall(3.5, 0.3, 3.4, 90), wall(0, 2, 7, 0), wall(-3.5, 0, 4, 90)]);
  const t = traceOutline(open);
  assert.equal(t.closed, true);
  assert.ok(t.tolerance >= 0.7, 'needed the loose tolerance: ' + t.tolerance);
  assert.ok(Math.abs(area(t.points) - 28) < 1.5);
  const gap = segs([wall(0, -2, 7, 0), wall(3.5, 1, 2, 90), wall(0, 2, 7, 0), wall(-3.5, 0, 4, 90)]);
  const g = traceOutline(gap);
  assert.equal(g.closed, false);
  assert.equal(g.order.length, 4, 'every wall is still drawn');
  assert.equal(roomOutline(gap).length, 4);
});

test('an L-shaped room with a loose stub where the scan began', () => {
  const walls = segs([wall(2, 0, 4, 0), wall(4, 1, 2, 90), wall(3, 2, 2, 0), wall(2, 3, 2, 90), wall(1, 4, 2, 0), wall(0, 2, 4, 90), wall(1, 1, 0.8, 45)]);
  const t = traceOutline(walls);
  assert.equal(t.closed, true);
  assert.deepEqual(t.interior, [6]);
  assert.ok(Math.abs(area(t.points) - 12) < 0.05, area(t.points));
});
