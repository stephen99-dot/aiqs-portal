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

// Streams the PDF into `res`. result = priceModel() output; branding =
// user_branding row (or defaults); userInfo = users row; name = model name.
function streamBuilder3dPdf(res, name, result, branding, userInfo) {
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

  // Title + key dimensions.
  const m = result.inputs || {};
  const q = result.quantities || {};
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(14).text(name || 'Outline estimate', 40, 110);
  doc.font('Helvetica').fontSize(10).fillColor('#444444');
  const shapeLabel = { rect: 'Rectangular', L: 'L-shaped', T: 'T-shaped', U: 'U-shaped' }[m.shape] || m.shape;
  doc.text(
    `${shapeLabel} • ${m.length}m × ${m.width}m • ${m.storeys} storey(s) • ${m.roofType} roof @ ${m.roofPitch}°`,
    40, 130,
  );
  doc.text(`Footprint ${num(q.footprint)} m²  ·  GIA ${num(q.floorArea)} m²  ·  perimeter ${num(q.perimeter)} m`, 40, 144);

  let y = 168;

  const COLS = {
    desc: { x: 40, w: 290 },
    qty: { x: 335, w: 55, align: 'right' },
    unit: { x: 392, w: 28 },
    rate: { x: 420, w: 60, align: 'right' },
    total: { x: 482, w: 73, align: 'right' },
  };
  function ensureRoom(h) { if (y + h > doc.page.height - 90) { doc.addPage(); y = 50; } }

  ensureRoom(20);
  doc.rect(40, y, 515, 18).fill(primary);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  doc.text('Element', COLS.desc.x + 4, y + 5, { width: COLS.desc.w - 4 });
  doc.text('Qty', COLS.qty.x, y + 5, { width: COLS.qty.w, align: 'right' });
  doc.text('Unit', COLS.unit.x, y + 5, { width: COLS.unit.w });
  doc.text('Rate', COLS.rate.x, y + 5, { width: COLS.rate.w, align: 'right' });
  doc.text('Total', COLS.total.x, y + 5, { width: COLS.total.w, align: 'right' });
  y += 18;

  for (const g of result.groups || []) {
    ensureRoom(20);
    doc.rect(40, y, 515, 16).fill(accent);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text(g.category, 44, y + 3);
    y += 16;
    for (const ln of g.items) {
      ensureRoom(15);
      doc.font('Helvetica').fontSize(9).fillColor('#111111');
      doc.text(ln.label, COLS.desc.x + 4, y + 2, { width: COLS.desc.w - 4 });
      doc.text(String(num(ln.qty)), COLS.qty.x, y + 2, { width: COLS.qty.w, align: 'right' });
      doc.text(String(ln.unit || ''), COLS.unit.x, y + 2, { width: COLS.unit.w });
      doc.text(fmtMoney(ln.rate), COLS.rate.x, y + 2, { width: COLS.rate.w, align: 'right' });
      doc.text(fmtMoney(ln.total), COLS.total.x, y + 2, { width: COLS.total.w, align: 'right' });
      doc.strokeColor('#e5e7eb').lineWidth(0.5).moveTo(40, y + 14).lineTo(555, y + 14).stroke();
      y += 14;
    }
    ensureRoom(16);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111');
    doc.text(g.category + ' subtotal', COLS.desc.x + 4, y + 3, { width: COLS.desc.w + 100 });
    doc.text(fmtMoney(g.subtotal), COLS.total.x, y + 3, { width: COLS.total.w, align: 'right' });
    y += 18;
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

  y = sy + 14;
  ensureRoom(40);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#888888')
    .text('Outline estimate generated from a parametric model and indicative rates. For budgeting only — not a fixed-price quotation. Quantities are derived from the modelled geometry; verify against drawings before ordering.', 40, y, { width: 515 });

  if (branding.footer_text) {
    doc.font('Helvetica').fontSize(8).fillColor('#666666').text(branding.footer_text, 40, doc.page.height - 60, { width: 515, align: 'center' });
  }

  doc.end();
}

module.exports = { streamBuilder3dPdf };
