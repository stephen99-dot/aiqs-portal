// Optional OCR for scanned / image-only drawings. Lazy-loads tesseract.js so it
// is NOT a hard dependency — if the package isn't installed, isEnabled() is
// false and callers simply skip OCR (the normal vision pipeline still runs).
//
// To enable in production:  npm install tesseract.js
//
// We use OCR only to recover *printed text* (dimension strings, areas, scale,
// schedules) from PDFs that have no embedded text layer — the same data
// pdfGeometry reads directly from vector PDFs.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let Tesseract = null;
let triedLoad = false;
function load() {
  if (triedLoad) return Tesseract;
  triedLoad = true;
  try { Tesseract = require('tesseract.js'); } catch (e) { Tesseract = null; }
  return Tesseract;
}

function isEnabled() { return !!load(); }

// OCR a single image buffer → plain text. Best-effort; returns '' on failure.
async function recognizeImage(buf) {
  const T = load();
  if (!T) return '';
  try {
    const { data } = await T.recognize(buf, 'eng');
    return (data && data.text) ? data.text : '';
  } catch (e) { return ''; }
}

// Render the first few pages of a scanned PDF to images (poppler) and OCR them.
// Returns the concatenated recognised text, or '' if OCR is unavailable.
async function ocrPdf(pdfPath, { maxPages = 4, dpi = 200 } = {}) {
  if (!isEnabled()) return '';
  const tmpDir = path.join(path.dirname(pdfPath), `ocr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    const result = spawnSync('pdftoppm', [
      '-r', String(dpi), '-png', '-f', '1', '-l', String(maxPages),
      pdfPath, path.join(tmpDir, 'pg'),
    ], { timeout: 120000, encoding: 'buffer' });
    if (result.status !== 0 && result.status !== null) return '';
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort().slice(0, maxPages);
    let text = '';
    for (const f of files) {
      const buf = fs.readFileSync(path.join(tmpDir, f));
      text += '\n' + await recognizeImage(buf);
    }
    return text.trim();
  } catch (e) {
    return '';
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
}

module.exports = { isEnabled, recognizeImage, ocrPdf };
