// ═══════════════════════════════════════════════════════════════════════════
// FLOOR PLAN PDF — server/floorPlanPdf.js
//
// Draws the measured plan of a scanned room the way a floor plan is drawn:
// solid wall bodies with the openings cut out of them, a tinted floor, the
// room named and measured in the middle of it, door swings, window lines,
// furniture in outline, and a dimension string down each side.
//
// The maths is all in floorPlanGeometry.js. This file is only ink.
//
// It is a measured survey drawing, not an architect's drawing: it says what
// was scanned, at a stated scale, on a stated date. The scale is a real one
// (1:20, 1:50, 1:100…) rather than whatever happened to fit the page, so a
// length can be checked off the paper with a scale rule.
// ═══════════════════════════════════════════════════════════════════════════

const PDFDocument = require('pdfkit');
const { planOf, footprint } = require('./floorPlanGeometry');

// The scales a drawing is allowed to be at. Anything else and a scale rule is
// no use, so the plan takes the first one the room fits inside.
const SCALES = [10, 20, 25, 50, 100, 200, 500];

const PT_PER_MM = 72 / 25.4;

const INK = '#1B2A4A';        // walls, headings
const MUTED = '#6B7A90';      // dimensions, notes
const HAIRLINE = '#AEBACA';   // witness lines, furniture
const FLOOR = '#F4F7FB';      // the room itself
const GLASS = '#4C7DB5';      // windows

function fmtMM(m) {
  // Builders read plans in millimetres.
  return Math.round(m * 1000).toLocaleString('en-GB');
}

/** Room metres → page points, at a fixed scale, centred in the drawing area. */
function makeProjector(plan, scale, area) {
  const ptPerMetre = (1000 / scale) * PT_PER_MM;
  const widthM = plan.bounds.maxX - plan.bounds.minX;
  const depthM = plan.bounds.maxZ - plan.bounds.minZ;
  const originX = area.x + (area.width - widthM * ptPerMetre) / 2;
  const originY = area.y + (area.height - depthM * ptPerMetre) / 2;
  return {
    ptPerMetre,
    // z grows "into" the room; on paper that is down the page, which keeps the
    // plan the same way round as the phone was held.
    p: (x, z) => ({
      x: originX + (x - plan.bounds.minX) * ptPerMetre,
      y: originY + (z - plan.bounds.minZ) * ptPerMetre,
    }),
  };
}

/** The tightest standard scale the room still fits the page at. */
function chooseScale(plan, area) {
  const widthM = Math.max(plan.bounds.maxX - plan.bounds.minX, 0.1);
  const depthM = Math.max(plan.bounds.maxZ - plan.bounds.minZ, 0.1);
  for (const scale of SCALES) {
    const ptPerMetre = (1000 / scale) * PT_PER_MM;
    if (widthM * ptPerMetre <= area.width && depthM * ptPerMetre <= area.height) return scale;
  }
  return SCALES[SCALES.length - 1];
}

function polyPath(doc, points, proj) {
  points.forEach((pt, i) => {
    const s = proj.p(pt.x, pt.z);
    if (i === 0) doc.moveTo(s.x, s.y); else doc.lineTo(s.x, s.y);
  });
  doc.closePath();
}

/** The floor, so the room reads as a space rather than four lines. */
function drawFloor(doc, plan, proj) {
  if (plan.outline.length < 3) return;
  doc.save();
  polyPath(doc, plan.outline, proj);
  doc.fillColor(FLOOR).fill();
  doc.restore();
}

/**
 * A wall as a solid body with its openings cut out.
 *
 * Each unbroken run of wall is drawn as its own filled rectangle, so a door
 * leaves a genuine hole in the wall rather than a thin line drawn over it.
 */
function drawWall(doc, wall, proj) {
  const lerp = (t) => ({
    x: wall.a.x + (wall.b.x - wall.a.x) * t,
    z: wall.a.z + (wall.b.z - wall.a.z) * t,
  });
  const thickness = wall.thickness || 0.1;

  const runs = [];
  let cursor = 0;
  for (const o of wall.openings || []) {
    if (o.from > cursor) runs.push([cursor, o.from]);
    cursor = Math.max(cursor, o.to);
  }
  if (cursor < 1) runs.push([cursor, 1]);

  doc.save().fillColor(INK);
  for (const [from, to] of runs) {
    if (to - from < 0.002) continue;
    polyPath(doc, footprint({ a: lerp(from), b: lerp(to) }, thickness), proj);
    doc.fill();
  }
  doc.restore();
}

/** What sits in each hole: glass for a window, a swinging leaf for a door. */
function drawOpenings(doc, wall, proj) {
  const lerp = (t) => ({
    x: wall.a.x + (wall.b.x - wall.a.x) * t,
    z: wall.a.z + (wall.b.z - wall.a.z) * t,
  });

  for (const o of wall.openings || []) {
    const from = lerp(o.from);
    const to = lerp(o.to);
    const a = proj.p(from.x, from.z);
    const b = proj.p(to.x, to.z);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const span = Math.hypot(dx, dy);
    if (span < 1) continue;
    // Across the wall, for the frame and for swinging the door open.
    const nx = -dy / span;
    const ny = dx / span;
    const half = Math.max((wall.thickness || 0.1) * proj.ptPerMetre, 2) / 2;

    doc.save();
    if (o.kind === 'window') {
      // Glazing line down the middle, with the frame either side of it.
      doc.lineWidth(1.4).strokeColor(GLASS)
        .moveTo(a.x, a.y).lineTo(b.x, b.y).stroke();
      doc.lineWidth(0.6).strokeColor(INK)
        .moveTo(a.x + nx * half, a.y + ny * half).lineTo(b.x + nx * half, b.y + ny * half).stroke()
        .moveTo(a.x - nx * half, a.y - ny * half).lineTo(b.x - nx * half, b.y - ny * half).stroke();
    } else if (o.kind === 'door') {
      // The leaf, standing open at right angles, and the quarter-circle it
      // sweeps — the way a door is always shown on a plan.
      const hingeX = a.x;
      const hingeY = a.y;
      const openX = hingeX + nx * span;
      const openY = hingeY + ny * span;
      doc.lineWidth(1).strokeColor(INK)
        .moveTo(hingeX, hingeY).lineTo(openX, openY).stroke();
      doc.lineWidth(0.6).strokeColor(HAIRLINE).dash(2, { space: 2 })
        .moveTo(openX, openY)
        // Bezier control points at 4/3·tan(π/8)·r give a near-perfect quarter
        // circle, which is as close as a PDF curve gets to an arc.
        .bezierCurveTo(
          openX + dx * 0.5523, openY + dy * 0.5523,
          b.x + nx * span * 0.5523, b.y + ny * span * 0.5523,
          b.x, b.y
        )
        .stroke()
        .undash();
    } else {
      // A plain opening — no door, no glass. Show the reveals only.
      doc.lineWidth(0.6).strokeColor(INK)
        .moveTo(a.x + nx * half, a.y + ny * half).lineTo(a.x - nx * half, a.y - ny * half).stroke()
        .moveTo(b.x + nx * half, b.y + ny * half).lineTo(b.x - nx * half, b.y - ny * half).stroke();
    }
    doc.restore();
  }
}

/** Furniture, drawn light so it never competes with the building. */
function drawObjects(doc, plan, proj) {
  for (const o of plan.objects || []) {
    doc.save();
    polyPath(doc, o.corners, proj);
    doc.lineWidth(0.5).fillColor('#FFFFFF').strokeColor(HAIRLINE).fillAndStroke();
    doc.restore();
    const c = proj.p(o.centre.x, o.centre.z);
    const onPaper = o.width * proj.ptPerMetre;
    // Only name it if the name will fit inside the shape.
    if (onPaper > 34) {
      doc.fontSize(5.5).fillColor(HAIRLINE).font('Helvetica')
        .text(o.category, c.x - onPaper / 2, c.y - 3, { width: onPaper, align: 'center' });
    }
  }
}

/** The room's name and size, written in the middle of the floor. */
function drawRoomLabel(doc, plan, proj) {
  const c = proj.p(plan.centroid.x, plan.centroid.z);
  doc.fontSize(11).fillColor(INK).font('Helvetica-Bold')
    .text(plan.label, c.x - 90, c.y - 14, { width: 180, align: 'center' });
  doc.fontSize(8.5).fillColor(MUTED).font('Helvetica')
    .text(plan.floorArea.toFixed(1) + ' m²', c.x - 90, c.y + 1, { width: 180, align: 'center' });
}

/** One dimension: witness lines, tick ends and the length, written on top. */
function dimension(doc, from, to, offsetX, offsetY, label) {
  const ax = from.x + offsetX;
  const ay = from.y + offsetY;
  const bx = to.x + offsetX;
  const by = to.y + offsetY;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 8) return;

  doc.save().lineWidth(0.5).strokeColor(HAIRLINE);
  // Witness lines back to what is being measured.
  doc.moveTo(from.x, from.y).lineTo(ax, ay).stroke();
  doc.moveTo(to.x, to.y).lineTo(bx, by).stroke();
  doc.moveTo(ax, ay).lineTo(bx, by).stroke();
  // Surveyor's ticks rather than arrowheads — cleaner at small sizes.
  const tx = (dx / len) * 3;
  const ty = (dy / len) * 3;
  doc.lineWidth(0.9).strokeColor(MUTED)
    .moveTo(ax - tx - ty, ay - ty + tx).lineTo(ax + tx + ty, ay + ty - tx).stroke()
    .moveTo(bx - tx - ty, by - ty + tx).lineTo(bx + tx + ty, by + ty - tx).stroke();
  doc.restore();

  let angle = Math.atan2(dy, dx);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;   // never upside down
  doc.save();
  doc.translate((ax + bx) / 2, (ay + by) / 2).rotate((angle * 180) / Math.PI);
  doc.fontSize(7.5).fillColor(MUTED).font('Helvetica')
    .text(label, -40, -11, { width: 80, align: 'center' });
  doc.restore();
}

/** A dimension for every wall, set outside the room, plus the overall sizes. */
function drawDimensions(doc, plan, proj) {
  const centre = proj.p(plan.centroid.x, plan.centroid.z);
  const OFFSET = 14;

  for (const wall of plan.walls) {
    const a = proj.p(wall.a.x, wall.a.z);
    const b = proj.p(wall.b.x, wall.b.z);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Push the dimension to whichever side of the wall is away from the room.
    let nx = -dy / len;
    let ny = dx / len;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if ((midX + nx - centre.x) ** 2 + (midY + ny - centre.y) ** 2
        < (midX - centre.x) ** 2 + (midY - centre.y) ** 2) {
      nx = -nx; ny = -ny;
    }
    dimension(doc, a, b, nx * OFFSET, ny * OFFSET, fmtMM(wall.width));
  }

  // Overall width and depth, further out again.
  const tl = proj.p(plan.bounds.minX, plan.bounds.minZ);
  const br = proj.p(plan.bounds.maxX, plan.bounds.maxZ);
  const OUTER = 44;
  dimension(doc, { x: tl.x, y: br.y }, { x: br.x, y: br.y }, 0, OUTER,
    fmtMM(plan.bounds.maxX - plan.bounds.minX));
  dimension(doc, { x: br.x, y: tl.y }, { x: br.x, y: br.y }, OUTER, 0,
    fmtMM(plan.bounds.maxZ - plan.bounds.minZ));
}

function drawScaleBar(doc, proj, scale, x, y) {
  // A metre bar in alternating blocks, so a length can be stepped off by eye.
  const m = proj.ptPerMetre;
  const blocks = m < 40 ? 5 : 2;
  const block = m / blocks;
  doc.save();
  for (let i = 0; i < blocks; i++) {
    doc.rect(x + i * block, y, block, 4)
      .fillColor(i % 2 ? '#FFFFFF' : INK).strokeColor(INK).lineWidth(0.4).fillAndStroke();
  }
  doc.restore();
  doc.fontSize(7).fillColor(MUTED).font('Helvetica')
    .text('0', x - 3, y + 7)
    .text('1 m', x + m - 8, y + 7);
  doc.fontSize(8).fillColor(INK).font('Helvetica-Bold')
    .text('Scale 1:' + scale, x, y - 14);
}

/**
 * Stream a measured floor plan.
 *
 * rooms — [{ room, label }] where `room` is the RoomPlan capture.
 * Each room gets its own page: rooms scanned separately share no coordinate
 * space, so drawing them side by side would be inventing where they sit
 * relative to one another.
 */
function streamFloorPlanPdf(res, rooms, opts = {}) {
  const company = (opts.company || '').trim();
  const filename = (opts.filename || 'floor-plan') + '.pdf';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  doc.pipe(res);

  const usable = rooms.length ? rooms : [{ room: null, label: 'Room' }];
  const when = new Date(opts.date || Date.now())
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  usable.forEach((entry, index) => {
    if (index > 0) doc.addPage();
    const plan = planOf(entry.room, entry.label);

    // Room to breathe for two rings of dimensions on every side.
    const area = { x: 90, y: 96, width: doc.page.width - 250, height: doc.page.height - 200 };
    const scale = chooseScale(plan, area);
    const proj = makeProjector(plan, scale, area);

    // ── Header ──
    doc.fontSize(15).fillColor(INK).font('Helvetica-Bold').text(plan.label, 36, 32);
    doc.fontSize(8).fillColor(MUTED).font('Helvetica')
      .text([company, 'Measured floor plan', when].filter(Boolean).join('   ·   '), 36, 51);
    doc.save().lineWidth(0.5).strokeColor(HAIRLINE)
      .moveTo(36, 66).lineTo(doc.page.width - 36, 66).stroke().restore();

    if (plan.walls.length === 0) {
      doc.fontSize(11).fillColor(MUTED).text('No walls were captured in this scan.', 36, 120);
      return;
    }

    // Order matters: floor, then furniture, then walls over the top of both,
    // then the openings cut into them, then anything that must stay readable.
    drawFloor(doc, plan, proj);
    drawObjects(doc, plan, proj);
    for (const wall of plan.walls) drawWall(doc, wall, proj);
    for (const wall of plan.walls) drawOpenings(doc, wall, proj);
    drawDimensions(doc, plan, proj);
    drawRoomLabel(doc, plan, proj);

    // ── Title block ──
    const bx = doc.page.width - 196;
    const by = doc.page.height - 116;
    doc.save().lineWidth(0.5).strokeColor(HAIRLINE).rect(bx, by, 160, 82).stroke().restore();
    const rows = [
      ['Floor area', plan.floorArea.toFixed(1) + ' m²'],
      ['Wall area', (plan.perimeter * plan.height).toFixed(1) + ' m²'],
      ['Perimeter', plan.perimeter.toFixed(2) + ' m'],
      ['Ceiling height', plan.height.toFixed(2) + ' m'],
      ['Doors / windows', plan.doorCount + ' / ' + plan.windowCount],
    ];
    rows.forEach(([k, v], i) => {
      const y = by + 8 + i * 14;
      doc.fontSize(7.5).fillColor(MUTED).font('Helvetica').text(k, bx + 9, y);
      doc.fontSize(7.5).fillColor(INK).font('Helvetica-Bold').text(v, bx + 9, y, { width: 142, align: 'right' });
    });

    drawScaleBar(doc, proj, scale, 36, doc.page.height - 60);

    doc.fontSize(6.5).fillColor(MUTED).font('Helvetica').text(
      'Dimensions in millimetres, measured by LiDAR scan. Accurate to the scan and not a substitute for a survey — '
      + 'check critical dimensions on site before ordering or cutting.',
      36, doc.page.height - 30, { width: doc.page.width - 250 }
    );
  });

  doc.end();
}

module.exports = { streamFloorPlanPdf, chooseScale, makeProjector };
