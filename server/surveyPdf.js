// ═══════════════════════════════════════════════════════════════════════════════
// ROOM SURVEYS — server/surveyPdf.js
//
// The survey report: a branded PDF of a property visit — a cover with the
// totals, then a page per room with its plan sketch, quantities, openings,
// what was counted, finishes and condition, the builder's notes, and the
// photographs. The document a builder hands a customer or sends to the AI QS
// team with the drawings. Pure rendering: the caller passes rows it has
// already authorised.
// ═══════════════════════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const G = require('./surveyGeometry');

const DATA_DIR = process.env.AIQS_DATA_DIR || (fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data'));
const brandingDir = path.join(DATA_DIR, 'branding');

const INK = '#14181F';
const MUTED = '#6B7A90';
const HAIR = '#D6DCE5';
const FLOOR = '#F4F7FB';
const GLASS = '#4C7DB5';

const fmt = (n, d = 1) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : '—');
const when = (v) => { const d = v ? new Date(String(v).replace(' ', 'T') + (String(v).endsWith('Z') ? '' : 'Z')) : new Date(); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };

function header(doc, branding, userInfo, title, subtitle) {
  const primary = (branding && branding.primary_colour) || '#1B2A4A';
  doc.rect(0, 0, doc.page.width, 78).fill(primary);
  let x = 40;
  if (branding && branding.logo_filename) {
    const logoPath = path.join(brandingDir, branding.logo_filename);
    if (fs.existsSync(logoPath) && /\.(png|jpe?g)$/i.test(branding.logo_filename)) {
      try { doc.image(logoPath, 40, 18, { fit: [110, 42] }); x = 165; } catch (e) { /* skip */ }
    }
  }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(17).text((branding && branding.company_name) || (userInfo && (userInfo.company || userInfo.full_name)) || 'Room survey', x, 22, { width: doc.page.width - x - 40, height: 22, ellipsis: true });
  doc.font('Helvetica').fontSize(9).text(title, x, 46, { width: doc.page.width - x - 40, height: 12, ellipsis: true });
  if (subtitle) doc.text(subtitle, x, 59, { width: doc.page.width - x - 40, height: 12, ellipsis: true });
  doc.fillColor(INK);
}

function footer(doc, text) {
  doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(text, 40, doc.page.height - 34, { width: doc.page.width - 80 });
  doc.fillColor(INK);
}

// The plan sketch: the room to fit a box — walls with the openings cut out,
// door swings, window lines, the wall letters, the overall size and the area.
// A scanned room is drawn from its capture (every wall where the scanner saw
// it, with the furniture), a typed one from its rectangle or L-shape.
function drawSketch(doc, room, q, box) {
  const scene = G.sceneOf(room);
  if (!scene) {
    doc.save().lineWidth(0.6).strokeColor(HAIR).dash(3, { space: 3 }).rect(box.x, box.y, box.w, box.h).stroke().undash().restore();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(room.shape === 'custom' ? (q.wall_count + ' walls · ' + fmt(q.perimeter_m, 2) + ' m perimeter') : 'No dimensions yet', box.x, box.y + box.h / 2 - 5, { width: box.w, align: 'center' });
    doc.fillColor(INK);
    return;
  }
  const pad = 26;
  const scale = Math.min((box.w - pad * 2) / Math.max(scene.bounds.w, 0.1), (box.h - pad * 2) / Math.max(scene.bounds.h, 0.1));
  const ox = box.x + (box.w - scene.bounds.w * scale) / 2;
  const oy = box.y + (box.h - scene.bounds.h * scale) / 2;
  const P = (p) => ({ x: ox + p.x * scale, y: oy + p.y * scale });
  const centre = P(scene.centroid);
  // The floor.
  if (scene.floor && scene.floor.length >= 3) {
    const pts = scene.floor.map(P);
    doc.save();
    doc.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) doc.lineTo(pts[i].x, pts[i].y); doc.closePath();
    doc.fillColor(FLOOR).fill();
    doc.restore();
  }
  // Furniture the scanner saw, drawn light so it never competes with the walls.
  for (const o of scene.objects || []) {
    const c = (o.corners || []).map(P);
    if (c.length < 3) continue;
    doc.save().lineWidth(0.4).strokeColor(HAIR).fillColor('#FFFFFF');
    doc.moveTo(c[0].x, c[0].y); for (let i = 1; i < c.length; i++) doc.lineTo(c[i].x, c[i].y); doc.closePath().fillAndStroke();
    doc.restore();
    const wOnPaper = o.width_m * scale;
    if (wOnPaper > 30) { const cc = P(o.centre); doc.font('Helvetica').fontSize(5).fillColor(HAIR).text(o.category, cc.x - wOnPaper / 2, cc.y - 3, { width: wOnPaper, align: 'center' }); }
  }
  // Walls the scanner saw inside the room: faint and dashed, not the outline.
  for (const seg of scene.interior || []) {
    const a = P(seg.a); const b = P(seg.b);
    doc.save().moveTo(a.x, a.y).lineTo(b.x, b.y).lineWidth(0.6).dash(2, { space: 1.5 }).strokeColor(HAIR).stroke().undash().restore();
  }
  // Walls as thick lines with the openings left out.
  for (const seg of scene.segments) {
    const a = P(seg.a); const b = P(seg.b);
    const ops = (seg.openings || []).slice().sort((x, y) => x.from - y.from);
    const runs = []; let cur = 0;
    for (const o of ops) { if (o.from > cur) runs.push([cur, o.from]); cur = Math.max(cur, o.to); }
    if (cur < 1) runs.push([cur, 1]);
    doc.save().lineWidth(3).strokeColor(INK).lineCap('butt');
    for (const [f, t] of runs) doc.moveTo(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f).lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t).stroke();
    doc.restore();
    const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
    // The normal that points into the room: towards the centroid, whichever
    // way round the scanner listed this wall.
    let nx = -dy / len; let ny = dx / len;
    const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
    if ((centre.x - mx) * nx + (centre.y - my) * ny < 0) { nx = -nx; ny = -ny; }
    for (const o of ops) {
      const s = { x: a.x + dx * o.from, y: a.y + dy * o.from }; const e = { x: a.x + dx * o.to, y: a.y + dy * o.to };
      const span = Math.hypot(e.x - s.x, e.y - s.y);
      doc.save();
      if (o.kind === 'window') {
        doc.lineWidth(1.2).strokeColor(GLASS).moveTo(s.x, s.y).lineTo(e.x, e.y).stroke();
        doc.lineWidth(0.5).strokeColor(INK).moveTo(s.x + nx * 1.5, s.y + ny * 1.5).lineTo(e.x + nx * 1.5, e.y + ny * 1.5).stroke().moveTo(s.x - nx * 1.5, s.y - ny * 1.5).lineTo(e.x - nx * 1.5, e.y - ny * 1.5).stroke();
      } else if (o.kind === 'door') {
        const ox2 = s.x + nx * span; const oy2 = s.y + ny * span;
        doc.lineWidth(0.9).strokeColor(INK).moveTo(s.x, s.y).lineTo(ox2, oy2).stroke();
        doc.lineWidth(0.5).strokeColor(MUTED).dash(2, { space: 2 }).moveTo(ox2, oy2).bezierCurveTo(ox2 + (e.x - s.x) * 0.5523, oy2 + (e.y - s.y) * 0.5523, e.x + nx * span * 0.5523, e.y + ny * span * 0.5523, e.x, e.y).stroke().undash();
      } else {
        doc.lineWidth(0.5).strokeColor(INK).moveTo(s.x + nx * 2, s.y + ny * 2).lineTo(s.x - nx * 2, s.y - ny * 2).stroke().moveTo(e.x + nx * 2, e.y + ny * 2).lineTo(e.x - nx * 2, e.y - ny * 2).stroke();
      }
      doc.restore();
    }
    // Wall letter, just outside the wall (skipped on stubs too short to label).
    if (seg.label && len > 14) {
      const lx = mx - nx * 9; const ly = my - ny * 9;
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(MUTED).text(seg.label, lx - 6, ly - 4, { width: 12, align: 'center' });
    }
  }
  // Overall dimensions and the area.
  doc.font('Helvetica').fontSize(7).fillColor(MUTED);
  doc.text(fmt(scene.length_m, 2) + ' m', ox, oy - 23, { width: scene.bounds.w * scale, align: 'center' });
  doc.save().translate(ox - 19, oy + scene.bounds.h * scale / 2).rotate(-90).text(fmt(scene.width_m, 2) + ' m', -30, -3, { width: 60, align: 'center' }).restore();
  doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(fmt(q.floor_m2, 1) + ' m²', centre.x - 40, centre.y - 5, { width: 80, align: 'center' });
  if (scene.kind === 'plan') doc.font('Helvetica').fontSize(6).fillColor(MUTED).text('LiDAR scan · ' + scene.segments.length + ' walls' + (scene.interior && scene.interior.length ? ' · ' + scene.interior.length + ' inside' : ''), centre.x - 50, centre.y + 6, { width: 100, align: 'center' });
  doc.fillColor(INK);
}

function kv(doc, rows, x, y, w, opts = {}) {
  const lh = opts.lineHeight || 13;
  rows.forEach(([k, v], i) => {
    const yy = y + i * lh;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(k, x, yy, { width: w * 0.55 });
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK).text(v, x + w * 0.55, yy, { width: w * 0.45, align: 'right' });
  });
  return y + rows.length * lh;
}

function sectionTitle(doc, text, y) {
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(text, 40, y);
  doc.save().lineWidth(0.5).strokeColor(HAIR).moveTo(40, y + 14).lineTo(doc.page.width - 40, y + 14).stroke().restore();
  return y + 20;
}

function paragraph(doc, text, y, width) {
  doc.font('Helvetica').fontSize(8.5).fillColor(INK);
  const h = doc.heightOfString(text, { width });
  doc.text(text, 40, y, { width });
  return y + h + 6;
}

// rooms: [{ room (parsed), quantities, photos: [{ path, caption, kind, ai_notes }] }]
function streamSurveyPdf(res, { survey, rooms, branding, userInfo }) {
  const safe = String(survey.title || 'survey').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + safe + '-survey.pdf"');
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: 'Room survey — ' + (survey.title || '') } });
  doc.pipe(res);
  const W = doc.page.width - 80;
  const DISCLAIMER = 'Dimensions marked estimated were read from photographs by AI and are a guide only; stated dimensions were given by the surveyor; measured dimensions came from a LiDAR scan. Check critical dimensions on site before ordering or cutting.';

  // ── Cover ──
  header(doc, branding, userInfo, 'Room survey', when(survey.created_at));
  let y = 100;
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(survey.title || 'Room survey', 40, y, { width: W });
  y += doc.heightOfString(survey.title || 'Room survey', { width: W }) + 4;
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  for (const line of [survey.address, survey.customer_name ? 'Customer: ' + survey.customer_name : null, 'Surveyed ' + when(survey.created_at) + (rooms.length ? ' · ' + rooms.length + ' room' + (rooms.length === 1 ? '' : 's') : '')].filter(Boolean)) { doc.text(line, 40, y, { width: W }); y += 14; }
  y += 10;
  const totals = rooms.reduce((t, r) => { const q = r.quantities || {}; t.floor += q.floor_m2 || 0; t.wall += q.wall_net_m2 || 0; t.ceiling += q.ceiling_m2 || 0; t.perimeter += q.perimeter_m || 0; t.doors += q.doors || 0; t.windows += q.windows || 0; t.photos += (r.photos || []).length; return t; }, { floor: 0, wall: 0, ceiling: 0, perimeter: 0, doors: 0, windows: 0, photos: 0 });
  y = sectionTitle(doc, 'Totals across the property', y);
  y = kv(doc, [['Floor area', fmt(totals.floor) + ' m²'], ['Ceiling area', fmt(totals.ceiling) + ' m²'], ['Wall area (net of openings)', fmt(totals.wall) + ' m²'], ['Perimeter / skirting run', fmt(totals.perimeter) + ' m'], ['Doors / windows', totals.doors + ' / ' + totals.windows], ['Photographs', String(totals.photos)]], 40, y, W * 0.6);
  y += 12;
  y = sectionTitle(doc, 'Rooms', y);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED);
  const cols = [['Room', 0, 150], ['Floor', 150, 60], ['Size (m)', 210, 90], ['Floor m²', 300, 55], ['Walls m²', 355, 55], ['Doors/Win', 410, 55], ['Status', 465, 50]];
  for (const [t, x, w] of cols) doc.text(t, 40 + x, y, { width: w, align: x > 200 ? 'right' : 'left' });
  y += 12;
  doc.font('Helvetica').fontSize(8).fillColor(INK);
  for (const r of rooms) {
    const q = r.quantities || {}; const rm = r.room;
    const vals = [rm.name || 'Room', rm.floor_level || '—', q.complete ? fmt(rm.length_m, 2) + ' × ' + fmt(rm.width_m, 2) + ' × ' + fmt(q.height_m, 2) : '—', q.complete ? fmt(q.floor_m2) : '—', q.complete ? fmt(q.wall_net_m2) : '—', (q.doors || 0) + ' / ' + (q.windows || 0), (rm.dims_source || 'unknown').replace('unknown', 'no size')];
    cols.forEach(([t, x, w], i) => doc.text(vals[i], 40 + x, y, { width: w, align: x > 200 ? 'right' : 'left', ellipsis: true, height: 11 }));
    y += 13;
    if (y > doc.page.height - 80) { doc.addPage(); y = 50; }
  }
  if (survey.notes) { y += 10; y = sectionTitle(doc, 'Notes', y); y = paragraph(doc, String(survey.notes).slice(0, 2000), y, W); }
  footer(doc, DISCLAIMER);

  // ── One page (or more) per room ──
  for (const r of rooms) {
    const rm = r.room; const q = r.quantities || {};
    doc.addPage();
    header(doc, branding, userInfo, (survey.title || 'Room survey') + ' — ' + (rm.name || 'Room'), [rm.room_type, rm.floor_level ? rm.floor_level + ' floor' : null].filter(Boolean).join(' · '));
    y = 96;
    doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(rm.name || 'Room', 40, y, { width: W * 0.6 });
    const srcLabel = { measured: 'Measured (LiDAR)', stated: 'Dimensions stated', estimated: 'Estimated from photos', unknown: 'No dimensions' }[rm.dims_source || 'unknown'];
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(srcLabel + (rm.confidence ? ' · AI confidence ' + rm.confidence : ''), 40, y + 20, { width: W * 0.6 });
    y += 40;
    // Sketch left, quantities right.
    const box = { x: 40, y, w: 250, h: 190 };
    drawSketch(doc, rm, q, box);
    let ry = y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Quantities', 310, ry); ry += 14;
    ry = kv(doc, [
      [rm.shape === 'custom' ? 'Overall extent × height' : 'Length × width × height', q.complete ? fmt(rm.length_m, 2) + ' × ' + fmt(rm.width_m, 2) + ' × ' + fmt(q.height_m, 2) + ' m' : '—'],
      ['Floor area', fmt(q.floor_m2) + ' m²'], ['Ceiling area', fmt(q.ceiling_m2) + ' m²'],
      ['Wall area gross', fmt(q.wall_gross_m2) + ' m²'], ['Openings deducted', fmt(q.openings_m2) + ' m²'], ['Wall area net', fmt(q.wall_net_m2) + ' m²'],
      ['Perimeter', fmt(q.perimeter_m, 2) + ' m'], ['Skirting', fmt(q.skirting_m, 2) + ' m'], ['Coving / cornice', fmt(q.coving_m, 2) + ' m'],
      ['Volume', fmt(q.volume_m3) + ' m³'], ['Doors / windows / openings', (q.doors || 0) + ' / ' + (q.windows || 0) + ' / ' + (q.openings || 0)],
    ], 310, ry, W - 270, { lineHeight: 12.5 });
    y = Math.max(box.y + box.h, ry) + 14;

    const openings = G.openingsOf(rm);
    if (openings.length) {
      y = sectionTitle(doc, 'Openings', y);
      doc.font('Helvetica').fontSize(8).fillColor(INK);
      for (const o of openings) { doc.text(o.count + ' × ' + o.kind + ' — ' + fmt(o.width_m, 2) + ' × ' + fmt(o.height_m, 2) + ' m' + (o.wall ? ' on wall ' + o.wall : '') + (o.notes ? ' · ' + o.notes : '') + (o.source === 'ai' ? '  (AI)' : o.source === 'measured' ? '  (measured)' : ''), 48, y, { width: W - 8 }); y += 12; }
      y += 6;
    }
    const features = G.parseJson(rm.features, []);
    if (Array.isArray(features) && features.length) {
      y = sectionTitle(doc, 'Counted in the room', y);
      doc.font('Helvetica').fontSize(8).fillColor(INK);
      const colW = (W - 8) / 2; let col = 0; const startY = y;
      features.forEach((f, i) => {
        const x = 48 + col * colW; const yy = startY + Math.floor(i / 2) * 12;
        doc.text(Math.round(G.num(f.count)) + ' × ' + f.item + (f.notes ? ' — ' + f.notes : ''), x, yy, { width: colW - 10, height: 11, ellipsis: true });
        col = (col + 1) % 2;
      });
      y = startY + Math.ceil(features.length / 2) * 12 + 6;
    }
    const fin = G.parseJson(rm.finishes, null);
    const hazards = G.parseJson(rm.hazards, []);
    if ((fin && typeof fin === 'object') || (Array.isArray(hazards) && hazards.length) || rm.condition_notes) {
      if (y > doc.page.height - 160) { doc.addPage(); y = 50; }
      y = sectionTitle(doc, 'Finishes and condition', y);
      const rows = [];
      if (fin) for (const k of ['floor', 'walls', 'ceiling', 'woodwork']) if (fin[k] && (fin[k].type || fin[k].condition)) rows.push([k.charAt(0).toUpperCase() + k.slice(1), [fin[k].type, fin[k].condition, fin[k].notes].filter(Boolean).join(' · ')]);
      if (rows.length) y = kv(doc, rows, 40, y, W);
      if (Array.isArray(hazards) && hazards.length) y = paragraph(doc, 'Watch-outs: ' + hazards.join('; ') + '.', y + 2, W);
      if (rm.condition_notes) y = paragraph(doc, String(rm.condition_notes), y, W);
    }
    const assumptions = G.parseJson(rm.assumptions, []);
    if (rm.ai_summary || (Array.isArray(assumptions) && assumptions.length)) {
      if (y > doc.page.height - 140) { doc.addPage(); y = 50; }
      y = sectionTitle(doc, 'Survey notes', y);
      if (rm.ai_summary) y = paragraph(doc, rm.ai_summary, y, W);
      if (Array.isArray(assumptions) && assumptions.length) y = paragraph(doc, 'Assumptions: ' + assumptions.join(' '), y, W);
    }
    const notes = G.parseJson(rm.notes, []);
    if (rm.work_wanted || (Array.isArray(notes) && notes.length)) {
      if (y > doc.page.height - 140) { doc.addPage(); y = 50; }
      y = sectionTitle(doc, 'Builder\'s notes', y);
      if (rm.work_wanted) y = paragraph(doc, 'Work wanted: ' + rm.work_wanted, y, W);
      for (const n of (Array.isArray(notes) ? notes : [])) y = paragraph(doc, '• ' + n.text, y, W);
    }
    const allPhotos = (r.photos || []).filter((p) => p.path && fs.existsSync(p.path));
    // The finished room: each render beside the photo it was painted from.
    const renders = allPhotos.filter((p) => p.kind === 'render').slice(0, 4);
    if (renders.length) {
      const cellW = (W - 12) / 2; const cellH = 160;
      renders.forEach((rp, i) => {
        if (y + cellH + 44 > doc.page.height - 50) { doc.addPage(); y = 50; }
        if (i === 0) y = sectionTitle(doc, 'The finished room — AI concept of the work described, not to scale', y);
        const src = allPhotos.find((p) => p.id === rp.render_of) || allPhotos.find((p) => p.kind !== 'render');
        if (src) { try { doc.image(src.path, 40, y, { fit: [cellW, cellH], align: 'center', valign: 'center' }); } catch (e) { /* unreadable */ } }
        try { doc.image(rp.path, 40 + cellW + 12, y, { fit: [cellW, cellH], align: 'center', valign: 'center' }); } catch (e) { /* unreadable */ }
        doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED).text('NOW', 40, y + cellH + 3, { width: cellW });
        doc.font('Helvetica-Bold').fontSize(7).fillColor(INK).text('AFTER THE WORK', 40 + cellW + 12, y + cellH + 3, { width: cellW });
        const note = String(rp.caption || '').replace(/^Finished room\s*[—-]?\s*/, '');
        if (note) doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(note.slice(0, 160), 40 + cellW + 12, y + cellH + 12, { width: cellW, height: 10, ellipsis: true });
        y += cellH + 30;
      });
    }
    const photos = allPhotos.filter((p) => p.kind !== 'render').slice(0, 8);
    if (photos.length) {
      const cellW = (W - 12) / 2; const cellH = 150;
      photos.forEach((p, i) => {
        if (i % 2 === 0 && y + cellH + 30 > doc.page.height - 50) { doc.addPage(); y = 50; }
        if (i === 0 || (i % 2 === 0 && y === 50)) { if (i === 0) y = sectionTitle(doc, 'Photographs', y); }
        const x = 40 + (i % 2) * (cellW + 12);
        try { doc.image(p.path, x, y, { fit: [cellW, cellH], align: 'center', valign: 'center' }); } catch (e) { /* unreadable image */ }
        const label = [(p.kind && p.kind !== 'general' ? p.kind : null), p.caption, p.ai_notes].filter(Boolean).join(' · ');
        doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(label.slice(0, 160) || 'Photo ' + (i + 1), x, y + cellH + 3, { width: cellW, height: 20, ellipsis: true });
        if (i % 2 === 1 || i === photos.length - 1) y += cellH + 28;
      });
    }
    footer(doc, DISCLAIMER);
  }
  doc.end();
}

module.exports = { streamSurveyPdf, drawSketch };
