// cashflowPdf.js — branded cash-flow PDF (portrait A4). A client-facing summary
// of the expected monthly cash flow from a build programme, with claims to date.
// Kept in its own module so a route just streams it, mirroring schedulePdf.js.

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');

function fmtMoney(n) { return '£' + Math.round(Number(n) || 0).toLocaleString('en-GB'); }

// Stream a cash-flow PDF to an Express response.
//   cashflow = { months:[{label,planned,claimed,cumulativePlanned,cumulativeClaimed}], totals:{...} }
function streamCashflowPdf(res, plan, cashflow, branding, userInfo) {
  const primary = (branding && branding.primary_colour) || '#1B2A4A';
  const accent = (branding && branding.accent_colour) || '#F59E0B';
  const companyName = (branding && branding.company_name)
    || (userInfo && (userInfo.company || userInfo.full_name)) || 'Cash flow';

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const filename = (plan.title || 'build-programme').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-cashflow.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  doc.pipe(res);

  const pageLeft = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  const contentW = pageRight - pageLeft;

  // ── Header band ──
  let logoShown = false;
  if (branding && branding.logo_filename) {
    const logoPath = path.join(brandingDir, branding.logo_filename);
    if (fs.existsSync(logoPath)) {
      try { doc.image(logoPath, pageLeft, 36, { fit: [120, 40] }); logoShown = true; } catch (e) {}
    }
  }
  doc.fillColor(primary).fontSize(18).font('Helvetica-Bold')
    .text(companyName, logoShown ? pageLeft + 132 : pageLeft, 38, { width: 400 });
  doc.fillColor('#475569').fontSize(11).font('Helvetica')
    .text((plan.title || 'Build programme') + ' — cash flow', logoShown ? pageLeft + 132 : pageLeft, 60, { width: 400 });
  doc.moveTo(pageLeft, 84).lineTo(pageRight, 84).strokeColor(accent).lineWidth(2).stroke();

  let y = 100;
  const totals = cashflow.totals || {};

  // ── Totals cards ──
  const cards = [
    ['Contract value', fmtMoney(totals.contractValue)],
    ['Claimed to date', fmtMoney(totals.claimedToDate)],
    ['Left to claim', fmtMoney(totals.remainingToClaim)],
  ];
  if (Number(totals.variationsValue) > 0) {
    cards.splice(1, 0, ['incl. change orders', '+' + fmtMoney(totals.variationsValue)]);
  }
  const cardW = (contentW - (cards.length - 1) * 10) / cards.length;
  cards.forEach((c, i) => {
    const x = pageLeft + i * (cardW + 10);
    doc.roundedRect(x, y, cardW, 48, 6).fillColor('#F8FAFC').fill();
    doc.fillColor('#64748B').fontSize(8).font('Helvetica').text(c[0], x + 10, y + 9, { width: cardW - 20 });
    doc.fillColor(primary).fontSize(13).font('Helvetica-Bold').text(c[1], x + 10, y + 23, { width: cardW - 20, lineBreak: false });
  });
  y += 68;

  const months = cashflow.months || [];
  if (months.length === 0) {
    doc.fillColor('#64748B').fontSize(11).font('Helvetica')
      .text('No dated, costed tasks yet — generate a schedule and add a quote to see the monthly cash flow.', pageLeft, y, { width: contentW });
    doc.end();
    return;
  }

  // ── Monthly table ──
  // Columns: Month | Planned | Cumulative | Claimed | Cumulative
  const cols = [
    { key: 'label', label: 'Month', w: 0.20, align: 'left' },
    { key: 'planned', label: 'Planned', w: 0.20, align: 'right' },
    { key: 'cumulativePlanned', label: 'Cumulative', w: 0.20, align: 'right' },
    { key: 'claimed', label: 'Claimed', w: 0.20, align: 'right' },
    { key: 'cumulativeClaimed', label: 'Cumulative', w: 0.20, align: 'right' },
  ];
  const xOf = (i) => pageLeft + cols.slice(0, i).reduce((s, c) => s + c.w * contentW, 0);

  const drawHeader = () => {
    doc.roundedRect(pageLeft, y, contentW, 22, 3).fillColor(primary).fill();
    doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold');
    cols.forEach((c, i) => {
      doc.text(c.label, xOf(i) + 6, y + 7, { width: c.w * contentW - 12, align: c.align, lineBreak: false });
    });
    y += 22;
  };
  drawHeader();

  const rowH = 18;
  doc.font('Helvetica').fontSize(8.5);
  months.forEach((m, idx) => {
    if (y + rowH > pageBottom - 20) { doc.addPage(); y = doc.page.margins.top; drawHeader(); doc.font('Helvetica').fontSize(8.5); }
    if (idx % 2 === 1) { doc.roundedRect(pageLeft, y, contentW, rowH, 0).fillColor('#F8FAFC').fill(); }
    cols.forEach((c, i) => {
      const raw = m[c.key];
      const val = c.key === 'label' ? String(raw) : fmtMoney(raw);
      const isClaim = (c.key === 'claimed' || c.key === 'cumulativeClaimed');
      doc.fillColor(isClaim && Number(raw) > 0 ? '#16A34A' : '#1E293B')
        .text(val, xOf(i) + 6, y + 5, { width: c.w * contentW - 12, align: c.align, lineBreak: false });
    });
    y += rowH;
  });

  // Totals row
  if (y + rowH > pageBottom - 20) { doc.addPage(); y = doc.page.margins.top; }
  doc.moveTo(pageLeft, y).lineTo(pageRight, y).strokeColor('#CBD5E1').lineWidth(1).stroke();
  y += 4;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(primary);
  doc.text('Programme total', xOf(0) + 6, y + 3, { width: cols[0].w * contentW - 12, lineBreak: false });
  doc.text(fmtMoney(totals.plannedTotal), xOf(1) + 6, y + 3, { width: cols[1].w * contentW - 12, align: 'right', lineBreak: false });
  doc.text(fmtMoney(totals.claimedToDate), xOf(3) + 6, y + 3, { width: cols[3].w * contentW - 12, align: 'right', lineBreak: false });
  y += rowH + 6;

  // Footer note.
  doc.fontSize(7.5).font('Helvetica').fillColor('#94A3B8').text(
    'Indicative cash flow generated by AI QS from the build programme and priced work. '
    + 'Planned figures spread the contract value across the schedule; claims are invoices raised to date. '
    + 'Actual timing may vary with site progress and payment terms.',
    pageLeft, Math.min(y, pageBottom - 24), { width: contentW }
  );

  doc.end();
}

module.exports = { streamCashflowPdf };
