/**
 * BOQ Excel Generator \u2014 produces a polished priced BOQ.
 *
 * Two tabs: a styled Cover sheet (rendered via docTemplates.renderCoverSheet,
 * shared with the Client Copy generator so both docs speak the same visual
 * language) and the priced BOQ table itself. Visual treatment varies per
 * the customer's chosen template (modern / professional / heritage / minimalist).
 */
const ExcelJS = require('exceljs');
const { styleFor, renderCoverSheet, renderHeroBlock, hexToArgb, tintHex, sanitizeXmlText, writeXlsxBuffer } = require('./docTemplates');

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment helpers (additive, backward-compatible). These let the bill read
// more like a chartered-QS document — contract metadata in the header, per-
// section narrative notes, and a Prime Cost / Provisional Sums recap — WITHOUT
// changing any priced number (so the recalc gate still reconciles to the penny).
// ─────────────────────────────────────────────────────────────────────────────

// Accept opts.meta as either an object ({ Employer: '…' }) or an array of
// [label, value] / { label, value } pairs, and return a clean [label, value][]
// with empties dropped. Used to extend the project header block.
function normalizeMeta(meta) {
  if (!meta) return [];
  let pairs = [];
  if (Array.isArray(meta)) {
    pairs = meta.map((m) => (Array.isArray(m) ? [m[0], m[1]] : [m && m.label, m && m.value]));
  } else if (typeof meta === 'object') {
    pairs = Object.keys(meta).map((k) => [k, meta[k]]);
  }
  return pairs
    .map(([label, value]) => [String(label || '').trim(), value == null ? '' : String(value).trim()])
    .filter(([label, value]) => label && value && value !== '—');
}

// Trim a line-item description down to a short recap label: drop the appended
// "(working…)" note and clamp the length.
function shortLabel(desc, max = 70) {
  let s = String(desc || '').split('\n')[0].trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '…';
  return s;
}

// Classify Prime Cost (PC) and Provisional Sum line items so they can be
// recapped. Callers may pass explicit opts.pcSums / opts.provisionalSums
// (arrays of { ref, description, total }); otherwise we auto-derive from the
// line items by their unit + description wording. These are ALREADY inside the
// section subtotals — the recap is informational and never re-added to a total.
function classifySums(sections, opts = {}) {
  const provided = (arr) => Array.isArray(arr) && arr.length
    ? arr.map((e) => ({ ref: e.ref || e.item || '', description: shortLabel(e.description || e.label || ''), total: Number(e.total) || 0 }))
    : null;
  const pcGiven = provided(opts.pcSums);
  const provGiven = provided(opts.provisionalSums);
  if (pcGiven || provGiven) return { pc: pcGiven || [], prov: provGiven || [] };

  const pc = [];
  const prov = [];
  for (const section of sections || []) {
    const secTitle = String(section.title || section.name || '').toLowerCase();
    const inProvSection = /provisional\s+sums?/.test(secTitle);
    for (const item of (section.items || [])) {
      const text = String(item.description || '').toLowerCase();
      const unit = String(item.unit || '').toLowerCase().trim();
      const total = Number(item.total) || ((Number(item.labour) || 0) + (Number(item.materials) || 0));
      // Recognise provisional sums however they're expressed: an explicit
      // "Provisional Sums" section, the words "provisional sum" / P.Sum unit, OR
      // an allowance worded "subject to <a later design/report/scope/survey/
      // quotation/instruction>" — the natural phrasing for work that can't be
      // measured until something later is fixed.
      const isProvisional = inProvSection
        || /provisional sum|prov\.?\s*sum/.test(text)
        || /^p\.?\s*sum$/.test(unit) || unit === 'prov'
        || /\bsubject to\b[^.]*\b(design|report|survey|scope|quotation|quote|specialist|instruction|measurement|tender|approval)\b/.test(text);
      const isPC = /prime cost|\bpc £|\bp\.c\.|\(pc\b/.test(text);
      if (isProvisional) prov.push({ ref: item.item || '', description: shortLabel(item.description), total });
      else if (isPC) pc.push({ ref: item.item || '', description: shortLabel(item.description), total });
    }
  }
  return { pc, prov };
}

async function generateBOQExcel(sections, projectName, clientName, opts = {}) {
  const currency = opts.currency || '\u00a3';
  // Default ZERO markup: rates are all-in competitive prices, so the summary
  // only shows Contingency/OH&P rows when the caller (playbook prefs) asks.
  const contingencyPct = Number.isFinite(Number(opts.contingency_pct)) ? Number(opts.contingency_pct) : 0;
  const ohpPct = Number.isFinite(Number(opts.ohp_pct)) ? Number(opts.ohp_pct) : 0;
  const vatRate = opts.vat_rate || 20;

  const branding = opts.branding || {};
  const style = styleFor(branding);
  const f = style.flavour;
  const PRIMARY = style.PRIMARY;
  const ACCENT  = style.ACCENT;
  const headingFont = f.headingFont;
  const bodyFont = f.bodyFont;

  const wb = new ExcelJS.Workbook();
  wb.creator = (branding.company_name || 'The AI QS');
  wb.created = new Date();

  // \u2500\u2500 Pre-compute totals so the cover sheet can show the headline numbers \u2500
  let totalLabour = 0, totalMaterials = 0, itemCount = 0;
  for (const s of sections || []) {
    for (const it of (s.items || [])) {
      totalLabour += parseFloat(it.labour) || 0;
      totalMaterials += parseFloat(it.materials) || 0;
      itemCount++;
    }
  }
  const netTotal = totalLabour + totalMaterials;
  const grandExVat = netTotal * (1 + contingencyPct / 100 + ohpPct / 100);
  const grandInclVat = grandExVat * (1 + vatRate / 100);

  // \u2500\u2500 Cover sheet (shared renderer) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const cover = await renderCoverSheet(wb, {
    docKind: 'BILL OF QUANTITIES',
    projectName,
    clientName,
    issuedDate: new Date(),
    currency,
    totals: { exVat: grandExVat, inclVat: grandInclVat, labour: totalLabour, materials: totalMaterials },
    itemCount,
    sectionCount: (sections || []).length,
  }, style);

  // \u2500\u2500 BOQ sheet (parser still expects this name) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const ws = wb.addWorksheet('BOQ', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
    views: [{ showGridLines: false }],
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

  // Colours — pulled from the style flavour. The rate-source palette stays
  // semantic (verified/emerging/generic) so it's still readable across templates.
  var NAVY = PRIMARY;
  var SECTION_BG = f.sectionFill;
  var PRIMARY_TINT = hexToArgb(tintHex(style.primaryHex, 0.9)) || 'FFE7ECF4';
  var SUBTOTAL_BG = f.subtotalFill === style.WHITE ? PRIMARY_TINT : f.subtotalFill;
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

  // === Hero block (rows 1-4, branded) ===
  var nextRow = renderHeroBlock(ws, {
    docKind: 'BILL OF QUANTITIES',
    projectName,
    clientName,
    extraMeta: branding.company_name ? 'Issued by ' + branding.company_name : 'Generated by The AI QS',
  }, style, 'I');
  var row = nextRow + 1; // small breathing room
  ws.getRow(nextRow).height = 6;

  // === Project header block (reads like a real tender BOQ) ===
  // Two-column "label: value" rows summarising the job, basis and preparer —
  // mirrors the front sheet of a chartered QS bill.
  var preparedBy = branding.company_name || 'The AI QS';
  var issueDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  var currencyCode = currency === '€' ? 'EUR' : currency === '$' ? 'USD' : 'GBP';
  var basisParts = [currencyCode + ', ex VAT unless stated (VAT @ ' + vatRate + '%)'];
  if (opts.location) basisParts.push(opts.location + ' rates');
  var metaRows = [
    ['Project', projectName || '—'],
    ['Client', clientName || '—'],
    ['Project type', [opts.project_type, opts.spec_level ? '· ' + opts.spec_level + ' spec' : '', opts.floor_area_m2 ? '· ' + Math.round(opts.floor_area_m2) + ' m² GIA' : ''].filter(Boolean).join(' ') || '—'],
  ];
  // Optional contract metadata (Employer, Contract Administrator, Contract form,
  // Loss adjuster, Type of loss, Location …) — slotted in just below the job
  // identity so the bill reads like a real tender front sheet when the caller
  // has the detail, and is silently skipped when it doesn't.
  if (opts.location) metaRows.push(['Location', opts.location]);
  for (const [label, value] of normalizeMeta(opts.meta)) metaRows.push([label, value]);
  metaRows.push(
    ['Prepared by', preparedBy],
    ['Date', issueDate],
    ['Basis', basisParts.join(', ')],
  );
  for (var mr = 0; mr < metaRows.length; mr++) {
    var metaRow = ws.getRow(row);
    metaRow.getCell(1).value = metaRows[mr][0] + ':';
    metaRow.getCell(1).font = { name: headingFont, size: 9.5, bold: true, color: { argb: PRIMARY } };
    metaRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
    ws.mergeCells('B' + row + ':I' + row);
    metaRow.getCell(2).value = sanitizeXmlText(String(metaRows[mr][1]));
    metaRow.getCell(2).font = { name: bodyFont, size: 9.5, color: { argb: 'FF334155' } };
    metaRow.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
    metaRow.height = 15;
    row++;
  }
  ws.getRow(row).height = 6; // spacer
  row++;

  // === Column header row ===
  var hdrRow = ws.getRow(row);
  hdrRow.values = ['Item', 'Description', 'Unit', 'Qty', 'Rate (' + currency + ')', 'Labour (' + currency + ')', 'Materials (' + currency + ')', 'Total (' + currency + ')', 'Rate Source'];
  hdrRow.height = 28;
  for (var h = 1; h <= 9; h++) {
    var hCell = hdrRow.getCell(h);
    // Modern: navy header with white text. Professional/Heritage/Minimalist:
    // primary text on white with a thick primary bottom border.
    if (style.template === 'modern') {
      hCell.font = { name: headingFont, size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
      hCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PRIMARY } };
      hCell.border = allBorders;
    } else {
      hCell.font = { name: headingFont, size: 10.5, bold: true, color: { argb: PRIMARY } };
      hCell.border = {
        top: { style: 'thin', color: { argb: PRIMARY } },
        bottom: { style: 'medium', color: { argb: PRIMARY } },
      };
    }
    hCell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  var headerRowNum = row;
  row++;

  // === DATA ROWS ===
  var subtotalRows = [];

  for (var si = 0; si < sections.length; si++) {
    var section = sections[si];

    // Section header — visual treatment varies by template
    var secRow = ws.getRow(row);
    ws.mergeCells('A' + row + ':I' + row);
    var secNum = section.number || String(si + 1);
    var secTitle = sanitizeXmlText(section.title || 'Section').toUpperCase();
    secRow.getCell(1).value = '   ' + secNum + '.   ' + secTitle;
    secRow.getCell(1).font = {
      name: headingFont, size: 11, bold: true,
      color: { argb: f.sectionText },
    };
    if (f.sectionFill !== style.WHITE) {
      secRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.sectionFill } };
    } else {
      // For templates without a section fill, give a thick primary bottom border so the
      // section break still reads visually.
      secRow.getCell(1).border = {
        top: { style: 'medium', color: { argb: PRIMARY } },
        bottom: { style: 'thin', color: { argb: PRIMARY } },
      };
    }
    secRow.height = 26;
    row++;

    // Optional section narrative note (scope, assumptions, caveats) — renders as
    // a wrapped italic band under the section header when supplied. Carries no
    // qty/rate/total, so the recalc gate ignores it.
    if (section.note) {
      var noteRow = ws.getRow(row);
      ws.mergeCells('A' + row + ':I' + row);
      noteRow.getCell(1).value = sanitizeXmlText(String(section.note));
      noteRow.getCell(1).font = { name: bodyFont, size: 9, italic: true, color: { argb: 'FF64748B' } };
      noteRow.getCell(1).alignment = { horizontal: 'left', vertical: 'top', wrapText: true, indent: 1 };
      noteRow.height = Math.min(60, 16 + Math.floor(String(section.note).length / 110) * 12);
      row++;
    }

    var firstItemRow = row;
    var items = section.items || [];

    for (var ii = 0; ii < items.length; ii++) {
      var item = items[ii];
      var labour = parseFloat(item.labour) || 0;
      var materials = parseFloat(item.materials) || 0;
      var total = parseFloat(item.total) || (labour + materials) || ((parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0));

      // Map the pricer's rate_source values to friendly labels. Previously this
      // only matched legacy values (verified/emerging/client), so every line
      // fell through to "Generic" — making real work look low-effort.
      var rs = String(item.rate_source || '');
      var srcLabel = 'Standard';
      if (rs === 'override') srcLabel = 'Override';
      else if (rs === 'client_verified' || rs === 'verified' || rs === 'client') srcLabel = 'Your rate';
      else if (rs === 'emerging') srcLabel = 'Your rate*';
      else if (rs === 'base_library') srcLabel = 'Standard';
      else if (rs === 'ai_estimated') srcLabel = 'AI estimate';
      else if (rs === 'fallback_estimated' || rs === 'fallback_corrected') srcLabel = 'Estimate';

      var dataRow = ws.getRow(row);
      dataRow.getCell(1).value = sanitizeXmlText(item.item || '');
      dataRow.getCell(2).value = sanitizeXmlText(item.description || '');
      dataRow.getCell(3).value = sanitizeXmlText(item.unit || '');
      dataRow.getCell(4).value = parseFloat(item.qty) || 0;
      dataRow.getCell(5).value = parseFloat(item.rate) || 0;
      dataRow.getCell(6).value = labour;
      dataRow.getCell(7).value = materials;
      dataRow.getCell(8).value = total;
      dataRow.getCell(9).value = srcLabel;
      
      formatDataRow(dataRow);
      // Subtle alternating banding on the modern template only — gives the table
      // visual rhythm without taking over.
      if (style.template === 'modern' && (ii % 2 === 1)) {
        for (var bi = 1; bi <= 9; bi++) {
          if (!dataRow.getCell(bi).fill || !dataRow.getCell(bi).fill.fgColor) {
            dataRow.getCell(bi).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          }
        }
      }
      dataRow.height = 20;
      
      // Colour the source cell — green for the client's own rates, amber for
      // AI/estimated, neutral for standard library rates.
      var srcBg = (srcLabel === 'Your rate' || srcLabel === 'Override') ? VERIFIED_BG
        : (srcLabel === 'Your rate*' || srcLabel === 'AI estimate' || srcLabel === 'Estimate') ? EMERGING_BG
        : GENERIC_BG;
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
        if (f.subtotalFill !== style.WHITE) {
          subRow.getCell(sc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.subtotalFill } };
          subRow.getCell(sc).border = allBorders;
        } else {
          // Hairline rules above and below for the no-fill templates
          subRow.getCell(sc).border = {
            top: { style: 'thin', color: { argb: PRIMARY } },
            bottom: { style: 'thin', color: { argb: PRIMARY } },
          };
        }
        subRow.getCell(sc).font = { name: bodyFont, size: 10, bold: true, color: { argb: f.subtotalText } };
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

  // Contingency / OH&P — only rendered when a percentage is actually set
  // (default is 0: rates are all-in, nothing stacked on top). The grand-total
  // formula is built from whichever rows were written.
  var gtParts = ['H' + netRowNum];
  if (contingencyPct > 0) {
    var contRow = ws.getRow(row);
    contRow.getCell(2).value = 'Contingency (' + contingencyPct + '%)';
    contRow.getCell(2).font = { name: bodyFont, size: 10 };
    contRow.getCell(8).value = { formula: 'H' + netRowNum + '*' + (contingencyPct / 100) };
    contRow.getCell(8).numFmt = currFmt;
    contRow.getCell(8).font = { name: bodyFont, size: 10 };
    contRow.getCell(8).border = allBorders;
    gtParts.push('H' + row);
    row++;
  }

  if (ohpPct > 0) {
    var ohpRow = ws.getRow(row);
    ohpRow.getCell(2).value = 'Overheads & Profit (' + ohpPct + '%)';
    ohpRow.getCell(2).font = { name: bodyFont, size: 10 };
    ohpRow.getCell(8).value = { formula: 'H' + netRowNum + '*' + (ohpPct / 100) };
    ohpRow.getCell(8).numFmt = currFmt;
    ohpRow.getCell(8).font = { name: bodyFont, size: 10 };
    ohpRow.getCell(8).border = allBorders;
    gtParts.push('H' + row);
    row++;
  }

  // Grand total excl VAT
  var gtRow = ws.getRow(row);
  gtRow.getCell(2).value = 'TOTAL CONSTRUCTION COST (EXCL. VAT)';
  gtRow.getCell(2).font = { name: headingFont, size: 11, bold: true, color: { argb: PRIMARY } };
  gtRow.getCell(8).value = { formula: gtParts.join('+') };
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

  // === PRIME COST & PROVISIONAL SUMS RECAP ===
  // A chartered bill lists its PC and Provisional sums together so the reader
  // can see the allowances at a glance. These figures are ALREADY contained in
  // the priced lines above — this is a reference recap, not an addition, so it
  // never touches the construction total (and the recalc gate, which only counts
  // rows carrying qty+rate+unit, ignores every row written here).
  var sums = classifySums(sections, opts);
  if (sums.pc.length > 0 || sums.prov.length > 0) {
    row++;
    var recapHeader = ws.getRow(row);
    ws.mergeCells('A' + row + ':I' + row);
    recapHeader.getCell(1).value = 'PRIME COST & PROVISIONAL SUMS  (included in the rates above — shown for reference)';
    recapHeader.getCell(1).font = { name: headingFont, size: 10.5, bold: true, color: { argb: PRIMARY } };
    recapHeader.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_BG } };
    recapHeader.getCell(1).border = allBorders;
    recapHeader.height = 22;
    row++;

    function renderSumGroup(title, entries) {
      if (!entries || entries.length === 0) return;
      var grpRow = ws.getRow(row);
      grpRow.getCell(2).value = title;
      grpRow.getCell(2).font = { name: bodyFont, size: 9.5, bold: true, color: { argb: 'FF334155' } };
      row++;
      var groupStart = row;
      for (var e = 0; e < entries.length; e++) {
        var entry = entries[e];
        var er = ws.getRow(row);
        er.getCell(1).value = sanitizeXmlText(String(entry.ref || ''));
        er.getCell(1).font = { name: bodyFont, size: 9, color: { argb: 'FF64748B' } };
        er.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        ws.mergeCells('B' + row + ':G' + row);
        er.getCell(2).value = sanitizeXmlText(String(entry.description || ''));
        er.getCell(2).font = { name: bodyFont, size: 9, color: { argb: 'FF334155' } };
        er.getCell(2).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        // Total in col 8 only — col 3/4/5 deliberately left empty so the recalc
        // gate does not treat this as a priced line.
        er.getCell(8).value = Math.round((Number(entry.total) || 0) * 100) / 100;
        er.getCell(8).numFmt = currFmt;
        er.getCell(8).font = { name: bodyFont, size: 9, color: { argb: 'FF334155' } };
        er.getCell(8).alignment = { horizontal: 'right', vertical: 'middle' };
        er.height = 16;
        row++;
      }
      // Group subtotal (informational)
      var stRow = ws.getRow(row);
      stRow.getCell(2).value = title + ' — total (at face)';
      stRow.getCell(2).font = { name: bodyFont, size: 9.5, bold: true, color: { argb: 'FF334155' } };
      stRow.getCell(8).value = { formula: 'SUM(H' + groupStart + ':H' + (row - 1) + ')' };
      stRow.getCell(8).numFmt = currFmt;
      stRow.getCell(8).font = { name: bodyFont, size: 9.5, bold: true, color: { argb: 'FF334155' } };
      stRow.getCell(8).border = { top: { style: 'thin', color: { argb: BORDER_COL } } };
      stRow.height = 16;
      row++;
    }

    renderSumGroup('Prime Cost (PC) sums', sums.pc);
    renderSumGroup('Provisional sums', sums.prov);
  }

  // Legend
  row++;
  ws.getRow(row).getCell(2).value = 'Rate Source Legend:';
  ws.getRow(row).getCell(2).font = { name: bodyFont, size: 9, bold: true };
  row++;
  ws.getRow(row).getCell(2).value = 'Your rate = From your confirmed rate library';
  ws.getRow(row).getCell(2).font = { name: bodyFont, size: 9, color: { argb: 'FF059669' } };
  row++;
  ws.getRow(row).getCell(2).value = 'AI estimate / Estimate = Priced from spec where no library rate exists';
  ws.getRow(row).getCell(2).font = { name: bodyFont, size: 9, color: { argb: 'FFD97706' } };
  row++;
  ws.getRow(row).getCell(2).value = 'Standard = Standard UK database rate (SPON\'s-style)';
  ws.getRow(row).getCell(2).font = { name: bodyFont, size: 9, color: { argb: 'FF64748B' } };

  // Freeze panes
  ws.views = [{ state: 'frozen', ySplit: headerRowNum, activeCell: 'A' + (headerRowNum + 1) }];

  // Footer
  ws.headerFooter.oddFooter = '&L' + (branding.footer_text || branding.company_name || 'The AI QS — theaiqs.co.uk') + '&RPage &P of &N';
  cover.headerFooter.oddFooter = '&L' + (branding.footer_text || branding.company_name || 'The AI QS — theaiqs.co.uk') + '&RPage &P of &N';

  // Write buffer
  var buffer = await writeXlsxBuffer(wb);
  return Buffer.from(buffer);
}

module.exports = { generateBOQExcel };
