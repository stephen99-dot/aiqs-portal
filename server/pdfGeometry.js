// Deterministic extraction of the PDF *text layer with positions* from vector
// construction drawings. The goal is accuracy: instead of asking the vision
// model to eyeball dimensions, we read the numbers that are actually printed on
// the sheet — scale labels, room areas, dimension strings and door/window
// schedules — and hand them to the model as ground truth.
//
// Pure pdf.js (no poppler, no canvas needed for text extraction). All functions
// are best-effort: any failure returns null/empty so the existing pipeline is
// never broken.

let pdfjs;
try {
  pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
} catch (e) {
  try { pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs'); } catch (e2) { pdfjs = null; }
}

const PT_TO_MM = 25.4 / 72;

function isEnabled() { return !!pdfjs; }

// Standard ISO sheet sizes (mm, portrait) for cross-checking scale.
const SHEETS = [
  { name: 'A0', w: 841, h: 1189 },
  { name: 'A1', w: 594, h: 841 },
  { name: 'A2', w: 420, h: 594 },
  { name: 'A3', w: 297, h: 420 },
  { name: 'A4', w: 210, h: 297 },
];
function detectSheet(wMm, hMm) {
  const lo = Math.min(wMm, hMm), hi = Math.max(wMm, hMm);
  for (const s of SHEETS) {
    if (Math.abs(lo - s.w) <= 6 && Math.abs(hi - s.h) <= 6) {
      return { name: s.name, orientation: wMm >= hMm ? 'landscape' : 'portrait' };
    }
  }
  return null;
}

// Pull a scale ratio (the N in 1:N) from a blob of sheet text. Prefers an
// explicit "Scale 1:50" label; falls back to a bare "1:50".
function detectScaleRatio(text) {
  if (!text) return null;
  const labelled = text.match(/scale[^0-9]{0,12}1\s*[:/]\s*(\d{1,4})/i);
  if (labelled) { const r = parseInt(labelled[1], 10); if (r >= 5 && r <= 2000) return r; }
  const bare = text.match(/\b1\s*[:/]\s*(\d{1,4})\b/);
  if (bare) { const r = parseInt(bare[1], 10); if (r >= 5 && r <= 2000) return r; }
  return null;
}

// Real-world mm represented by one rendered pixel, given the drawing scale and
// the DPI a page is rasterised at. paper_mm_per_px = 25.4/dpi; real = paper*ratio.
function mmPerPixel(scaleRatio, dpi) {
  if (!scaleRatio || !dpi) return null;
  return (25.4 / dpi) * scaleRatio;
}

// Room/space areas explicitly printed on the drawing, e.g. "12.5 m²", "12.5m2",
// "12.5 sq m". These are high-confidence and drive floor/finish quantities.
function parseAreas(text) {
  const out = [];
  if (!text) return out;
  const re = /(\d{1,3}(?:\.\d{1,2})?)\s*(?:m²|m2|sq\.?\s*m|sqm)\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = parseFloat(m[1]);
    if (v >= 1 && v <= 2000) out.push(v);
  }
  return out;
}

// Bare dimension strings on plans, typically millimetres (e.g. 3500, 12500) or
// metres (e.g. 3.5m). Returned with positions so the model can relate them to
// elements. Conservative ranges to avoid capturing levels/reference numbers.
function parseDimensions(items) {
  const dims = [];
  for (const it of items) {
    const s = (it.str || '').trim();
    if (!s) continue;
    let m;
    if ((m = s.match(/^(\d{3,5})$/))) {
      const v = parseInt(m[1], 10);
      if (v >= 200 && v <= 60000) dims.push({ raw: s, mm: v, x: it.x, y: it.y });
    } else if ((m = s.match(/^(\d{1,2}(?:\.\d{1,3})?)\s*m$/i))) {
      const v = parseFloat(m[1]) * 1000;
      if (v >= 200 && v <= 60000) dims.push({ raw: s, mm: v, x: it.x, y: it.y });
    }
  }
  return dims;
}

// Detect door/window schedule rows. Architectural schedules tag openings with
// codes like W01, D03, WD12. We count distinct codes and capture any sizes.
function parseSchedules(text) {
  const result = { windows: [], doors: [] };
  if (!text) return result;
  const codeRe = /\b([WD]{1,2})\s*-?\s*(\d{1,3})\b/g;
  const seen = new Set();
  let m;
  while ((m = codeRe.exec(text)) !== null) {
    const prefix = m[1].toUpperCase();
    const code = prefix + m[2].padStart(2, '0');
    if (seen.has(code)) continue;
    seen.add(code);
    if (prefix.startsWith('W') && !prefix.startsWith('WD')) result.windows.push(code);
    else if (prefix.startsWith('D')) result.doors.push(code);
    else result.windows.push(code);
  }
  // Common opening sizes like 1200x1200, 900 x 2100 (w x h in mm)
  const sizeRe = /\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/g;
  const sizes = [];
  while ((m = sizeRe.exec(text)) !== null) {
    const w = parseInt(m[1], 10), h = parseInt(m[2], 10);
    if (w >= 200 && w <= 6000 && h >= 200 && h <= 6000) sizes.push(`${w}x${h}`);
  }
  result.sizes = Array.from(new Set(sizes)).slice(0, 30);
  return result;
}

async function extractPdf(buf, { maxPages = 24 } = {}) {
  if (!pdfjs) return null;
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
    }).promise;
  } catch (e) {
    return null;
  }

  const pages = [];
  const nPages = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= nPages; p++) {
    try {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const widthMm = Math.round(vp.width * PT_TO_MM);
      const heightMm = Math.round(vp.height * PT_TO_MM);
      const tc = await page.getTextContent();
      const items = tc.items.map(it => ({
        str: it.str,
        x: it.transform ? it.transform[4] : 0,
        y: it.transform ? it.transform[5] : 0,
      })).filter(it => it.str && it.str.trim());
      const text = items.map(it => it.str).join(' ');
      pages.push({
        index: p,
        widthMm, heightMm,
        sheet: detectSheet(widthMm, heightMm),
        scaleRatio: detectScaleRatio(text),
        textChars: text.length,
        areas: parseAreas(text),
        dimensions: parseDimensions(items).slice(0, 60),
        schedules: parseSchedules(text),
      });
      page.cleanup();
    } catch (e) { /* skip page */ }
  }
  try { doc.destroy(); } catch (e) {}
  if (pages.length === 0) return null;

  // Roll-up summary across the set.
  const scales = [...new Set(pages.map(p => p.scaleRatio).filter(Boolean))];
  const allAreas = pages.flatMap(p => p.areas);
  const windowCodes = new Set(), doorCodes = new Set();
  pages.forEach(p => { p.schedules.windows.forEach(c => windowCodes.add(c)); p.schedules.doors.forEach(c => doorCodes.add(c)); });
  return {
    pageCount: doc.numPages,
    pagesAnalysed: pages.length,
    pages,
    scales,
    scaleConsistent: scales.length <= 1,
    roomAreas: allAreas,
    windowCount: windowCodes.size,
    doorCount: doorCodes.size,
    isVector: pages.some(p => p.textChars > 40), // text layer present → vector PDF
  };
}

// Page sizes in PDF points (1/72") — used to map normalised zoom coordinates
// to pixel crop boxes when rendering a region at high DPI.
async function getPageSizes(buf, maxPages = 60) {
  if (!pdfjs) return null;
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true }).promise;
  } catch (e) { return null; }
  const sizes = [];
  const n = Math.min(doc.numPages, maxPages);
  for (let p = 1; p <= n; p++) {
    try { const vp = (await doc.getPage(p)).getViewport({ scale: 1 }); sizes.push({ index: p, wPt: vp.width, hPt: vp.height }); }
    catch (e) {}
  }
  try { doc.destroy(); } catch (e) {}
  return { pageCount: doc.numPages, sizes };
}

// Format extraction as an authoritative prompt block. Kept tight so it sharpens
// rather than floods the model's context.
function formatForPrompt(result, filename) {
  if (!result) return '';
  const lines = [];
  lines.push(`File: ${filename || 'drawing.pdf'} (${result.pagesAnalysed}/${result.pageCount} pages read from the PDF text layer)`);
  if (!result.isVector) {
    lines.push(`This PDF has little/no embedded text (likely scanned or image-based) — rely on the rendered images and zoom_region for measurements.`);
  }
  if (result.scales.length) {
    lines.push(`Drawing scale(s) detected: ${result.scales.map(s => '1:' + s).join(', ')}${result.scaleConsistent ? '' : ' — WARNING: scale differs between sheets, check each sheet individually'}.`);
  }
  for (const p of result.pages) {
    const bits = [];
    if (p.sheet) bits.push(`${p.sheet.name} ${p.sheet.orientation}`);
    if (p.scaleRatio) bits.push(`scale 1:${p.scaleRatio}`);
    if (p.areas.length) bits.push(`areas printed: ${p.areas.slice(0, 12).map(a => a + 'm²').join(', ')}`);
    if (p.dimensions.length) bits.push(`dimension strings: ${p.dimensions.slice(0, 16).map(d => d.raw).join(', ')}`);
    if (p.schedules.windows.length || p.schedules.doors.length) bits.push(`openings: ${p.schedules.windows.length} window code(s), ${p.schedules.doors.length} door code(s)`);
    if (bits.length) lines.push(`  • Page ${p.index}: ${bits.join('; ')}`);
  }
  if (result.windowCount || result.doorCount) {
    lines.push(`Total distinct opening codes across set: ${result.windowCount} windows, ${result.doorCount} doors — each should be a separate BOQ line unless the schedule says otherwise.`);
  }
  return `\n=== MEASURED FROM THE DRAWINGS (authoritative — read, do not estimate) ===\n` +
    `The following were extracted directly from the PDF text layer. Treat printed dimensions, areas and schedules as ground truth and use them instead of visually estimating. If a value here conflicts with what you think you see, trust these printed values.\n\n` +
    lines.join('\n') +
    `\n===\n`;
}

// Turn an arbitrary text blob (e.g. OCR output from a scanned drawing) into a
// ground-truth prompt block using the same parsers.
function parsePlainText(text, filename) {
  if (!text || text.length < 20) return '';
  const scale = detectScaleRatio(text);
  const areas = parseAreas(text);
  const sched = parseSchedules(text);
  const lines = [`File: ${filename || 'scan.pdf'} (recovered via OCR)`];
  if (scale) lines.push(`Scale annotation found: 1:${scale}`);
  if (areas.length) lines.push(`Areas printed: ${areas.slice(0, 12).map(a => a + 'm²').join(', ')}`);
  if (sched.windows.length || sched.doors.length) lines.push(`Openings: ${sched.windows.length} window code(s), ${sched.doors.length} door code(s)${sched.sizes && sched.sizes.length ? '; sizes: ' + sched.sizes.slice(0, 12).join(', ') : ''}`);
  if (lines.length <= 1) return '';
  return `\n=== RECOVERED FROM SCANNED DRAWING (OCR — verify against the image) ===\n` +
    `This PDF had no embedded text layer; the following were read via OCR. Treat as strong hints but confirm against the rendered image before relying on them.\n\n` +
    lines.join('\n') + `\n===\n`;
}

module.exports = { isEnabled, extractPdf, formatForPrompt, detectScaleRatio, mmPerPixel, detectSheet, getPageSizes, parsePlainText };
