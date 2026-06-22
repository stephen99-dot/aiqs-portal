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
// sharp is optional at runtime — load lazily so doc generation never hard-fails
// if the native binary is missing in some environment.
let _sharp;
function getSharp() {
  if (_sharp === undefined) {
    try { _sharp = require('sharp'); } catch (e) { _sharp = null; }
  }
  return _sharp;
}

// Resolve a customer's logo into an embeddable PNG buffer plus its natural
// pixel dimensions. We rasterise through sharp so *any* uploaded format works
// — including SVG and WebP, which ExcelJS cannot embed directly and which were
// previously dropped silently (the "logo doesn't show" bug). Returns null when
// there is no logo or it can't be read.
async function resolveLogo(branding) {
  const p = branding && branding.logo_path;
  if (!p || !fs.existsSync(p)) return null;

  const sharpLib = getSharp();
  if (sharpLib) {
    try {
      // density helps vector (SVG) logos rasterise crisply rather than blurry.
      const img = sharpLib(p, { density: 300 });
      const meta = await img.metadata();
      const buffer = await img.png().toBuffer();
      return {
        buffer,
        extension: 'png',
        naturalWidth: meta.width || 0,
        naturalHeight: meta.height || 0,
      };
    } catch (e) { /* fall through to raw embed below */ }
  }

  // Fallback when sharp is unavailable (or failed): embed the file as-is IF its
  // bytes really are a raster ExcelJS can read (PNG/JPEG/GIF) — keyed on the
  // file's magic number, NOT its stored extension. This way a valid logo still
  // embeds even if it was saved with an odd/wrong extension. (A non-raster like
  // SVG/WebP can't be embedded without sharp, so it returns null rather than
  // corrupt the workbook.)
  try {
    const buffer = fs.readFileSync(p);
    const rasterExt = rasterExtensionOf(buffer);
    if (rasterExt) {
      return { buffer, extension: rasterExt, naturalWidth: 0, naturalHeight: 0 };
    }
  } catch (e) { /* unreadable file */ }
  return null;
}

// Identify a raster ExcelJS can embed from its magic number; null otherwise.
function rasterExtensionOf(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
  return null;
}

// Scale natural dimensions to fit inside a box while preserving aspect ratio,
// so a square logo is never stretched into a wide letterbox.
function fitWithin(natW, natH, maxW, maxH) {
  if (!natW || !natH) return { width: maxW, height: maxH };
  const scale = Math.min(maxW / natW, maxH / natH);
  return { width: Math.max(1, Math.round(natW * scale)), height: Math.max(1, Math.round(natH * scale)) };
}

// ExcelJS embeds the raw bytes we hand it as-is. If those bytes aren't actually
// a raster image (e.g. an SVG, or an upload mislabeled .png that slipped past
// rasterisation), Excel can't read the resulting media part — it strips it and
// warns the user the workbook "had unreadable content" (Repaired Part: the
// sheet that hosts the logo). So only embed bytes whose magic number is a real
// PNG / JPEG / GIF; anything else means we skip the logo rather than corrupt
// the whole file.
function isEmbeddableRaster(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;                     // JPEG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;  // GIF
  return false;
}

// Embed a pre-resolved logo (see resolveLogo) at top-left anchor `tl`, fitted
// within { maxWidth, maxHeight }. Returns the rendered { width, height } or null.
function embedResolvedLogo(wb, ws, logo, tl, box) {
  if (!logo || !logo.buffer || !isEmbeddableRaster(logo.buffer)) return null;
  try {
    const { width, height } = fitWithin(logo.naturalWidth, logo.naturalHeight, box.maxWidth, box.maxHeight);
    const id = wb.addImage({ buffer: logo.buffer, extension: logo.extension || 'png' });
    ws.addImage(id, { tl, ext: { width, height } });
    return { width, height };
  } catch (e) { return null; }
}

// Back-compat sync helper (raster formats only). Kept for any external callers.
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

// ─── Text hygiene for cover/hero copy ────────────────────────────────────────
// Strip characters that are illegal inside the XML the XLSX is built from.
// ExcelJS escapes the C0 control range but lets a handful of code points
// through verbatim — Unicode non-characters (U+FFFE/U+FFFF and the
// U+FDD0–U+FDEF block) and lone UTF-16 surrogates. These routinely arrive in
// BOQ text scraped out of PDFs, and a single one anywhere in a sheet makes
// the whole workbook fail to open ("We found a problem with some content").
// We scrub every data-derived string before it reaches a cell so the file is
// always valid. Tabs / newlines / carriage returns are kept — they're legal.
function sanitizeXmlText(value) {
  if (value == null) return value;
  return String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')        // XML-forbidden C0 controls
    .replace(/[\uFDD0-\uFDEF\uFFFE\uFFFF]/g, '')             // Unicode non-characters
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')   // lone high surrogate
    .replace(/([^\uD800-\uDBFF]|^)([\uDC00-\uDFFF])/g, '$1'); // lone low surrogate
}

// Collapse stray whitespace (incl. trailing spaces baked into branding fields)
// and scrub any XML-illegal characters so cover/hero copy can never corrupt.
function cleanText(s) {
  if (s == null) return '';
  return sanitizeXmlText(String(s)).replace(/\s+/g, ' ').trim();
}

// Tidy a person/company name's capitalisation: fix ALL-CAPS or all-lowercase
// words to Title Case, but leave words that already carry intentional mixed
// case (McDonald, O'Brien, MacLeod) untouched.
function tidyName(s) {
  const t = cleanText(s);
  if (!t) return t;
  return t.split(' ').map((w) => {
    const letters = w.replace(/[^A-Za-z]/g, '');
    if (!letters) return w;
    const isAllUpper = letters === letters.toUpperCase();
    const isAllLower = letters === letters.toLowerCase();
    if (!isAllUpper && !isAllLower) return w; // already mixed case — keep as typed
    return w.replace(/[A-Za-z][A-Za-z']*/g, (run) => run.charAt(0).toUpperCase() + run.slice(1).toLowerCase());
  }).join(' ');
}

// Strip a date that's been appended to a project title (e.g.
// "Residential Extension — 09/06/2026") so the hero title reads as a title.
// The date still appears in the ISSUED tile, so nothing is lost.
function stripTrailingDate(s) {
  const t = cleanText(s);
  if (!t) return t;
  let out = t
    .replace(/[\s,·|]*[—–-]?\s*\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}\s*$/, '')
    .replace(/[\s,·|]*[—–-]\s*(?:19|20)\d{2}\s*$/, '');
  out = cleanText(out);
  return out || t; // never return empty
}

// Pick a hero title font size that keeps the title on ~1–2 lines (so it reads
// across the page rather than stacking one word per line down the page).
function titleSizeFor(text, baseSize) {
  const len = cleanText(text).length;
  const cap = baseSize || 32;
  let size = cap;
  if (len > 16) size = Math.min(cap, 30);
  if (len > 24) size = Math.min(cap, 26);
  if (len > 34) size = Math.min(cap, 22);
  if (len > 46) size = Math.min(cap, 18);
  if (len > 62) size = Math.min(cap, 15);
  return size;
}

// Perceived brightness of an ARGB colour (0–255).
function luminanceOf(argb) {
  const h = String(argb || '').replace(/^FF/i, '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 0;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Choose black or white text for legibility against a given background, so the
// hero copy is never near-invisible white on a light brand colour.
function idealTextOn(argb) {
  return luminanceOf(argb) > 150 ? 'FF0F172A' : 'FFFFFFFF';
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
async function renderCoverSheet(wb, opts, style) {
  const {
    docKind = 'BILL OF QUANTITIES',
    issuedDate = new Date(),
    currency = '£',
    totals = { exVat: 0, inclVat: 0, labour: 0, materials: 0 },
    itemCount = 0,
    sectionCount = 0,
  } = opts;
  // Clean up the human-entered copy: trim stray whitespace, drop a date that's
  // been appended to the project title, and normalise odd name capitalisation.
  const projectName = stripTrailingDate(opts.projectName || 'Project');
  const clientName = tidyName(opts.clientName || 'Client');
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

  // Logo (top-left) — rasterised through sharp and fitted to a box so any
  // upload format (incl. SVG/WebP) shows and the aspect ratio is preserved.
  const logo = await resolveLogo(branding);
  let logoH = 0;
  if (logo) {
    const placed = embedResolvedLogo(wb, cover, logo, { col: 1, row: 1 }, { maxWidth: 150, maxHeight: 64 });
    if (placed) logoH = placed.height;
  }
  // Size the header rows so the logo sits comfortably above the hero band.
  if (logoH > 0) {
    const total = logoH + 16;            // logo height + a little breathing room
    cover.getRow(1).height = 6;          // top margin
    const each = Math.ceil((total - 6) / 3);
    cover.getRow(2).height = each;
    cover.getRow(3).height = each;
    cover.getRow(4).height = each;
  } else {
    cover.getRow(1).height = 18;
    cover.getRow(2).height = 18;
    cover.getRow(3).height = 18;
    cover.getRow(4).height = 8;
  }

  // Company block top-right
  const companyName = cleanText(branding.company_name);
  const companyAddress = cleanText(branding.company_address);
  if (companyName) {
    cover.mergeCells('E2:G2');
    const cn = cover.getCell('E2');
    cn.value = companyName;
    cn.font = { name: f.headingFont, size: 13, bold: true, color: { argb: f.heroText === style.WHITE ? style.PRIMARY : f.heroText } };
    cn.alignment = { horizontal: 'right', vertical: 'middle' };
  }
  if (companyAddress) {
    cover.mergeCells('E3:G5');
    const ca = cover.getCell('E3');
    ca.value = companyAddress;
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

  // Pick text colours that stay legible against the hero band. On a coloured
  // band we derive black/white from the fill's brightness, so a light brand
  // colour never ends up with near-invisible white text.
  const onColouredBand = f.heroFill !== style.WHITE;
  const heroTitleCol = onColouredBand ? idealTextOn(f.heroFill) : f.heroText;
  const heroEyebrowCol = onColouredBand ? idealTextOn(f.heroFill) : f.heroEyebrow;

  // Eyebrow text
  cover.mergeCells('B' + (heroStart + 1) + ':G' + (heroStart + 1));
  const eyebrow = cover.getCell('B' + (heroStart + 1));
  eyebrow.value = docKind;
  eyebrow.font = { name: f.headingFont, size: f.eyebrowSize, bold: true, color: { argb: heroEyebrowCol }, italic: false };
  eyebrow.alignment = { horizontal: 'left', vertical: 'middle', indent: 0 };

  // Big project title. IMPORTANT: wrapText must stay OFF — with it on, low-
  // fidelity viewers (and email/preview panes) that ignore the merged range
  // wrap the title inside the single narrow anchor column, so it stacks a few
  // characters per line straight down the page. With wrap off the text flows
  // horizontally across the (empty) hero cells, exactly like the eyebrow does.
  cover.mergeCells('B' + (heroStart + 2) + ':G' + (heroStart + 5));
  const title = cover.getCell('B' + (heroStart + 2));
  title.value = projectName;
  title.font = { name: f.headingFont, size: titleSizeFor(projectName, f.titleSize), bold: true, color: { argb: heroTitleCol } };
  title.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };

  // Prepared-for line inside hero
  cover.mergeCells('B' + (heroStart + 7) + ':G' + (heroStart + 7));
  const prep = cover.getCell('B' + (heroStart + 7));
  prep.value = 'Prepared for ' + clientName;
  prep.font = { name: f.bodyFont, size: 11, color: { argb: heroEyebrowCol } };
  prep.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false };

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
  const footerText = cleanText(branding.footer_text);
  if (footerText) {
    cover.getRow(40).height = 16;
    cover.mergeCells('A40:H40');
    const ft = cover.getCell('A40');
    ft.value = footerText;
    ft.font = { name: f.bodyFont, size: 9, italic: true, color: { argb: style.TEXT_MUTED } };
    ft.alignment = { horizontal: 'center' };
  }

  // Common header/footer for printing
  cover.headerFooter.oddFooter = '&L' + (footerText || companyName || 'The AI QS') + '&RPage &P';

  return cover;
}

// ─────────────────────────────────────────────────────────────────────────────
// renderHeroBlock — paints the top of a content sheet (BOQ tab / Client Copy
// tab) with a smaller branded hero, returning the row number where data
// should start.
// ─────────────────────────────────────────────────────────────────────────────
function renderHeroBlock(ws, opts, style, lastCol) {
  const f = style.flavour;
  const { docKind = 'BILL OF QUANTITIES', extraMeta = '' } = opts;
  const projectName = stripTrailingDate(opts.projectName || 'Project');
  const clientName = tidyName(opts.clientName || 'Client');
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

  // Keep hero text legible against the title fill (black/white by brightness).
  const onColoured = f.boqTitleFill !== style.WHITE;
  const titleCol = onColoured ? idealTextOn(f.boqTitleFill) : f.boqTitleText;
  const metaCol = onColoured ? idealTextOn(f.boqTitleFill) : f.heroEyebrow;

  // Eyebrow
  ws.mergeCells('A1:' + last + '1');
  ws.getCell('A1').value = docKind;
  ws.getCell('A1').font = { name: f.headingFont, size: 9.5, bold: true, color: { argb: metaCol } };
  ws.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 18;

  // Big title — wrap OFF so it flows horizontally even where merges are ignored.
  ws.mergeCells('A2:' + last + '2');
  ws.getCell('A2').value = projectName;
  ws.getCell('A2').font = { name: f.headingFont, size: titleSizeFor(projectName, 22), bold: true, color: { argb: titleCol } };
  ws.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: false };
  ws.getRow(2).height = 32;

  // Meta line
  ws.mergeCells('A3:' + last + '3');
  ws.getCell('A3').value = 'Prepared for ' + clientName + '   ·   ' + new Date().toLocaleDateString('en-GB') + (cleanText(extraMeta) ? '   ·   ' + cleanText(extraMeta) : '');
  ws.getCell('A3').font = { name: f.bodyFont, size: 10, color: { argb: metaCol } };
  ws.getCell('A3').alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: false };
  ws.getRow(3).height = 18;

  // Accent stripe row 4
  ws.mergeCells('A4:' + last + '4');
  ws.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.boqAccentStripe } };
  ws.getRow(4).height = 6;

  return 5; // next row available
}

// ExcelJS hardcodes horizontalDpi / verticalDpi to 4294967295 (0xFFFFFFFF) on
// every worksheet's pageSetup. That value is out of the range Excel accepts, so
// Excel declares the workbook damaged ("We found a problem with some content")
// and strips the worksheet on open — the corruption customers were hitting on
// the Client Copy. Other XML validators (saxes, openpyxl, ExcelJS itself) accept
// it, which is why it hid for so long. Force a valid printer DPI on every sheet,
// then write — use this everywhere instead of wb.xlsx.writeBuffer().
function fixXlsxDpi(wb) {
  wb.eachSheet((ws) => {
    try {
      ws.pageSetup = { ...(ws.pageSetup || {}), horizontalDpi: 300, verticalDpi: 300 };
    } catch (e) { /* non-fatal: still write the book */ }
  });
  return wb;
}
async function writeXlsxBuffer(wb) {
  fixXlsxDpi(wb);
  return wb.xlsx.writeBuffer();
}

module.exports = {
  styleFor,
  renderCoverSheet,
  renderHeroBlock,
  writeXlsxBuffer,
  fixXlsxDpi,
  hexToArgb,
  tintHex,
  tryEmbedLogo,
  resolveLogo,
  embedResolvedLogo,
  fitWithin,
  cleanText,
  sanitizeXmlText,
  tidyName,
  stripTrailingDate,
  titleSizeFor,
};
