/**
 * Document templates — visual style packs applied to generated XLSX docs.
 *
 * Each template is a meaningfully different look (not just a font tweak):
 *   - modern        navy/colour-filled hero band, white text, accent stripe
 *   - professional  white hero, primary-coloured serif title, hairline rules
 *   - heritage      warm beige hero, charcoal serif text, classical
 *   - minimalist    pure white, thin large title, single horizontal rule
 *
 * Used by both server/boqGenerator.js (the priced BOQ) and server/builderExports.js
 * (Client Copy) so the customer sees the same visual language across both docs.
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

// ─────────────────────────────────────────────────────────────────────────────
// styleFor(branding) — derive a full style pack from the user's branding row.
// Returns colours pre-converted to ExcelJS argb, plus per-template flavours.
// ─────────────────────────────────────────────────────────────────────────────
function styleFor(branding) {
  const b = branding || {};
  const template = (b.template && ['modern', 'professional', 'heritage', 'minimalist'].includes(b.template))
    ? b.template : 'modern';
  const primaryHex = b.primary_colour || (template === 'heritage' ? '#3A2E1F' : '#1B2A4A');
  const accentHex  = b.accent_colour  || (template === 'heritage' ? '#8C6F3D' : '#F59E0B');

  const PRIMARY  = hexToArgb(primaryHex)  || 'FF1B2A4A';
  const ACCENT   = hexToArgb(accentHex)   || 'FFF59E0B';
  const PRIMARY_TINT = hexToArgb(tintHex(primaryHex, 0.88)) || 'FFE7ECF4';
  const ACCENT_TINT  = hexToArgb(tintHex(accentHex,  0.85)) || 'FFFFEBC2';

  const HERITAGE_BEIGE = 'FFF5EFE3';
  const WHITE = 'FFFFFFFF';
  const HAIRLINE = 'FFE2E8F0';
  const TEXT_MUTED = 'FF94A3B8';
  const TEXT_DARK = 'FF0F172A';

  // Per-template flavour
  const flavour = {
    modern: {
      headingFont: 'Calibri',
      bodyFont:    'Calibri',
      titleSize:   34,
      eyebrowSize: 11,
      // Hero band on the cover
      heroFill:    PRIMARY,
      heroText:    WHITE,
      heroEyebrow: WHITE,
      heroAccentBar: ACCENT,
      // BOQ sheet title block
      boqTitleFill: PRIMARY,
      boqTitleText: WHITE,
      boqAccentStripe: ACCENT,
      // Section headers in the BOQ table
      sectionFill: PRIMARY,
      sectionText: WHITE,
      sectionWeight: 'bold',
      // Subtotal rows
      subtotalFill: ACCENT_TINT,
      subtotalText: TEXT_DARK,
      // Stat tiles on the cover
      statTileFill: PRIMARY_TINT,
      statTileText: PRIMARY,
      statTileLabel: TEXT_MUTED,
    },
    professional: {
      headingFont: 'Cambria',
      bodyFont:    'Calibri',
      titleSize:   32,
      eyebrowSize: 10,
      heroFill:    WHITE,
      heroText:    PRIMARY,
      heroEyebrow: ACCENT,
      heroAccentBar: PRIMARY,
      boqTitleFill: WHITE,
      boqTitleText: PRIMARY,
      boqAccentStripe: PRIMARY,
      sectionFill: WHITE,
      sectionText: PRIMARY,
      sectionWeight: 'bold',
      subtotalFill: WHITE,
      subtotalText: PRIMARY,
      statTileFill: WHITE,
      statTileText: PRIMARY,
      statTileLabel: TEXT_MUTED,
    },
    heritage: {
      headingFont: 'Cambria',
      bodyFont:    'Cambria',
      titleSize:   34,
      eyebrowSize: 10,
      heroFill:    HERITAGE_BEIGE,
      heroText:    PRIMARY,
      heroEyebrow: ACCENT,
      heroAccentBar: ACCENT,
      boqTitleFill: HERITAGE_BEIGE,
      boqTitleText: PRIMARY,
      boqAccentStripe: ACCENT,
      sectionFill: HERITAGE_BEIGE,
      sectionText: PRIMARY,
      sectionWeight: 'bold',
      subtotalFill: ACCENT_TINT,
      subtotalText: PRIMARY,
      statTileFill: HERITAGE_BEIGE,
      statTileText: PRIMARY,
      statTileLabel: TEXT_MUTED,
    },
    minimalist: {
      headingFont: 'Calibri Light',
      bodyFont:    'Calibri',
      titleSize:   38,
      eyebrowSize: 9.5,
      heroFill:    WHITE,
      heroText:    TEXT_DARK,
      heroEyebrow: TEXT_MUTED,
      heroAccentBar: TEXT_DARK,
      boqTitleFill: WHITE,
      boqTitleText: TEXT_DARK,
      boqAccentStripe: TEXT_DARK,
      sectionFill: WHITE,
      sectionText: TEXT_DARK,
      sectionWeight: 'bold',
      subtotalFill: WHITE,
      subtotalText: TEXT_DARK,
      statTileFill: WHITE,
      statTileText: TEXT_DARK,
      statTileLabel: TEXT_MUTED,
    },
  }[template];

  return {
    template,
    PRIMARY, ACCENT, PRIMARY_TINT, ACCENT_TINT,
    HAIRLINE, WHITE, TEXT_MUTED, TEXT_DARK,
    branding: b,
    flavour,
    primaryHex, accentHex,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// renderCoverSheet — adds a polished cover sheet to the workbook.
// Returns the cover worksheet so the caller can fill in any extra fields.
// ─────────────────────────────────────────────────────────────────────────────
function renderCoverSheet(wb, opts, style) {
  const {
    docKind = 'BILL OF QUANTITIES',
    projectName = 'Project',
    clientName = 'Client',
    issuedDate = new Date(),
    currency = '£',
    totals = { exVat: 0, inclVat: 0, labour: 0, materials: 0 },
    itemCount = 0,
    sectionCount = 0,
  } = opts;
  const f = style.flavour;
  const branding = style.branding || {};

  const cover = wb.addWorksheet('Cover', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4 } },
    views: [{ showGridLines: false }],
  });

  // 8 columns at width 11 ≈ A4 portrait
  cover.columns = [
    { width: 4 }, { width: 11 }, { width: 11 }, { width: 11 },
    { width: 11 }, { width: 11 }, { width: 11 }, { width: 4 },
  ];

  // Logo (top-left)
  if (branding.logo_path) {
    tryEmbedLogo(wb, cover, branding.logo_path, { tl: { col: 1, row: 1 }, ext: { width: 140, height: 56 } });
    cover.getRow(1).height = 14;
    cover.getRow(2).height = 14;
    cover.getRow(3).height = 14;
    cover.getRow(4).height = 14;
  } else {
    cover.getRow(1).height = 18;
    cover.getRow(2).height = 18;
    cover.getRow(3).height = 18;
    cover.getRow(4).height = 8;
  }

  // Company block top-right
  if (branding.company_name) {
    cover.mergeCells('E2:G2');
    const cn = cover.getCell('E2');
    cn.value = branding.company_name;
    cn.font = { name: f.headingFont, size: 13, bold: true, color: { argb: f.heroText === style.WHITE ? style.PRIMARY : f.heroText } };
    cn.alignment = { horizontal: 'right' };
  }
  if (branding.company_address) {
    cover.mergeCells('E3:G5');
    const ca = cover.getCell('E3');
    ca.value = branding.company_address;
    ca.font = { name: f.bodyFont, size: 9, color: { argb: style.TEXT_MUTED } };
    ca.alignment = { horizontal: 'right', vertical: 'top', wrapText: true };
  }

  // ── HERO BAND (rows 7-16) ──────────────────────────────────────────────────
  // Fill each hero cell individually rather than merging A:H per row — merging
  // here collides with the eyebrow/title merges below ("Cannot merge already
  // merged cells") and the whole Excel generation crashes, so the user only
  // ever sees the Word findings doc.
  const heroStart = 7;
  const heroEnd = 16;
  for (let r = heroStart; r <= heroEnd; r++) {
    cover.getRow(r).height = 22;
    if (f.heroFill !== style.WHITE) {
      for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
        cover.getCell(col + r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.heroFill } };
      }
    }
  }

  // Eyebrow text
  cover.mergeCells('B' + (heroStart + 1) + ':G' + (heroStart + 1));
  const eyebrow = cover.getCell('B' + (heroStart + 1));
  eyebrow.value = docKind;
  eyebrow.font = { name: f.headingFont, size: f.eyebrowSize, bold: true, color: { argb: f.heroEyebrow }, italic: false };
  eyebrow.alignment = { horizontal: 'left', vertical: 'middle', indent: 0 };

  // Big project title — spans 4 rows for visual presence
  cover.mergeCells('B' + (heroStart + 2) + ':G' + (heroStart + 5));
  const title = cover.getCell('B' + (heroStart + 2));
  title.value = projectName;
  title.font = { name: f.headingFont, size: f.titleSize, bold: true, color: { argb: f.heroText } };
  title.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

  // Prepared-for line inside hero
  cover.mergeCells('B' + (heroStart + 7) + ':G' + (heroStart + 7));
  const prep = cover.getCell('B' + (heroStart + 7));
  prep.value = 'Prepared for ' + clientName;
  prep.font = { name: f.bodyFont, size: 11, color: { argb: f.heroEyebrow } };
  prep.alignment = { horizontal: 'left', vertical: 'middle' };

  // Accent bar (row 17)
  cover.getRow(17).height = 8;
  cover.mergeCells('A17:H17');
  cover.getCell('A17').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.heroAccentBar } };

  // ── STAT TILES (rows 19-23) — 2x2 grid ─────────────────────────────────────
  cover.getRow(18).height = 12;
  const sym = currency;
  const tiles = [
    { label: 'TOTAL EX-VAT',   value: sym + Math.round(totals.exVat).toLocaleString('en-GB'),   col: 'B' },
    { label: 'TOTAL INCL-VAT', value: sym + Math.round(totals.inclVat).toLocaleString('en-GB'), col: 'E' },
    { label: 'ISSUED',         value: issuedDate instanceof Date
        ? issuedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
        : String(issuedDate), col: 'B', row2: true },
    { label: 'LINE ITEMS',     value: itemCount + ' items in ' + sectionCount + ' trade' + (sectionCount === 1 ? '' : 's'), col: 'E', row2: true },
  ];

  // First row of tiles (rows 19-21)
  cover.getRow(19).height = 16;
  cover.getRow(20).height = 26;
  cover.getRow(21).height = 16;
  // Second row of tiles (rows 23-25)
  cover.getRow(22).height = 8;
  cover.getRow(23).height = 14;
  cover.getRow(24).height = 22;
  cover.getRow(25).height = 12;

  function placeTile(label, value, startCol, endCol, labelRow, valueRow) {
    cover.mergeCells(startCol + labelRow + ':' + endCol + labelRow);
    const lc = cover.getCell(startCol + labelRow);
    lc.value = label;
    lc.font = { name: f.bodyFont, size: 9, bold: true, color: { argb: f.statTileLabel } };
    lc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

    cover.mergeCells(startCol + valueRow + ':' + endCol + valueRow);
    const vc = cover.getCell(startCol + valueRow);
    vc.value = value;
    vc.font = { name: f.headingFont, size: 18, bold: true, color: { argb: f.statTileText } };
    vc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    if (f.statTileFill !== style.WHITE) {
      // Cells are already merged above; just fill the top-left cell of each
      // merged range — re-calling mergeCells on an already-merged range
      // throws "Cannot merge already merged cells" and aborts the whole
      // workbook (the symptom was: only the Word findings doc got produced).
      cover.getCell(startCol + labelRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.statTileFill } };
      cover.getCell(startCol + valueRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.statTileFill } };
    }
  }

  placeTile('TOTAL EX-VAT',   tiles[0].value, 'B', 'D', 19, 20);
  placeTile('TOTAL INCL-VAT', tiles[1].value, 'E', 'G', 19, 20);
  placeTile('ISSUED',         tiles[2].value, 'B', 'D', 23, 24);
  placeTile('LINE ITEMS',     tiles[3].value, 'E', 'G', 23, 24);

  // ── LABOUR vs MATERIALS bar (rows 27-30) ───────────────────────────────────
  cover.getRow(26).height = 12;
  cover.mergeCells('B27:G27');
  cover.getCell('B27').value = 'LABOUR vs MATERIALS';
  cover.getCell('B27').font = { name: f.bodyFont, size: 9, bold: true, color: { argb: style.TEXT_MUTED } };
  cover.getCell('B27').alignment = { horizontal: 'left' };
  cover.getRow(27).height = 14;

  const totalLM = (totals.labour || 0) + (totals.materials || 0);
  if (totalLM > 0) {
    const labourPct = (totals.labour || 0) / totalLM;
    // Build a 6-cell bar across columns B-G; each cell = 1/6th
    cover.getRow(28).height = 18;
    for (let i = 0; i < 6; i++) {
      const colLetter = String.fromCharCode('B'.charCodeAt(0) + i);
      const fillColour = (i / 6) < labourPct ? style.PRIMARY : style.ACCENT;
      cover.getCell(colLetter + '28').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColour } };
    }
    cover.getRow(29).height = 6;
    cover.mergeCells('B30:G30');
    const legend = cover.getCell('B30');
    legend.value =
      'Labour ' + sym + Math.round(totals.labour).toLocaleString('en-GB') + ' (' + Math.round(labourPct * 100) + '%)' +
      '   ·   Materials ' + sym + Math.round(totals.materials).toLocaleString('en-GB') + ' (' + Math.round((1 - labourPct) * 100) + '%)';
    legend.font = { name: f.bodyFont, size: 10, color: { argb: style.TEXT_DARK } };
    legend.alignment = { horizontal: 'left' };
  }

  // Footer
  if (branding.footer_text) {
    cover.getRow(40).height = 16;
    cover.mergeCells('A40:H40');
    const ft = cover.getCell('A40');
    ft.value = branding.footer_text;
    ft.font = { name: f.bodyFont, size: 9, italic: true, color: { argb: style.TEXT_MUTED } };
    ft.alignment = { horizontal: 'center' };
  }

  // Common header/footer for printing
  cover.headerFooter.oddFooter = '&L' + (branding.footer_text || branding.company_name || 'The AI QS') + '&RPage &P';

  return cover;
}

// ─────────────────────────────────────────────────────────────────────────────
// renderHeroBlock — paints the top of a content sheet (BOQ tab / Client Copy
// tab) with a smaller branded hero, returning the row number where data
// should start.
// ─────────────────────────────────────────────────────────────────────────────
function renderHeroBlock(ws, opts, style, lastCol) {
  const f = style.flavour;
  const { docKind = 'BILL OF QUANTITIES', projectName = 'Project', clientName = 'Client', extraMeta = '' } = opts;
  const last = lastCol || 'I';

  // Rows 1-3: hero fill, big title. Fill the cells individually rather than
  // merging A:I per row — the rows below re-merge the same ranges for the
  // eyebrow / title / meta / accent stripe, and double-merging crashes
  // ExcelJS ("Cannot merge already merged cells").
  const heroCols = [];
  {
    const lastCharCode = last.charCodeAt(0);
    for (let cc = 'A'.charCodeAt(0); cc <= lastCharCode; cc++) heroCols.push(String.fromCharCode(cc));
  }
  for (let r = 1; r <= 4; r++) {
    if (f.boqTitleFill !== style.WHITE) {
      for (const col of heroCols) {
        ws.getCell(col + r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.boqTitleFill } };
      }
    }
  }

  // Eyebrow
  ws.mergeCells('A1:' + last + '1');
  ws.getCell('A1').value = docKind;
  ws.getCell('A1').font = { name: f.headingFont, size: 9.5, bold: true, color: { argb: f.heroEyebrow } };
  ws.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 18;

  // Big title
  ws.mergeCells('A2:' + last + '2');
  ws.getCell('A2').value = projectName;
  ws.getCell('A2').font = { name: f.headingFont, size: 22, bold: true, color: { argb: f.boqTitleText } };
  ws.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 32;

  // Meta line
  ws.mergeCells('A3:' + last + '3');
  ws.getCell('A3').value = 'Prepared for ' + clientName + '   ·   ' + new Date().toLocaleDateString('en-GB') + (extraMeta ? '   ·   ' + extraMeta : '');
  ws.getCell('A3').font = { name: f.bodyFont, size: 10, color: { argb: f.heroEyebrow } };
  ws.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(3).height = 18;

  // Accent stripe row 4
  ws.mergeCells('A4:' + last + '4');
  ws.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.boqAccentStripe } };
  ws.getRow(4).height = 6;

  return 5; // next row available
}

module.exports = {
  styleFor,
  renderCoverSheet,
  renderHeroBlock,
  hexToArgb,
  tintHex,
  tryEmbedLogo,
};
