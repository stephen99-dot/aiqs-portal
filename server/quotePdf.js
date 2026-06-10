// ═══════════════════════════════════════════════════════════════════════════════
// QUOTE PDF — server/quotePdf.js
//
// The branded quote PDF renderer, extracted from estimatorRoutes.js so the
// owner download route AND the public acceptance page (quotePublicRoutes.js)
// stream the exact same document. Pure rendering — no auth, no DB reads; the
// caller passes the quote, lines, branding and user rows it has already
// authorised.
// ═══════════════════════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function currencySymbol(code) {
  if (code === 'EUR') return '€';
  return '£';
}
function fmtMoney(n, code) {
  const v = num(n);
  return currencySymbol(code) + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Streams the PDF into `res` (sets headers). q = quotes row, lines = quote_lines
// rows, branding = user_branding row (or defaults), userInfo = users row.
function streamQuotePdf(res, q, lines, branding, userInfo) {
  const cc = q.currency || 'GBP';

  const filename = (q.quote_number || 'quote') + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);

  const primary = branding.primary_colour || '#1B2A4A';
  const accent = branding.accent_colour || '#F59E0B';

  // Header band
  doc.rect(0, 0, doc.page.width, 90).fill(primary);

  // Logo (if present)
  let titleX = 40;
  if (branding.logo_filename) {
    const logoPath = path.join(brandingDir, branding.logo_filename);
    if (fs.existsSync(logoPath) && /\.(png|jpe?g)$/i.test(branding.logo_filename)) {
      try {
        doc.image(logoPath, 40, 22, { fit: [120, 46] });
        titleX = 175;
      } catch (e) { /* bad image, skip */ }
    }
  }

  doc.fillColor('#ffffff')
    .font('Helvetica-Bold').fontSize(20)
    .text(branding.company_name || userInfo?.company || userInfo?.full_name || 'Quotation', titleX, 28);
  doc.font('Helvetica').fontSize(9)
    .text('Quote ' + (q.quote_number || ''), titleX, 56)
    .text(new Date(q.created_at || Date.now()).toLocaleDateString('en-GB'), titleX, 70);

  // Accepted banner — the signed audit record travels with the document.
  let bannerOffset = 0;
  if (q.status === 'accepted') {
    doc.rect(0, 92, doc.page.width, 18).fill('#10B981');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('ACCEPTED', 40, 96);
    bannerOffset = 20;
  }

  // Quote meta block
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(14)
    .text(q.project_name || 'Quotation', 40, 110 + bannerOffset);
  doc.font('Helvetica').fontSize(10).fillColor('#444444');
  let metaY = 130 + bannerOffset;
  if (q.client_name) { doc.text('Client: ' + q.client_name, 40, metaY); metaY += 14; }
  if (q.project_type) { doc.text('Project type: ' + q.project_type, 40, metaY); metaY += 14; }
  doc.text('Valid for 30 days from issue.', 40, metaY); metaY += 18;

  // Company contact block (right)
  let rightY = 110 + bannerOffset;
  doc.fontSize(9).fillColor('#333333');
  if (branding.company_name) { doc.text(branding.company_name, 360, rightY, { width: 200, align: 'right' }); rightY += 13; }
  if (branding.company_address) {
    const addrLines = String(branding.company_address).split(/\r?\n/);
    for (const ln of addrLines) { doc.text(ln, 360, rightY, { width: 200, align: 'right' }); rightY += 12; }
  }
  if (userInfo?.email) { doc.text(userInfo.email, 360, rightY, { width: 200, align: 'right' }); rightY += 12; }

  let y = Math.max(metaY, rightY) + 10;

  // Group lines by section
  const sections = {};
  const sectionOrder = [];
  for (const ln of lines) {
    const s = ln.section || 'General';
    if (!sections[s]) { sections[s] = []; sectionOrder.push(s); }
    sections[s].push(ln);
  }

  // Column layout
  const COLS = {
    desc: { x: 40, w: 270 },
    qty:  { x: 315, w: 35, align: 'right' },
    unit: { x: 355, w: 35, align: 'left' },
    rate: { x: 395, w: 70, align: 'right' },
    total:{ x: 470, w: 85, align: 'right' },
  };

  function ensureRoom(h) {
    if (y + h > doc.page.height - 80) {
      doc.addPage();
      y = 50;
    }
  }

  function drawHeaderRow() {
    ensureRoom(22);
    doc.rect(40, y, 515, 18).fill(primary);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
    doc.text('Description', COLS.desc.x + 4, y + 5, { width: COLS.desc.w - 4 });
    doc.text('Qty',  COLS.qty.x,  y + 5, { width: COLS.qty.w,  align: 'right' });
    doc.text('Unit', COLS.unit.x, y + 5, { width: COLS.unit.w });
    doc.text('Rate', COLS.rate.x, y + 5, { width: COLS.rate.w, align: 'right' });
    doc.text('Total',COLS.total.x,y + 5, { width: COLS.total.w,align: 'right' });
    y += 18;
    doc.fillColor('#111111').font('Helvetica').fontSize(9);
  }

  drawHeaderRow();

  for (const sec of sectionOrder) {
    ensureRoom(20);
    doc.rect(40, y, 515, 16).fill(accent);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text(sec, 44, y + 3);
    y += 16;
    doc.fillColor('#111111').font('Helvetica').fontSize(9);

    let sectionSubtotal = 0;
    for (const ln of sections[sec]) {
      const descText = (ln.item ? ln.item + ' — ' : '') + (ln.description || '');
      const descHeight = doc.heightOfString(descText, { width: COLS.desc.w - 4 });
      const rowH = Math.max(14, descHeight + 4);
      ensureRoom(rowH);

      const isEst = ln.est_rate ? true : false;
      doc.font('Helvetica').fontSize(9).fillColor('#111111');
      doc.text(descText, COLS.desc.x + 4, y + 2, { width: COLS.desc.w - 4 });
      doc.text(String(num(ln.qty)), COLS.qty.x, y + 2, { width: COLS.qty.w, align: 'right' });
      doc.text(String(ln.unit || ''), COLS.unit.x, y + 2, { width: COLS.unit.w });
      const rateText = fmtMoney(ln.rate, cc) + (isEst ? ' *' : '');
      if (isEst) doc.fillColor('#B45309');
      doc.text(rateText, COLS.rate.x, y + 2, { width: COLS.rate.w, align: 'right' });
      doc.fillColor('#111111');
      doc.text(fmtMoney(ln.line_total, cc), COLS.total.x, y + 2, { width: COLS.total.w, align: 'right' });

      // light divider
      doc.strokeColor('#e5e7eb').lineWidth(0.5).moveTo(40, y + rowH).lineTo(555, y + rowH).stroke();
      sectionSubtotal += num(ln.line_total);
      y += rowH;
    }

    // section subtotal
    ensureRoom(16);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111');
    doc.text(sec + ' subtotal', COLS.desc.x + 4, y + 3, { width: COLS.desc.w - 4 });
    doc.text(fmtMoney(sectionSubtotal, cc), COLS.total.x, y + 3, { width: COLS.total.w, align: 'right' });
    doc.font('Helvetica').fontSize(9);
    y += 18;
  }

  // Summary block
  ensureRoom(140);
  y += 10;
  doc.rect(310, y, 245, 130).strokeColor(primary).lineWidth(1).stroke();
  let sy = y + 8;
  function summaryRow(label, value, bold) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#111111');
    doc.text(label, 318, sy, { width: 140 });
    doc.text(value, 460, sy, { width: 90, align: 'right' });
    sy += 16;
  }
  summaryRow('Net', fmtMoney(q.net_total, cc));
  summaryRow('Overheads & profit (' + num(q.ohp_pct).toFixed(1) + '%)', fmtMoney(q.ohp_amount, cc));
  summaryRow('Contingency (' + num(q.contingency_pct).toFixed(1) + '%)', fmtMoney(q.contingency_amount, cc));
  summaryRow('VAT (' + num(q.vat_pct).toFixed(1) + '%)', fmtMoney(q.vat_amount, cc));
  sy += 4;
  doc.moveTo(315, sy).lineTo(550, sy).strokeColor('#cbd5e1').stroke();
  sy += 6;
  summaryRow('Grand Total', fmtMoney(q.grand_total, cc), true);
  y += 140;

  // est_rate marker explanation
  const anyEst = lines.some(l => l.est_rate);
  if (anyEst) {
    ensureRoom(24);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#B45309');
    doc.text('* Rate estimated by AI — no match in priced rate library. Confirm before issuing.', 40, y);
    doc.fillColor('#111111');
    y += 14;
  }

  // Acceptance audit block — same shape as the variation PDF's approved box.
  if (q.status === 'accepted' && q.accepted_at) {
    ensureRoom(70);
    y += 10;
    doc.rect(40, y, 515, 60).fill('#F0FDF4').strokeColor('#10B981').lineWidth(1).stroke();
    doc.fillColor('#065F46').font('Helvetica-Bold').fontSize(10).text('Accepted by client', 50, y + 8);
    doc.font('Helvetica').fontSize(9).fillColor('#065F46');
    doc.text('Name: ' + (q.acceptance_name || '—'), 50, y + 24);
    doc.text('Signed: ' + (q.acceptance_signature || '—'), 50, y + 38);
    doc.text('Date: ' + (q.accepted_at || ''), 280, y + 24);
    doc.text('IP: ' + (q.acceptance_ip || '—'), 280, y + 38);
    y += 70;
    doc.fillColor('#111111');
  }

  // Notes + terms
  if (q.notes) {
    ensureRoom(60);
    y += 10;
    doc.font('Helvetica-Bold').fontSize(10).text('Notes', 40, y); y += 14;
    doc.font('Helvetica').fontSize(9).fillColor('#333333').text(q.notes, 40, y, { width: 515 });
    const h = doc.heightOfString(q.notes, { width: 515 });
    y += h + 6;
    doc.fillColor('#111111');
  }

  // Footer
  const footY = doc.page.height - 50;
  doc.font('Helvetica').fontSize(8).fillColor('#666666')
    .text(branding.footer_text || 'This quotation is valid for 30 days from the date above. Prices exclude VAT unless stated.', 40, footY, { width: 515, align: 'center' });

  doc.end();
}

module.exports = { streamQuotePdf };
