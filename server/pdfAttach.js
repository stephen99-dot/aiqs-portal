// Shared helpers for attaching PDFs extracted from a ZIP into Anthropic
// content blocks. Used by both the fast chat (server/chat.js) and the Deep
// BOQ pipeline (server/deepRoutes.js).
//
// The core problem this solves: zipProcessor.buildClaudeContent only forwards
// scanned images and a text note for image-based PDFs. It never attaches the
// actual PDF content, so Claude can't "see" the drawings. These helpers fill
// that gap — either as native Anthropic document blocks (PDFs under 30 MB) or
// per-page rasterised JPEGs (larger PDFs rendered via poppler's pdftoppm).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Anthropic limits (as of 2025): 32 MB per document, ~100 MB per request,
// 5 MB per image. We stay just under each to leave framing headroom.
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_PDF_BYTES = 90 * 1024 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_RASTER_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_PAGES = 40;
const RENDER_DPI = 150;

/**
 * Rasterise an over-cap PDF to per-page JPEG blocks via poppler's pdftoppm.
 * Returns { ok, blocks, pageCount, totalPages, totalMb, truncated } or
 * { ok: false, reason } on failure.
 */
function renderPdfToImageBlocks(pdfPath) {
  const tmpDir = path.join(path.dirname(pdfPath), `pdf_render_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    const result = spawnSync('pdftoppm', [
      '-r', String(RENDER_DPI), '-jpeg', '-jpegopt', 'quality=85',
      '-f', '1', '-l', String(MAX_PAGES),
      pdfPath, path.join(tmpDir, 'page'),
    ], { timeout: 120000, encoding: 'buffer' });

    if (result.status !== 0 && result.status !== null) {
      const stderr = result.stderr ? result.stderr.toString().substring(0, 200) : '';
      return { ok: false, reason: 'pdftoppm failed: ' + stderr };
    }

    const pageFiles = fs.readdirSync(tmpDir)
      .filter(f => f.startsWith('page') && (f.endsWith('.jpg') || f.endsWith('.jpeg')))
      .sort()
      .slice(0, MAX_PAGES);

    if (pageFiles.length === 0) {
      return { ok: false, reason: 'no pages rendered — PDF may be corrupted' };
    }

    const blocks = [];
    let totalBytes = 0;
    let truncated = false;
    for (const f of pageFiles) {
      const buf = fs.readFileSync(path.join(tmpDir, f));
      if (buf.length > MAX_IMAGE_BYTES) continue;
      if (totalBytes + buf.length > MAX_RASTER_TOTAL_BYTES && blocks.length > 0) {
        truncated = true;
        break;
      }
      totalBytes += buf.length;
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
      });
    }

    if (blocks.length === 0) {
      return { ok: false, reason: 'every rendered page exceeded 4 MB' };
    }

    return {
      ok: true,
      blocks,
      pageCount: blocks.length,
      totalPages: pageFiles.length,
      totalMb: (totalBytes / 1024 / 1024).toFixed(1),
      truncated,
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
}

/**
 * Decide how to attach a single PDF: as a native document block if small
 * enough, otherwise rasterised to per-page JPEGs. Returns { blocks, bytes,
 * note } — blocks to push onto content, bytes to accumulate toward the
 * request total cap, note describing what happened.
 *
 * pdf object shape: { filename, filePath, doc_type?, ... } — matches what
 * zipProcessor emits in zipData.files.
 */
function preparePdfForClaude(pdf, pdfBytesTotal) {
  if (!pdf.filePath) {
    return { blocks: [], bytes: 0, note: `${pdf.filename}: no filePath from zipProcessor` };
  }
  let buf;
  try { buf = fs.readFileSync(pdf.filePath); }
  catch (err) { return { blocks: [], bytes: 0, note: `${pdf.filename}: read failed — ${err.message}` }; }

  const sizeMb = (buf.length / 1024 / 1024).toFixed(1);

  // Path A: small enough for native document block
  if (buf.length <= MAX_PDF_BYTES && pdfBytesTotal + buf.length <= MAX_TOTAL_PDF_BYTES) {
    return {
      blocks: [
        { type: 'text', text: `[PDF drawing: ${pdf.filename}${pdf.doc_type ? ' — ' + pdf.doc_type : ''}]` },
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } },
      ],
      bytes: buf.length,
      note: `${pdf.filename}: attached as PDF (${sizeMb} MB)`,
    };
  }

  // Path B: too large — rasterise via poppler
  const rendered = renderPdfToImageBlocks(pdf.filePath);
  if (!rendered.ok) {
    return {
      blocks: [{ type: 'text', text: `[SKIPPED ${pdf.filename} — ${sizeMb} MB; rasterisation failed: ${rendered.reason}]` }],
      bytes: 0,
      note: `${pdf.filename}: ${sizeMb} MB, rasterisation failed: ${rendered.reason}`,
    };
  }

  const blocks = [{
    type: 'text',
    text: `[PDF drawing: ${pdf.filename}${pdf.doc_type ? ' — ' + pdf.doc_type : ''} — rasterised to ${rendered.pageCount}${rendered.truncated ? '+' : ''} pages at ${RENDER_DPI} DPI (source PDF ${sizeMb} MB)]`,
  }];
  for (const imgBlock of rendered.blocks) blocks.push(imgBlock);

  return {
    blocks,
    bytes: Math.round(parseFloat(rendered.totalMb) * 1024 * 1024),
    note: `${pdf.filename}: rasterised ${rendered.pageCount}${rendered.truncated ? '+' : ''} pages (source ${sizeMb} MB → ${rendered.totalMb} MB of JPEGs)`,
  };
}

/**
 * Loop over every PDF in zipData.files, pushing attachment blocks onto
 * `content` and collecting diagnostic notes. Returns { pdfNotes, attached }.
 */
function attachZipPdfs(zipData, content) {
  const pdfNotes = [];
  let pdfBytesTotal = 0;
  let attached = 0;
  const pdfs = (zipData && zipData.files) ? zipData.files.filter(fi => fi.type === 'pdf') : [];
  for (const pdf of pdfs) {
    const prep = preparePdfForClaude(pdf, pdfBytesTotal);
    pdfNotes.push(prep.note);
    if (prep.blocks && prep.blocks.length > 0) {
      for (const b of prep.blocks) content.push(b);
      pdfBytesTotal += (prep.bytes || 0);
      if (prep.bytes > 0) attached++;
    }
  }
  return { pdfNotes, attached };
}

module.exports = {
  MAX_PDF_BYTES,
  MAX_TOTAL_PDF_BYTES,
  preparePdfForClaude,
  renderPdfToImageBlocks,
  attachZipPdfs,
};
