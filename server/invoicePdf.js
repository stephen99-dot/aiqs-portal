// ═══════════════════════════════════════════════════════════════════════════════
// INVOICE PDF — server/invoicePdf.js
//
// The branded invoice PDF renderer, extracted from invoiceRoutes.js so it can
// be (a) streamed to the owner download route, (b) streamed to the public
// /i/<token> page, and (c) rendered to a Buffer for email attachments (A2)
// and payment chasers (A3). Pure rendering — the caller passes rows it has
// already authorised.
// ═══════════════════════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function todayIso() { return new Date().toISOString().slice(0, 10); }
function currencySymbol(code) { return code === 'EUR' ? '€' : '£'; }
function fmtMoney(n, code) {
  const v = num(n);
  return currencySymbol(code) + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function overdueState(inv) {
  if (inv.status !== 'sent') return false;
  if (!inv.due_date) return false;
  return inv.due_date < todayIso();
}

// Draw the invoice onto an already-created PDFDocument.
function renderInvoicePdf(doc, inv, lines, branding, userInfo) {
  const cc = inv.currency || 'GBP';
  const primary = branding.primary_colour || '#1B2A4A';

  // Header band
  doc.rect(0, 0, doc.page.width, 90).fill(primary);
  let titleX = 40;
  if (branding.logo_filename) {
    const logoPath = path.join(brandingDir, branding.logo_filename);
    if (fs.existsSync(logoPath) && /\.(png|jpe?g)$/i.test(branding.logo_filename)) {
      try { doc.image(logoPath, 40, 22, { fit: [120, 46] }); titleX = 175; } catch (e) {}
    }
  }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
    .text(branding.company_name || userInfo?.company || userInfo?.full_name || 'Invoice', titleX, 28);
  doc.font('Helvetica').fontSize(9)
    .text('Invoice ' + (inv.invoice_number || ''), titleX, 56)
    .text('Issued ' + (inv.issue_date || ''), titleX, 70);

  // Status banner
  let topY = 92;
  if (inv.status === 'paid') {
    doc.rect(0, topY, doc.page.width, 18).fill('#10B981');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('PAID', 40, topY + 4);
    topY += 18;
  } else if (inv.status === 'void') {
    doc.rect(0, topY, doc.page.width, 18).fill('#94A3B8');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('VOID', 40, topY + 4);
    topY += 18;
  } else if (overdueState(inv)) {
    doc.rect(0, topY, doc.page.width, 18).fill('#EF4444');
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text('OVERDUE', 40, topY + 4);
    topY += 18;
  }

  // Two-column block: bill to + company details + dates
  let y = topY + 20;
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(11).text('Bill to', 40, y);
  doc.font('Helvetica').fontSize(10).fillColor('#333333');
  let by = y + 14;
  if (inv.client_name) { doc.text(inv.client_name, 40, by); by += 13; }
  if (inv.client_address) {
    const lns = String(inv.client_address).split(/\r?\n/);
    for (const ln of lns) { doc.text(ln, 40, by); by += 12; }
  }
  if (inv.client_email) { doc.text(inv.client_email, 40, by); by += 12; }

  // Right column
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(11).text('Invoice details', 320, y, { width: 235 });
  doc.font('Helvetica').fontSize(10).fillColor('#333333');
  doc.text('Invoice no.: ' + (inv.invoice_number || ''), 320, y + 14, { width: 235 });
  doc.text('Issued: ' + (inv.issue_date || ''), 320, y + 28, { width: 235 });
  doc.text('Due: ' + (inv.due_date || ''), 320, y + 42, { width: 235 });
  if (branding.company_address) {
    const lns = String(branding.company_address).split(/\r?\n/).slice(0, 3);
    let ry = y + 60;
    for (const ln of lns) { doc.text(ln, 320, ry, { width: 235 }); ry += 12; }
  }

  y = Math.max(by, y + 80) + 10;

  // Lines header
  doc.rect(40, y, 515, 18).fill(primary);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  doc.text('Description', 44, y + 5);
  doc.text('Qty',  330, y + 5, { width: 40, align: 'right' });
  doc.text('Unit', 375, y + 5);
  doc.text('Rate', 410, y + 5, { width: 65, align: 'right' });
  doc.text('Total',480, y + 5, { width: 75, align: 'right' });
  y += 18;
  doc.fillColor('#111111').font('Helvetica').fontSize(9);

  function ensureRoom(h) {
    if (y + h > doc.page.height - 80) { doc.addPage(); y = 50; }
  }

  const cisOn = !!inv.cis_applies;
  for (const ln of lines) {
    // Under CIS the labour/materials split must be visible line by line.
    const descText = (ln.item ? ln.item + ' — ' : '') + (ln.description || '')
      + (cisOn ? '  [' + (ln.is_labour ? 'Labour' : 'Materials') + ']' : '');
    const descH = doc.heightOfString(descText, { width: 280 });
    const rowH = Math.max(14, descH + 4);
    ensureRoom(rowH);
    doc.text(descText, 44, y + 2, { width: 280 });
    doc.text(String(num(ln.qty)), 330, y + 2, { width: 40, align: 'right' });
    doc.text(String(ln.unit || ''), 375, y + 2);
    doc.text(fmtMoney(ln.rate, cc), 410, y + 2, { width: 65, align: 'right' });
    doc.text(fmtMoney(ln.line_total, cc), 480, y + 2, { width: 75, align: 'right' });
    doc.strokeColor('#e5e7eb').lineWidth(0.5).moveTo(40, y + rowH).lineTo(555, y + rowH).stroke();
    y += rowH;
  }

  // Summary — grows when CIS rows are present.
  const cisRows = cisOn ? 3 : 0;
  const boxH = 100 + cisRows * 16;
  ensureRoom(boxH + 10);
  y += 10;
  doc.rect(310, y, 245, boxH).strokeColor(primary).lineWidth(1).stroke();
  let sy = y + 8;
  function row(label, value, bold) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#111111');
    doc.text(label, 318, sy, { width: 140 });
    doc.text(value, 460, sy, { width: 90, align: 'right' });
    sy += 16;
  }
  row('Net', fmtMoney(inv.net_total, cc));
  if (num(inv.discount_amount) > 0) row('Discount', '−' + fmtMoney(inv.discount_amount, cc));
  if (inv.reverse_charge) {
    row('VAT', 'Reverse charge');
  } else {
    row('VAT (' + num(inv.vat_pct).toFixed(1) + '%)', fmtMoney(inv.vat_amount, cc));
  }
  sy += 2;
  doc.moveTo(315, sy).lineTo(550, sy).strokeColor('#cbd5e1').stroke();
  sy += 4;
  row(cisOn ? 'Total (gross)' : 'Amount due', fmtMoney(inv.grand_total, cc), !cisOn);
  if (cisOn) {
    const rate = num(inv.cis_rate, 20);
    row('CIS deduction (' + rate.toFixed(0) + '% of labour ' + fmtMoney(inv.cis_labour_total, cc) + ')',
      '−' + fmtMoney(inv.cis_deduction, cc));
    row('Net payable', fmtMoney(num(inv.grand_total) - num(inv.cis_deduction), cc), true);
  }
  if (inv.status === 'paid' && num(inv.paid_amount) > 0) {
    row('Paid', fmtMoney(inv.paid_amount, cc));
  }
  y += boxH + 10;

  // A4 — domestic reverse charge wording (VAT Notice 735). The invoice must
  // say the reverse charge applies and show the VAT the customer accounts for.
  if (inv.reverse_charge) {
    const rcVat = Math.max(0, num(inv.net_total) - num(inv.discount_amount)) * (num(inv.vat_pct, 20) / 100);
    ensureRoom(60);
    doc.rect(40, y, 515, 50).fill('#FFFBEB').strokeColor('#F59E0B').lineWidth(1).stroke();
    doc.fillColor('#92400E').font('Helvetica-Bold').fontSize(10)
      .text('Reverse charge: customer to pay the VAT to HMRC (VAT Act 1994 Section 55A applies).', 50, y + 8, { width: 495 });
    doc.font('Helvetica').fontSize(9)
      .text('VAT to be accounted for by the customer at ' + num(inv.vat_pct, 20).toFixed(0) + '%: ' + fmtMoney(rcVat, cc)
        + (inv.client_vat_number ? '   ·   Customer VAT number: ' + inv.client_vat_number : ''), 50, y + 26, { width: 495 });
    doc.fillColor('#111111');
    y += 60;
  }

  // A4 — CIS audit line: gross / deduction / net in one sentence.
  if (cisOn) {
    ensureRoom(20);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#475569')
      .text('CIS: gross ' + fmtMoney(inv.grand_total, cc)
        + ' · deduction ' + fmtMoney(inv.cis_deduction, cc)
        + ' (' + num(inv.cis_rate, 20).toFixed(0) + '% of labour ' + fmtMoney(inv.cis_labour_total, cc) + ', materials excluded)'
        + ' · net payable ' + fmtMoney(num(inv.grand_total) - num(inv.cis_deduction), cc), 40, y, { width: 515 });
    doc.fillColor('#111111');
    y += 16;
  }

  // Notes / terms
  if (inv.notes) {
    ensureRoom(60);
    y += 8;
    doc.font('Helvetica-Bold').fontSize(10).text('Payment terms / notes', 40, y); y += 14;
    doc.font('Helvetica').fontSize(9).fillColor('#333333').text(inv.notes, 40, y, { width: 515 });
    doc.fillColor('#111111');
  }

  const footY = doc.page.height - 50;
  doc.font('Helvetica').fontSize(8).fillColor('#666666')
    .text(branding.footer_text || ('Payment due by ' + (inv.due_date || 'the due date') + '. Please reference the invoice number when paying.'), 40, footY, { width: 515, align: 'center' });
}

// Stream to an HTTP response (sets headers).
function streamInvoicePdf(res, inv, lines, branding, userInfo) {
  const filename = (inv.invoice_number || 'invoice') + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(res);
  renderInvoicePdf(doc, inv, lines, branding, userInfo);
  doc.end();
}

// Render to a Buffer — used for email attachments.
function invoicePdfBuffer(inv, lines, branding, userInfo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    renderInvoicePdf(doc, inv, lines, branding, userInfo);
    doc.end();
  });
}

module.exports = { renderInvoicePdf, streamInvoicePdf, invoicePdfBuffer, overdueState };
