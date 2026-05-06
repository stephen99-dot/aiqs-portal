/**
 * BOQ Excel Generator
 *
 * The output is two tabs: a polished Cover sheet (project, customer, total
 * value, labour vs materials split) and the priced BOQ itself. Section bands
 * and accent colours pick up the user's branding when an `opts.branding`
 * pack is passed; otherwise defaults to navy + amber.
 */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

function hexToArgb(hex) {
  if (typeof hex !== 'string') return null;
  const m = hex.replace('#', '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(m)) return null;
  return 'FF' + m;
}
function tintHex(hex, pct) {
  if (typeof hex !== 'string') return null;
  const h = hex.replace('#', '');
  if (h.length !== 6) return null;
  const num = parseInt(h, 16);
  let r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
  r = Math.round(r + (255 - r) * pct);
  g = Math.round(g + (255 - g) * pct);
  b = Math.round(b + (255 - b) * pct);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
}
function tryEmbedLogo(wb, ws, logoPath, anchor) {
  if (!logoPath || !fs.existsSync(logoPath)) return null;
  try {
    const ext = path.extname(logoPath).toLowerCase().replace('.', '') || 'png';
    let extension = ext;
    if (ext === 'jpg') extension = 'jpeg';
    if (ext === 'webp' || ext === 'svg') return null;
    const id = wb.addImage({ filename: logoPath, extension });
    ws.addImage(id, anchor);
    return id;
  } catch (e) { return null; }
}

async function generateBOQExcel(sections, projectName, clientName, opts = {}) {
  const currency = opts.currency || '\u00a3';
  const contingencyPct = opts.contingency_pct || 7.5;
  const ohpPct = opts.ohp_pct || 12;
  const vatRate = opts.vat_rate || 20;

  const branding = opts.branding || {};
  const PRIMARY = hexToArgb(branding.primary_colour) || 'FF1B2A4A';
  const ACCENT  = hexToArgb(branding.accent_colour)  || 'FFF59E0B';
  const SECTION_BG_HEX = tintHex(branding.primary_colour || '#1B2A4A', 0.85);
  const SECTION_BG = hexToArgb(SECTION_BG_HEX) || 'FFD6E4F0';
  const headingFont = (branding.template === 'professional' || branding.template === 'heritage') ? 'Cambria' : 'Calibri';
  const bodyFont = 'Calibri';

  const wb = new ExcelJS.Workbook();
  wb.creator = (branding.company_name || 'The AI QS');
  wb.created = new Date();

  // \u2500\u2500 Pre-compute totals so the cover sheet can show the headline number \u2500
  let totalLabour = 0, totalMaterials = 0;
  for (const s of sections || []) {
    for (const it of (s.items || [])) {
      totalLabour += parseFloat(it.labour) || 0;
      totalMaterials += parseFloat(it.materials) || 0;
    }
  }
  const netTotal = totalLabour + totalMaterials;
  const grandExVat = netTotal * (1 + contingencyPct / 100 + ohpPct / 100);
  const grandInclVat = grandExVat * (1 + vatRate / 100);

  // \u2500\u2500 Cover sheet (first tab) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const cover = wb.addWorksheet('Cover', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1 },
  });
  cover.columns = [
    { width: 3 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 3 },
  ];

  if (tryEmbedLogo(wb, cover, branding.logo_path, { tl: { col: 1, row: 1 }, ext: { width: 160, height: 60 } })) {
    cover.getRow(1).height = 12; cover.getRow(2).height = 12;
    cover.getRow(3).height = 12; cover.getRow(4).height = 12;
  }
  if (branding.company_name) {
    cover.mergeCells('C2:E2');
    const cn = cover.getCell('C2');
    cn.value = branding.company_name;
    cn.font = { name: headingFont, size: 14, bold: true, color: { argb: PRIMARY } };
    cn.alignment = { horizontal: 'right' };
  }
  if (branding.company_address) {
    cover.mergeCells('C3:E5');
    const ca = cover.getCell('C3');
    ca.value = branding.company_address;
    ca.font = { name: bodyFont, size: 9, color: { argb: 'FF64748B' } };
    ca.alignment = { horizontal: 'right', vertical: 'top', wrapText: true };
  }

  cover.getRow(7).height = 6;
  cover.mergeCells('B8:E8');
  cover.getCell('B8').value = 'BILL OF QUANTITIES';
  cover.getCell('B8').font = { name: headingFont, size: 11, bold: true, color: { argb: ACCENT } };

  cover.mergeCells('B9:E10');
  cover.getCell('B9').value = projectName;
  cover.getCell('B9').font = { name: headingFont, size: 22, bold: true, color: { argb: PRIMARY } };
  cover.getCell('B9').alignment = { vertical: 'top', wrapText: true };
  cover.getRow(9).height = 32; cover.getRow(10).height = 22;

  cover.mergeCells('B11:E11');
  cover.getCell('B11').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
  cover.getRow(11).height = 6;

  function coverMeta(rowNum, label, value) {
    cover.getCell('B' + rowNum).value = label.toUpperCase();
    cover.getCell('B' + rowNum).font = { name: bodyFont, size: 8.5, bold: true, color: { argb: 'FF94A3B8' } };
    cover.mergeCells('C' + rowNum + ':E' + rowNum);
    cover.getCell('C' + rowNum).value = value;
    cover.getCell('C' + rowNum).font = { name: bodyFont, size: 11, bold: true, color: { argb: PRIMARY } };
  }
  cover.getRow(12).height = 14;
  coverMeta(13, 'Prepared for', clientName);
  coverMeta(14, 'Issued', new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }));
  coverMeta(15, 'Total ex-VAT (provisional)', currency + Math.round(grandExVat).toLocaleString('en-GB'));
  coverMeta(16, 'Total incl-VAT (' + vatRate + '%)', currency + Math.round(grandInclVat).toLocaleString('en-GB'));

  // Labour / materials split visual (cover row 19-21)
  cover.getRow(18).height = 16;
  cover.mergeCells('B19:E19');
  cover.getCell('B19').value = 'LABOUR vs MATERIALS';
  cover.getCell('B19').font = { name: bodyFont, size: 8.5, bold: true, color: { argb: 'FF94A3B8' } };
  if (netTotal > 0) {
    const labourPct = totalLabour / netTotal;
    cover.getRow(20).height = 18;
    // Primary bar (labour)
    const labourEnd = 'B' + 20; // single cell \u2014 can't easily split visually in xlsx without merges
    // Use two side-by-side cells: B20 (labour, primary), C20-E20 widths to indicate proportion textually
    cover.getCell('B20').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRIMARY } };
    cover.getCell('B20').value = '';
    cover.mergeCells('B21:E21');
    cover.getCell('B21').value = 'Labour ' + currency + Math.round(totalLabour).toLocaleString('en-GB') + '  \u00b7  ' + Math.round(labourPct * 100) + '%   |   Materials ' + currency + Math.round(totalMaterials).toLocaleString('en-GB') + '  \u00b7  ' + Math.round((1 - labourPct) * 100) + '%';
    cover.getCell('B21').font = { name: bodyFont, size: 10, color: { argb: PRIMARY } };
  }

  if (branding.footer_text) {
    cover.mergeCells('B30:E30');
    const f = cover.getCell('B30');
    f.value = branding.footer_text;
    f.font = { name: bodyFont, size: 9, italic: true, color: { argb: 'FF94A3B8' } };
    f.alignment = { horizontal: 'center' };
  }

  // \u2500\u2500 BOQ sheet (parser still expects this name) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const ws = wb.addWorksheet('BOQ', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
  });

  // Column definitions — tightened so Total (col H) is visible on mobile screens
  // Description reduced from 62→48, Labour/Materials reduced from 14→12
  ws.columns = [
    { header: 'Item', key: 'item', width: 7 },
    { header: 'Description', key: 'desc', width: 48 },
    { header: 'Unit', key: 'unit', width: 6 },
    { header: 'Qty', key: 'qty', width: 8 },
    { header: 'Rate (' + currency + ')', key: 'rate', width: 10 },
    { header: 'Labour (' + currency + ')', key: 'labour', width: 12 },
    { header: 'Materials (' + currency + ')', key: 'materials', width: 12 },
    { header: 'Total (' + currency + ')', key: 'total', width: 13 },
    { header: 'Rate Source', key: 'source', width: 12 }
  ];

  // Colours — all branded except the rate-source palette which stays semantic.
  var NAVY = PRIMARY;
  var SUBTOTAL_BG = hexToArgb(tintHex(branding.accent_colour || '#F59E0B', 0.85)) || 'FFFFF2CC';
  var VERIFIED_BG = 'FFD1FAE5';
  var EMERGING_BG = 'FFFEF3C7';
  var GENERIC_BG = 'FFF1F5F9';
  var BORDER_COL = 'FFCBD5E1';

  var thinBorder = { style: 'thin', color: { argb: BORDER_COL } };
  var allBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
  var currFmt = '#,##0.00';
  var qtyFmt = '#,##0.00';

  function formatDataRow(row) {
    for (var c = 1; c <= 9; c++) {
      var cell = row.getCell(c);
      cell.border = allBorders;
      cell.font = { name: bodyFont, size: 10 };
      cell.alignment = { vertical: 'middle', wrapText: c === 2 };
      if (c >= 5 && c <= 8) {
        cell.numFmt = currFmt;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
      if (c === 4) {
        cell.numFmt = qtyFmt;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      if (c === 1 || c === 3 || c === 9) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    }
  }

  // === ROW 1: Big branded title ===
  var row = 1;
  ws.mergeCells('A1:I1');
  var titleCell = ws.getCell('A1');
  titleCell.value = 'BILL OF QUANTITIES — ' + projectName;
  titleCell.font = { name: headingFont, size: 18, bold: true, color: { argb: PRIMARY } };
  titleCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 36;

  // === ROW 2: Meta line (client / date / company) ===
  ws.mergeCells('A2:I2');
  var infoCell = ws.getCell('A2');
  infoCell.value = 'Client: ' + clientName
    + '  |  Date: ' + new Date().toLocaleDateString('en-GB')
    + '  |  ' + (branding.company_name ? 'Issued by ' + branding.company_name : 'Generated by The AI QS');
  infoCell.font = { name: bodyFont, size: 10, color: { argb: 'FF64748B' } };
  infoCell.alignment = { indent: 1 };
  ws.getRow(2).height = 20;

  // === ROW 3: Accent bar (the visual punch) ===
  ws.mergeCells('A3:I3');
  ws.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
  ws.getRow(3).height = 5;
  row = 4;

  // === ROW 4: Column Headers ===
  var hdrRow = ws.getRow(row);
  hdrRow.values = ['Item', 'Description', 'Unit', 'Qty', 'Rate (' + currency + ')', 'Labour (' + currency + ')', 'Materials (' + currency + ')', 'Total (' + currency + ')', 'Rate Source'];
  hdrRow.height = 26;
  for (var h = 1; h <= 9; h++) {
    var hCell = hdrRow.getCell(h);
    hCell.font = { name: headingFont, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    hCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    hCell.border = allBorders;
    hCell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  var headerRowNum = row;
  row++;

  // === DATA ROWS ===
  var subtotalRows = [];

  for (var si = 0; si < sections.length; si++) {
    var section = sections[si];
    
    // Section header
    var secRow = ws.getRow(row);
    ws.mergeCells('A' + row + ':I' + row);
    // Format section title: "1. PRELIMINARY WORKS & TRAFFIC MANAGEMENT" style (number + uppercase descriptive title)
    // Format section title: "1. 1. PRELIMINARY WORKS & TRAFFIC MANAGEMENT" style
    var secNum = section.number || String(si + 1);
    var secTitle = (section.title || 'Section').toUpperCase();
    secRow.getCell(1).value = secNum + '. ' + secTitle;
    secRow.getCell(1).font = { name: headingFont, size: 10.5, bold: true, color: { argb: PRIMARY } };
    secRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_BG } };
    secRow.getCell(1).border = allBorders;
    secRow.height = 22;
    row++;

    var firstItemRow = row;
    var items = section.items || [];

    for (var ii = 0; ii < items.length; ii++) {
      var item = items[ii];
      var labour = parseFloat(item.labour) || 0;
      var materials = parseFloat(item.materials) || 0;
      var total = parseFloat(item.total) || (labour + materials) || ((parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0));

      var srcLabel = 'Generic';
      if (item.rate_source === 'verified') srcLabel = 'Verified';
      else if (item.rate_source === 'emerging') srcLabel = 'Emerging';
      else if (item.rate_source === 'client') srcLabel = 'Client';

      var dataRow = ws.getRow(row);
      dataRow.getCell(1).value = item.item || '';
      dataRow.getCell(2).value = item.description || '';
      dataRow.getCell(3).value = item.unit || '';
      dataRow.getCell(4).value = parseFloat(item.qty) || 0;
      dataRow.getCell(5).value = parseFloat(item.rate) || 0;
      dataRow.getCell(6).value = labour;
      dataRow.getCell(7).value = materials;
      dataRow.getCell(8).value = total;
      dataRow.getCell(9).value = srcLabel;
      
      formatDataRow(dataRow);
      
      // Colour the source cell
      var srcBg = srcLabel === 'Verified' || srcLabel === 'Client' ? VERIFIED_BG : srcLabel === 'Emerging' ? EMERGING_BG : GENERIC_BG;
      dataRow.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: srcBg } };
      
      row++;
    }

    var lastItemRow = row - 1;

    // Section subtotal
    if (items.length > 0) {
      var subRow = ws.getRow(row);
      subRow.getCell(1).value = '';
      subRow.getCell(2).value = 'SUB-TOTAL \u2014 SECTION ' + secNum + ': ' + secTitle;
      subRow.getCell(2).font = { name: bodyFont, size: 10, bold: true };
      subRow.getCell(3).value = '';
      subRow.getCell(4).value = '';
      subRow.getCell(5).value = '';
      subRow.getCell(6).value = { formula: 'SUM(F' + firstItemRow + ':F' + lastItemRow + ')' };
      subRow.getCell(7).value = { formula: 'SUM(G' + firstItemRow + ':G' + lastItemRow + ')' };
      subRow.getCell(8).value = { formula: 'SUM(H' + firstItemRow + ':H' + lastItemRow + ')' };
      subRow.getCell(9).value = '';
      
      for (var sc = 1; sc <= 9; sc++) {
        subRow.getCell(sc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTOTAL_BG } };
        subRow.getCell(sc).border = allBorders;
        subRow.getCell(sc).font = subRow.getCell(sc).font || {};
        subRow.getCell(sc).font = { name: bodyFont, size: 10, bold: true };
        if (sc >= 5 && sc <= 8) subRow.getCell(sc).numFmt = currFmt;
      }
      subRow.height = 22;
      subtotalRows.push(row);
      row++;
    }

    // Blank row between sections
    row++;
  }

  // === SUMMARY ===
  row++;
  var sumHeaderRow = ws.getRow(row);
  ws.mergeCells('A' + row + ':I' + row);
  sumHeaderRow.getCell(1).value = 'PROJECT SUMMARY';
  sumHeaderRow.getCell(1).font = { name: headingFont, size: 10.5, bold: true, color: { argb: PRIMARY } };
  sumHeaderRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_BG } };
  sumHeaderRow.getCell(1).border = allBorders;
  row++;

  // Net total
  var netFormula = subtotalRows.length > 0 ? subtotalRows.map(function(r) { return 'H' + r; }).join('+') : '0';
  var netRow = ws.getRow(row);
  netRow.getCell(2).value = 'Net Construction Cost';
  netRow.getCell(2).font = { name: bodyFont, size: 10, bold: true };
  netRow.getCell(8).value = { formula: netFormula };
  netRow.getCell(8).numFmt = currFmt;
  netRow.getCell(8).font = { name: bodyFont, size: 10, bold: true };
  netRow.getCell(8).border = allBorders;
  var netRowNum = row;
  row++;

  // Contingency
  var contRow = ws.getRow(row);
  contRow.getCell(2).value = 'Contingency (' + contingencyPct + '%)';
  contRow.getCell(2).font = { name: bodyFont, size: 10 };
  contRow.getCell(8).value = { formula: 'H' + netRowNum + '*' + (contingencyPct / 100) };
  contRow.getCell(8).numFmt = currFmt;
  contRow.getCell(8).font = { name: bodyFont, size: 10 };
  contRow.getCell(8).border = allBorders;
  var contRowNum = row;
  row++;

  // OH&P
  var ohpRow = ws.getRow(row);
  ohpRow.getCell(2).value = 'Overheads & Profit (' + ohpPct + '%)';
  ohpRow.getCell(2).font = { name: bodyFont, size: 10 };
  ohpRow.getCell(8).value = { formula: 'H' + netRowNum + '*' + (ohpPct / 100) };
  ohpRow.getCell(8).numFmt = currFmt;
  ohpRow.getCell(8).font = { name: bodyFont, size: 10 };
  ohpRow.getCell(8).border = allBorders;
  var ohpRowNum = row;
  row++;

  // Grand total excl VAT
  var gtRow = ws.getRow(row);
  gtRow.getCell(2).value = 'TOTAL CONSTRUCTION COST (EXCL. VAT)';
  gtRow.getCell(2).font = { name: headingFont, size: 11, bold: true, color: { argb: PRIMARY } };
  gtRow.getCell(8).value = { formula: 'H' + netRowNum + '+H' + contRowNum + '+H' + ohpRowNum };
  gtRow.getCell(8).numFmt = currFmt;
  gtRow.getCell(8).font = { name: headingFont, size: 11, bold: true };
  for (var gc = 1; gc <= 9; gc++) {
    gtRow.getCell(gc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTOTAL_BG } };
    gtRow.getCell(gc).border = allBorders;
  }
  var gtRowNum = row;
  row++;

  // VAT
  var vatRow = ws.getRow(row);
  vatRow.getCell(2).value = 'VAT @ ' + vatRate + '%';
  vatRow.getCell(2).font = { name: bodyFont, size: 10 };
  vatRow.getCell(8).value = { formula: 'H' + gtRowNum + '*' + (vatRate / 100) };
  vatRow.getCell(8).numFmt = currFmt;
  vatRow.getCell(8).font = { name: bodyFont, size: 10 };
  vatRow.getCell(8).border = allBorders;
  var vatRowNum = row;
  row++;

  // Total incl VAT
  var inclRow = ws.getRow(row);
  inclRow.getCell(2).value = 'TOTAL CONSTRUCTION COST (INCL. VAT @ ' + vatRate + '%)';
  inclRow.getCell(2).font = { name: headingFont, size: 11, bold: true, color: { argb: PRIMARY } };
  inclRow.getCell(8).value = { formula: 'H' + gtRowNum + '+H' + vatRowNum };
  inclRow.getCell(8).numFmt = currFmt;
  inclRow.getCell(8).font = { name: headingFont, size: 11, bold: true };
  for (var ic = 1; ic <= 9; ic++) {
    inclRow.getCell(ic).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTOTAL_BG } };
    inclRow.getCell(ic).border = allBorders;
  }
  row++;

  // Legend
  row++;
  ws.getRow(row).getCell(2).value = 'Rate Source Legend:';
  ws.getRow(row).getCell(2).font = { name: bodyFont, size: 9, bold: true };
  row++;
  ws.getRow(row).getCell(2).value = 'Verified = Client-confirmed rate';
  ws.getRow(row).getCell(2).font = { name: bodyFont, size: 9, color: { argb: 'FF059669' } };
  row++;
  ws.getRow(row).getCell(2).value = 'Emerging = Client rate, calibrating';
  ws.getRow(row).getCell(2).font = { name: bodyFont, size: 9, color: { argb: 'FFD97706' } };
  row++;
  ws.getRow(row).getCell(2).value = 'Generic = UK database rate';
  ws.getRow(row).getCell(2).font = { name: bodyFont, size: 9, color: { argb: 'FF64748B' } };

  // Freeze panes
  ws.views = [{ state: 'frozen', ySplit: headerRowNum, activeCell: 'A' + (headerRowNum + 1) }];

  // Footer
  ws.headerFooter.oddFooter = '&L' + (branding.footer_text || branding.company_name || 'The AI QS — theaiqs.co.uk') + '&RPage &P of &N';
  cover.headerFooter.oddFooter = '&L' + (branding.footer_text || branding.company_name || 'The AI QS — theaiqs.co.uk') + '&RPage &P of &N';

  // Write buffer
  var buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { generateBOQExcel };
