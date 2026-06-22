// ═══════════════════════════════════════════════════════════════════════════
// 3D BUILDER PDF — server/builder3dPdf.js
//
// Branded estimate PDF for a 3D Builder model. Mirrors the look of quotePdf.js
// (same header band, logo and colour tokens) so a builder's documents are
// consistent. Pure rendering — the caller passes the priced result, branding
// and user rows it has already authorised.
// ═══════════════════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function fmtMoney(n) {
  return '£' + num(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Decode a data-URL / base64 PNG into a Buffer for pdfkit. Returns null if the
// input isn't a usable raster.
function decodeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'string') return null;
  const m = snapshot.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
  const b64 = m ? m[2] : snapshot;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length > 100 ? buf : null;
  } catch (e) { return null; }
}

// Streams the PDF into `res`. result = priceModel() output; branding =
// user_branding row (or defaults); userInfo = users row; name = model name;
// snapshot = optional data-URL PNG of the 3D view to embed.
function streamBuilder3dPdf(res, name, result, branding, userInfo, snapshot) {
  const filename = (name || 'estimate').replace(/[^a-z0-9_-]+/gi, '_') + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  const primary = branding.primary_colour || '#1B2A4A';
  const accent = branding.accent_colour || '#F59E0B';

  // Header band + logo (identical treatment to the quote PDF).
  doc.rect(0, 0, doc.page.width, 90).fill(primary);
  let titleX = 40;
  if (branding.logo_filename) {
    const logoPath = path.join(brandingDir, branding.logo_filename);
    if (fs.existsSync(logoPath) && /\.(png|jpe?g)$/i.test(branding.logo_filename)) {
      try { doc.image(logoPath, 40, 22, { fit: [120, 46] }); titleX = 175; } catch (e) { /* skip */ }
    }
  }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
    .text(branding.company_name || userInfo?.company || userInfo?.full_name || 'Estimate', titleX, 28);
  doc.font('Helvetica').fontSize(9)
    .text('Outline estimate', titleX, 56)
    .text(new Date().toLocaleDateString('en-GB'), titleX, 70);

  // Title + key dimensions. Works for a single model or a composed project.
  const m = result.inputs || {};
  const q = result.quantities || {};
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(14).text(name || 'Outline estimate', 40, 110);
  doc.font('Helvetica').fontSize(10).fillColor('#444444');
  if (Array.isArray(result.modules) && result.modules.length) {
    doc.text(result.modules.map((mm) => mm.name).join(' + '), 40, 130);
    const floors = (result.measurements || []).find((g) => g.group === 'Floors');
    const fp = floors?.rows.find((r) => r.label === 'Footprint');
    const gia = floors?.rows.find((r) => r.label === 'Gross internal area');
    doc.text(`${result.modules.length} module(s)  ·  footprint ${num(fp?.value)} m²  ·  GIA ${num(gia?.value)} m²`, 40, 144);
  } else {
    const shapeLabel = { rect: 'Rectangular', L: 'L-shaped', T: 'T-shaped', U: 'U-shaped' }[m.shape] || m.shape;
    doc.text(`${shapeLabel} • ${m.length}m × ${m.width}m • ${m.storeys} storey(s) • ${m.roofType} roof @ ${m.roofPitch}°`, 40, 130);
    doc.text(`Footprint ${num(q.footprint)} m²  ·  GIA ${num(q.floorArea)} m²  ·  perimeter ${num(q.perimeter)} m`, 40, 144);
  }

  let y = 168;

  // 3D view — embed the snapshot the page captured, framed like a drawing.
  const img = decodeSnapshot(snapshot);
  if (img) {
    const boxX = 40, boxW = 515, boxH = 230;
    doc.save();
    doc.rect(boxX, y, boxW, boxH).fill('#eef2f7');
    try { doc.image(img, boxX + 6, y + 6, { fit: [boxW - 12, boxH - 12], align: 'center', valign: 'center' }); } catch (e) { /* skip bad image */ }
    doc.restore();
    doc.rect(boxX, y, boxW, boxH).strokeColor('#cbd5e1').lineWidth(1).stroke();
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#64748b').text('Indicative 3D model', boxX + 8, y + boxH - 14);
    y += boxH + 14;
  }

  const COLS = {
    desc: { x: 40, w: 290 },
    qty: { x: 335, w: 55, align: 'right' },
    unit: { x: 392, w: 28 },
    rate: { x: 420, w: 60, align: 'right' },
    total: { x: 482, w: 73, align: 'right' },
  };
  function ensureRoom(h) { if (y + h > doc.page.height - 90) { doc.addPage(); y = 50; } }

  const ROW_H = 17; // generous row pitch so nothing bunches
  // Single-line cell helper: never wrap (truncate with ellipsis) so a long label
  // can't overrun into the next row.
  const cell = (text, col, yPos, opts = {}) => doc.text(String(text), col.x + (opts.pad || 0), yPos, {
    width: col.w - (opts.pad || 0), align: col.align || 'left', lineBreak: false, ellipsis: true,
  });

  ensureRoom(20);
  doc.rect(40, y, 515, 18).fill(primary);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  cell('Element', COLS.desc, y + 6, { pad: 4 });
  cell('Qty', COLS.qty, y + 6);
  cell('Unit', COLS.unit, y + 6);
  cell('Rate', COLS.rate, y + 6);
  cell('Total', COLS.total, y + 6);
  y += 22;

  for (const g of result.groups || []) {
    ensureRoom(ROW_H + 8);
    doc.rect(40, y, 515, 16).fill(accent);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text(g.category, 44, y + 4, { lineBreak: false });
    y += 20;
    for (const ln of g.items) {
      ensureRoom(ROW_H);
      doc.font('Helvetica').fontSize(9).fillColor('#111111');
      cell(ln.label, COLS.desc, y + 3, { pad: 4 });
      cell(num(ln.qty), COLS.qty, y + 3);
      cell(ln.unit || '', COLS.unit, y + 3);
      cell(fmtMoney(ln.rate), COLS.rate, y + 3);
      cell(fmtMoney(ln.total), COLS.total, y + 3);
      doc.strokeColor('#eaecef').lineWidth(0.5).moveTo(40, y + ROW_H - 1).lineTo(555, y + ROW_H - 1).stroke();
      y += ROW_H;
    }
    ensureRoom(ROW_H + 4);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111');
    doc.text(g.category + ' subtotal', COLS.desc.x + 4, y + 4, { width: 300, lineBreak: false });
    cell(fmtMoney(g.subtotal), COLS.total, y + 4);
    y += ROW_H + 6;
  }

  // Totals box.
  const tot = result.totals || {};
  ensureRoom(120);
  y += 8;
  doc.rect(310, y, 245, 110).strokeColor(primary).lineWidth(1).stroke();
  let sy = y + 8;
  function row(label, value, bold) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10).fillColor('#111111');
    doc.text(label, 318, sy, { width: 150 });
    doc.text(value, 455, sy, { width: 92, align: 'right' });
    sy += bold ? 20 : 16;
  }
  row('Trade cost', fmtMoney(tot.cost));
  row(`OH&P (${num(m.ohpPct)}%)`, fmtMoney(tot.profit));
  row('Subtotal', fmtMoney(tot.subtotal), true);
  row(`VAT (${num(m.vatPct)}%)`, fmtMoney(tot.vat));
  row('Total', fmtMoney(tot.total), true);

  y = Math.max(sy, y) + 24;

  // Measurements summary — two columns of grouped element measurements.
  const measurements = result.measurements || [];
  if (measurements.length) {
    ensureRoom(34);
    doc.rect(40, y, 515, 20).fill(primary);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text('MEASUREMENTS SUMMARY', 44, y + 6, { lineBreak: false });
    y += 30;
    const colW = 250, gap = 15, MROW = 15;
    const colX = [40, 40 + colW + gap];
    const colY = [y, y];
    measurements.forEach((g, gi) => {
      const c = gi % 2;
      const blockH = 18 + g.rows.length * MROW + 10;
      if (colY[c] + blockH > doc.page.height - 70) { doc.addPage(); colY[0] = 50; colY[1] = 50; }
      let yy = colY[c];
      const x = colX[c];
      doc.rect(x, yy, colW, 16).fill(accent);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(g.group, x + 4, yy + 4, { lineBreak: false });
      yy += 20;
      for (const r of g.rows) {
        doc.font('Helvetica').fontSize(9).fillColor('#333333').text(r.label, x + 4, yy, { width: colW - 92, lineBreak: false, ellipsis: true });
        doc.font('Helvetica-Bold').fillColor('#111111').text(`${r.value} ${r.unit}`, x + colW - 86, yy, { width: 82, align: 'right', lineBreak: false });
        yy += MROW;
      }
      colY[c] = yy + 12;
    });
    y = Math.max(colY[0], colY[1]) + 6;
  }

  ensureRoom(40);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#888888')
    .text('Outline estimate generated from a parametric model and indicative trade rates, with material lines benchmarked against live supplier prices where available. For budgeting only — not a fixed-price quotation. Quantities are derived from the modelled geometry; verify against drawings before ordering.', 40, y, { width: 515 });

  if (branding.footer_text) {
    doc.font('Helvetica').fontSize(8).fillColor('#666666').text(branding.footer_text, 40, doc.page.height - 60, { width: 515, align: 'center' });
  }

  doc.end();
}

module.exports = { streamBuilder3dPdf };
