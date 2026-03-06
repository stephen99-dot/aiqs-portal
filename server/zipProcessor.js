/**
 * zipProcessor.js
 *
 * Pre-processing pipeline for ZIP uploads containing mixed file types.
 * Runs BEFORE Claude sees anything. Extracts structured data from every file.
 *
 * Output is a structured "project package" containing:
 *   - annotated_dimensions: all dimensions found in PDFs/drawings
 *   - room_schedule: rooms with areas from Excel schedules
 *   - door_window_schedule: openings with sizes
 *   - spec_notes: key spec items from Word/PDF specs
 *   - excel_data: all tabular data from Excel files
 *   - drawing_index: what drawings were found and what they show
 *   - images: base64 encoded images for Claude to vision-analyse
 *   - raw_text: all extracted text per file for Claude context
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
let pdfScaleReader = null;
try { pdfScaleReader = require('./pdfScaleReader'); } catch(e) { console.log('[ZIP] pdfScaleReader not found — scale measurement disabled'); }

// ─── INSTALL DEPS CHECK ───────────────────────────────────────────────────────
function ensureDeps() {
  const deps = ['adm-zip', 'pdf-parse', 'xlsx', 'mammoth'];
  for (const dep of deps) {
    try { require.resolve(dep); }
    catch (e) {
      console.log(`[ZIP] Installing ${dep}...`);
      try { execSync(`npm install ${dep} --no-save`, { stdio: 'pipe' }); }
      catch (err) { console.warn(`[ZIP] Could not install ${dep}: ${err.message}`); }
    }
  }
}

// ─── DIMENSION EXTRACTION ─────────────────────────────────────────────────────

/**
 * Extract all dimension annotations from raw text
 * Looks for patterns like: 6200, 2.7m, 6200mm, 6.2m x 2.7m, 2700 x 1200
 */
function extractDimensions(text, filename) {
  const dimensions = [];
  const lines = text.split(/\n/);

  // Patterns for dimensions
  const patterns = [
    // metric with units: 6200mm, 2.7m, 6200 mm
    /(\d+(?:\.\d+)?)\s*(?:mm|m|M|MM)\b/g,
    // dimensions like 6200 x 2700 or 6200 × 2700
    /(\d+(?:\.\d+)?)\s*[x×X]\s*(\d+(?:\.\d+)?)\s*(?:mm|m)?/g,
    // bare numbers likely to be dimensions (3-5 digits in drawing context)
    /\b(\d{3,5})\b/g,
  ];

  // Context-aware extraction
  const dimensionContexts = [
    /(?:width|wide|w[=:])\s*(\d+(?:\.\d+)?)\s*(?:mm|m)?/gi,
    /(?:height|high|h[=:])\s*(\d+(?:\.\d+)?)\s*(?:mm|m)?/gi,
    /(?:depth|deep|d[=:])\s*(\d+(?:\.\d+)?)\s*(?:mm|m)?/gi,
    /(?:length|long|l[=:])\s*(\d+(?:\.\d+)?)\s*(?:mm|m)?/gi,
    /(?:area|floor area)\s*[=:]\s*(\d+(?:\.\d+)?)\s*(?:m²|m2|sqm|sq\.?m)/gi,
    /(?:ceiling|ch|c\/h)\s*[=:@]\s*(\d+(?:\.\d+)?)\s*(?:mm|m)?/gi,
  ];

  const found = new Set();

  // Extract contextual dimensions (highest confidence)
  for (const pattern of dimensionContexts) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const val = parseFloat(match[1]);
      if (val > 0 && val < 100000) {
        const key = `${match[0].toLowerCase().trim()}`;
        if (!found.has(key)) {
          found.add(key);
          dimensions.push({
            raw: match[0].trim(),
            value: val,
            unit: match[0].match(/mm/i) ? 'mm' : 'm',
            confidence: 'high',
            source: filename,
          });
        }
      }
    }
  }

  // Extract dimension pairs (e.g. "6200 x 2700" = width x height)
  const pairPattern = /(\d{3,5})\s*[x×X]\s*(\d{3,5})/g;
  let pairMatch;
  while ((pairMatch = pairPattern.exec(text)) !== null) {
    const [, w, h] = pairMatch;
    // Find context around this match
    const start = Math.max(0, pairMatch.index - 50);
    const ctx = text.slice(start, pairMatch.index + pairMatch[0].length + 50);
    dimensions.push({
      raw: pairMatch[0],
      width_mm: parseInt(w),
      height_mm: parseInt(h),
      context: ctx.replace(/\s+/g, ' ').trim(),
      unit: 'mm',
      confidence: 'medium',
      source: filename,
    });
  }

  return dimensions;
}

/**
 * Extract room/space data from text
 */
function extractRooms(text, filename) {
  const rooms = [];
  const roomPatterns = [
    // "Kitchen: 12.5m²" or "Kitchen 3200 x 3900"
    /([A-Z][a-z]+(?:\s[A-Z]?[a-z]+)?)\s*[:\-–]\s*(\d+(?:\.\d+)?)\s*(?:m²|m2|sqm)/gi,
    // Room schedule format: name + area in table
    /\b(bedroom|bathroom|kitchen|living|dining|lounge|hall|study|utility|wc|shower|en.?suite|landing|store|garage|office|reception)\b[^\n]{0,40}?(\d+(?:\.\d+)?)\s*(?:m²|m2)/gi,
  ];

  for (const pattern of roomPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      rooms.push({
        name: match[1].trim(),
        area_m2: parseFloat(match[2]),
        source: filename,
      });
    }
  }
  return rooms;
}

/**
 * Extract door/window schedule data
 */
function extractOpenings(text, filename) {
  const openings = [];
  // Patterns like: D01 900x2100, W01 1200x1200, or Door 01: 900 x 2100
  const patterns = [
    /([DW]\d{2,3})\s*[:\-–]?\s*(\d{3,4})\s*[x×X]\s*(\d{3,4})/gi,
    /(?:door|window)\s*(?:ref\.?\s*)?([A-Z]?\d{2,3})\s*[:\-–]?\s*(\d{3,4})\s*[x×X]\s*(\d{3,4})/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      openings.push({
        ref: match[1],
        type: match[0].toLowerCase().startsWith('d') ? 'door' : 'window',
        width_mm: parseInt(match[2]),
        height_mm: parseInt(match[3]),
        source: filename,
      });
    }
  }
  return openings;
}

/**
 * Classify what type of drawing/document this is
 */
function classifyDocument(filename, text) {
  const fn = filename.toLowerCase();
  const tx = text.toLowerCase();

  if (/floor.?plan|plan\s*\d|gf\s*plan|ff\s*plan|ground.?floor|first.?floor/.test(fn + tx)) return 'floor_plan';
  if (/elevation|front\s+elev|rear\s+elev|side\s+elev/.test(fn + tx)) return 'elevation';
  if (/section|cross.?section/.test(fn + tx)) return 'section';
  if (/roof\s*plan|roofing/.test(fn + tx)) return 'roof_plan';
  if (/site\s*plan|block\s*plan|location/.test(fn + tx)) return 'site_plan';
  if (/door\s*schedule|window\s*schedule|opening\s*schedule/.test(fn + tx)) return 'schedule';
  if (/specification|spec\s*\d|nbs|work\s*section/.test(fn + tx)) return 'specification';
  if (/bill\s*of\s*quantities|boq|schedule\s*of\s*works/.test(fn + tx)) return 'boq';
  if (/structural|engineer|se-\d|foundation/.test(fn + tx)) return 'structural';
  if (/room\s*data|room\s*schedule/.test(fn + tx)) return 'room_schedule';
  if (/\.(xlsx?|csv)$/.test(fn)) return 'spreadsheet';
  if (/photo|site\s*photo|existing/.test(fn + tx)) return 'site_photo';
  return 'drawing';
}

// ─── FILE TYPE HANDLERS ───────────────────────────────────────────────────────

async function extractFromPDF(filePath, filename) {
  try {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    const text = data.text || '';
    return {
      filename,
      type: 'pdf',
      page_count: data.numpages,
      text,
      text_length: text.length,
      has_text: text.length > 100,
      dimensions: extractDimensions(text, filename),
      rooms: extractRooms(text, filename),
      openings: extractOpenings(text, filename),
      doc_type: classifyDocument(filename, text),
      needs_vision: text.length < 200,
      // Store file path for scale rendering
      filePath,
    };
  } catch (e) {
    console.warn(`[ZIP] PDF parse failed for ${filename}: ${e.message}`);
    return { filename, type: 'pdf', text: '', has_text: false, needs_vision: true, error: e.message, filePath };
  }
}

async function extractFromExcel(filePath, filename) {
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath, { cellText: true, cellNF: false });
    const sheets = {};
    const allText = [];
    const rooms = [];
    const openings = [];
    const dimensions = [];
    const schedules = {};

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      // Convert to readable text
      const rows = json.filter(r => r.some(c => c !== ''));
      sheets[sheetName] = rows;

      const sheetText = rows.map(r => r.join('\t')).join('\n');
      allText.push(`[Sheet: ${sheetName}]\n${sheetText}`);

      // Detect schedule type
      const headerRow = rows[0] || [];
      const headers = headerRow.map(h => String(h).toLowerCase());

      if (headers.some(h => /room|space|area|m²|m2/.test(h))) {
        // Room schedule
        const areaIdx = headers.findIndex(h => /area|m²|m2/.test(h));
        const nameIdx = headers.findIndex(h => /room|space|name/.test(h));
        if (areaIdx >= 0) {
          for (const row of rows.slice(1)) {
            if (row[areaIdx] && !isNaN(parseFloat(row[areaIdx]))) {
              rooms.push({
                name: nameIdx >= 0 ? String(row[nameIdx]) : 'Room',
                area_m2: parseFloat(row[areaIdx]),
                source: `${filename}:${sheetName}`,
              });
            }
          }
        }
        schedules['room_schedule'] = rows;
      }

      if (headers.some(h => /door|window|opening|ref|width|height|size/.test(h))) {
        // Opening schedule
        const refIdx = headers.findIndex(h => /ref|mark|no/.test(h));
        const wIdx = headers.findIndex(h => /width|w\b/.test(h));
        const hIdx = headers.findIndex(h => /height|h\b/.test(h));
        if (wIdx >= 0 && hIdx >= 0) {
          for (const row of rows.slice(1)) {
            if (row[wIdx] && row[hIdx] && !isNaN(parseFloat(row[wIdx]))) {
              openings.push({
                ref: refIdx >= 0 ? String(row[refIdx]) : '',
                width_mm: parseFloat(row[wIdx]),
                height_mm: parseFloat(row[hIdx]),
                source: `${filename}:${sheetName}`,
              });
            }
          }
        }
        if (openings.length > 0) schedules['opening_schedule'] = rows;
      }

      // Extract any dimension-like numbers with context
      dimensions.push(...extractDimensions(sheetText, `${filename}:${sheetName}`));
    }

    return {
      filename,
      type: 'excel',
      sheet_names: wb.SheetNames,
      sheets,
      text: allText.join('\n\n'),
      rooms,
      openings,
      dimensions,
      schedules,
      doc_type: classifyDocument(filename, allText.join(' ')),
    };
  } catch (e) {
    console.warn(`[ZIP] Excel parse failed for ${filename}: ${e.message}`);
    return { filename, type: 'excel', text: '', error: e.message };
  }
}

async function extractFromWord(filePath, filename) {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    const text = result.value || '';
    return {
      filename,
      type: 'word',
      text,
      text_length: text.length,
      dimensions: extractDimensions(text, filename),
      rooms: extractRooms(text, filename),
      openings: extractOpenings(text, filename),
      doc_type: classifyDocument(filename, text),
    };
  } catch (e) {
    console.warn(`[ZIP] Word parse failed for ${filename}: ${e.message}`);
    return { filename, type: 'word', text: '', error: e.message };
  }
}

function extractFromImage(filePath, filename) {
  // Images need vision — return as base64 for Claude
  try {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase().slice(1);
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    return {
      filename,
      type: 'image',
      base64: buffer.toString('base64'),
      media_type: mimeMap[ext] || 'image/jpeg',
      doc_type: classifyDocument(filename, ''),
      needs_vision: true,
    };
  } catch (e) {
    return { filename, type: 'image', error: e.message };
  }
}

// ─── MAIN ZIP PROCESSOR ───────────────────────────────────────────────────────

async function processZip(zipPath, extractDir) {
  ensureDeps();

  const AdmZip = require('adm-zip');
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  console.log(`[ZIP] Processing ${entries.length} entries from ${path.basename(zipPath)}`);

  // Extract to temp dir
  const tmpDir = path.join(extractDir, 'zip_' + uuidv4().slice(0, 8));
  fs.mkdirSync(tmpDir, { recursive: true });
  zip.extractAllTo(tmpDir, true);

  const results = {
    files: [],
    drawing_index: [],
    all_dimensions: [],
    all_rooms: [],
    all_openings: [],
    images_for_vision: [],
    text_context: [],
    schedules: {},
    summary: {
      total_files: 0,
      pdf_count: 0,
      excel_count: 0,
      image_count: 0,
      word_count: 0,
      has_floor_plan: false,
      has_elevation: false,
      has_sections: false,
      has_schedule: false,
      has_spec: false,
      total_rooms: 0,
      total_floor_area_m2: 0,
    },
  };

  // Walk all extracted files
  function walkDir(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) { walkDir(full); continue; }
      const ext = path.extname(item).toLowerCase();
      if (['.ds_store', '.thumbs', '.thumb_db'].includes(item.toLowerCase())) continue;
      if (item.startsWith('__MACOSX') || item.startsWith('.')) continue;
      allFiles.push({ path: full, name: item, ext });
    }
  }
  const allFiles = [];
  walkDir(tmpDir);

  console.log(`[ZIP] Found ${allFiles.length} files to process`);
  results.summary.total_files = allFiles.length;

  for (const file of allFiles) {
    let extracted = null;

    try {
      if (file.ext === '.pdf') {
        extracted = await extractFromPDF(file.path, file.name);
        results.summary.pdf_count++;
      } else if (['.xlsx', '.xls', '.csv'].includes(file.ext)) {
        extracted = await extractFromExcel(file.path, file.name);
        results.summary.excel_count++;
      } else if (['.docx', '.doc'].includes(file.ext)) {
        extracted = await extractFromWord(file.path, file.name);
        results.summary.word_count++;
      } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(file.ext)) {
        extracted = extractFromImage(file.path, file.name);
        results.summary.image_count++;
      } else {
        continue; // skip unknown types
      }

      if (!extracted) continue;

      results.files.push(extracted);

      // Aggregate dimensions
      if (extracted.dimensions && extracted.dimensions.length > 0) {
        results.all_dimensions.push(...extracted.dimensions);
      }

      // Aggregate rooms
      if (extracted.rooms && extracted.rooms.length > 0) {
        results.all_rooms.push(...extracted.rooms);
        results.summary.total_rooms += extracted.rooms.length;
        results.summary.total_floor_area_m2 += extracted.rooms.reduce((s, r) => s + (r.area_m2 || 0), 0);
      }

      // Aggregate openings
      if (extracted.openings && extracted.openings.length > 0) {
        results.all_openings.push(...extracted.openings);
      }

      // Images for vision
      if (extracted.needs_vision && extracted.base64) {
        results.images_for_vision.push(extracted);
      }

      // Text context
      if (extracted.text && extracted.text.length > 50) {
        results.text_context.push(`=== FILE: ${file.name} (${extracted.doc_type}) ===\n${extracted.text.substring(0, 8000)}`);
      }

      // Drawing index
      results.drawing_index.push({
        filename: file.name,
        doc_type: extracted.doc_type,
        has_text: extracted.has_text,
        needs_vision: extracted.needs_vision,
        dimension_count: (extracted.dimensions || []).length,
        room_count: (extracted.rooms || []).length,
        opening_count: (extracted.openings || []).length,
      });

      // Summary flags
      if (extracted.doc_type === 'floor_plan') results.summary.has_floor_plan = true;
      if (extracted.doc_type === 'elevation') results.summary.has_elevation = true;
      if (extracted.doc_type === 'section') results.summary.has_sections = true;
      if (extracted.doc_type === 'schedule') results.summary.has_schedule = true;
      if (extracted.doc_type === 'specification') results.summary.has_spec = true;

      // Excel schedules
      if (extracted.schedules) {
        Object.assign(results.schedules, extracted.schedules);
      }

    } catch (e) {
      console.warn(`[ZIP] Error processing ${file.name}: ${e.message}`);
    }
  }

  // Clean up temp dir
  try { fs.rmSync(tmpDir, { recursive: true }); } catch (e) {}

  console.log(`[ZIP] Extracted: ${results.all_dimensions.length} dimensions, ${results.all_rooms.length} rooms, ${results.all_openings.length} openings, ${results.images_for_vision.length} images need vision`);

  // ── SCALE-AWARE PDF RENDERING ──────────────────────────────────────
  // For PDFs that are image-based (no text), render to images and measure using scale bar
  if (pdfScaleReader) {
    const drawingPdfs = results.files.filter(f =>
      f.type === 'pdf' &&
      f.filePath &&
      ['floor_plan', 'elevation', 'section', 'roof_plan', 'drawing'].includes(f.doc_type)
    ).slice(0, 4); // max 4 drawings to keep costs reasonable

    if (drawingPdfs.length > 0) {
      console.log(`[ZIP] Running scale-aware measurement on ${drawingPdfs.length} drawing(s)`);
      const scaleMeasurements = [];

      for (const pdf of drawingPdfs) {
        try {
          const measurement = await pdfScaleReader.processPdfWithScale(
            pdf.filePath,
            pdf.filename,
            extractDir,
            {
              projectContext: results.summary.project_context || '',
              drawingType: pdf.doc_type,
              existingText: pdf.text || '',
            }
          );
          if (measurement) {
            scaleMeasurements.push(measurement);

            // Extract rooms from scale measurements
            if (measurement.room_schedule) {
              for (const room of measurement.room_schedule) {
                results.all_rooms.push({
                  name: room.name,
                  area_m2: room.area_m2,
                  source: `${pdf.filename} (scale measured)`,
                  confidence: 'high',
                });
              }
              results.summary.total_floor_area_m2 = results.all_rooms.reduce((s, r) => s + (r.area_m2 || 0), 0);
            }

            // Extract openings from scale measurements
            if (measurement.openings) {
              for (const o of measurement.openings) {
                results.all_openings.push({
                  ref: o.ref || o.type,
                  type: o.type?.includes('door') ? 'door' : 'window',
                  width_mm: Math.round((o.width_m || 0) * 1000),
                  height_mm: Math.round((o.height_m || 0) * 1000),
                  source: `${pdf.filename} (scale measured)`,
                });
              }
            }
          }
        } catch(scaleErr) {
          console.warn(`[ZIP] Scale measurement failed for ${pdf.filename}: ${scaleErr.message}`);
        }
      }

      // Store scale measurements for Claude extraction prompt
      if (scaleMeasurements.length > 0) {
        results.scale_measurements = scaleMeasurements;
        results.scale_context = pdfScaleReader.formatMeasurementsForExtraction(scaleMeasurements);
        console.log(`[ZIP] Scale measurement complete: ${scaleMeasurements.filter(m=>m?.scale_bar_found).length}/${scaleMeasurements.length} drawings had confirmed scale`);
      }
    }
  }

  return results;
}

// ─── FORMAT FOR CLAUDE ────────────────────────────────────────────────────────

/**
 * Format extracted ZIP data into a structured context string for Claude
 * This replaces raw file content — Claude gets pre-extracted facts, not pixels
 */
function formatForClaude(zipData) {
  const lines = ['=== PROJECT PACKAGE (pre-extracted from ZIP) ===\n'];

  // Drawing index
  lines.push('DRAWING INDEX:');
  for (const d of zipData.drawing_index) {
    lines.push(`  ${d.filename} → ${d.doc_type} | ${d.dimension_count} dims | ${d.room_count} rooms | ${d.needs_vision ? 'NEEDS VISION' : 'TEXT OK'}`);
  }
  lines.push('');

  // Summary
  const s = zipData.summary;
  lines.push('PACKAGE SUMMARY:');
  lines.push(`  Files: ${s.total_files} (${s.pdf_count} PDF, ${s.excel_count} Excel, ${s.image_count} images, ${s.word_count} Word)`);
  lines.push(`  Has: ${[s.has_floor_plan && 'floor plan', s.has_elevation && 'elevations', s.has_sections && 'sections', s.has_schedule && 'schedules', s.has_spec && 'spec'].filter(Boolean).join(', ') || 'unknown'}`);
  if (s.total_floor_area_m2 > 0) lines.push(`  Total floor area from schedules: ${s.total_floor_area_m2.toFixed(1)}m²`);
  lines.push('');

  // Annotated dimensions (HIGH CONFIDENCE — read from drawing text)
  if (zipData.all_dimensions.length > 0) {
    const highConf = zipData.all_dimensions.filter(d => d.confidence === 'high');
    const pairs = zipData.all_dimensions.filter(d => d.width_mm && d.height_mm);
    if (highConf.length > 0) {
      lines.push(`ANNOTATED DIMENSIONS (${highConf.length} — read directly from drawing text, HIGH CONFIDENCE):`);
      for (const d of highConf.slice(0, 40)) {
        lines.push(`  ${d.raw} [from ${d.source}]`);
      }
      lines.push('');
    }
    if (pairs.length > 0) {
      lines.push(`DIMENSION PAIRS (width × height, ${pairs.length} found):`);
      for (const d of pairs.slice(0, 30)) {
        lines.push(`  ${d.width_mm} × ${d.height_mm}mm${d.context ? ' — context: ' + d.context.substring(0, 60) : ''} [${d.source}]`);
      }
      lines.push('');
    }
  }

  // Room schedule
  if (zipData.all_rooms.length > 0) {
    const total = zipData.all_rooms.reduce((s, r) => s + (r.area_m2 || 0), 0);
    lines.push(`ROOM SCHEDULE (${zipData.all_rooms.length} rooms, total ${total.toFixed(1)}m²):`);
    for (const r of zipData.all_rooms) {
      lines.push(`  ${r.name}: ${r.area_m2}m² [${r.source}]`);
    }
    lines.push('');
  }

  // Door/window schedule
  if (zipData.all_openings.length > 0) {
    lines.push(`DOOR/WINDOW SCHEDULE (${zipData.all_openings.length} openings):`);
    for (const o of zipData.all_openings) {
      lines.push(`  ${o.ref || '?'} (${o.type}): ${o.width_mm} × ${o.height_mm}mm [${o.source}]`);
    }
    lines.push('');
  }

  // Full text from text-based files
  if (zipData.text_context.length > 0) {
    lines.push('EXTRACTED TEXT FROM FILES:');
    // Limit total text to avoid token overload
    let totalChars = 0;
    for (const ctx of zipData.text_context) {
      if (totalChars > 40000) {
        lines.push('[... additional file text truncated to stay within token limit ...]');
        break;
      }
      lines.push(ctx);
      totalChars += ctx.length;
    }
    lines.push('');
  }

  lines.push('=== END PROJECT PACKAGE ===');
  lines.push('');
  lines.push('INSTRUCTIONS FOR QUANTITY EXTRACTION:');
  lines.push('1. Use ONLY annotated dimensions from the list above — DO NOT estimate or guess');
  lines.push('2. If a dimension is not annotated, mark that item as "assumption: true" with explanation');
  lines.push('3. Show your working: "Rear wall: noted 6200mm wide × 2700mm high = 16.74m²"');
  lines.push('4. Cross-reference room schedule areas against your calculations for floor areas');
  lines.push('5. Use door/window schedule sizes for accurate opening deductions');
  lines.push('6. If drawings appear to be image-only (needs_vision), state which items are estimated from visual inspection');

  return lines.join('\n');
}

/**
 * Build Claude message content array including images for vision
 * Mixes text context + actual images for image-based PDFs
 */
function buildClaudeContent(zipData, userMessage) {
  const content = [];

  // First: structured text context
  const textContext = formatForClaude(zipData);
  content.push({ type: 'text', text: textContext });

  // Then: images that need vision (scanned drawings, photos)
  // Limit to 10 images to avoid token explosion
  const visionImages = zipData.images_for_vision.slice(0, 10);
  for (const img of visionImages) {
    content.push({
      type: 'text',
      text: `\n[IMAGE: ${img.filename} — ${img.doc_type}. Extract all visible dimensions, annotations, labels, and measurements from this drawing.]`,
    });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.media_type,
        data: img.base64,
      },
    });
  }

  // Also add PDFs that need vision as images if possible
  const visionPDFs = zipData.files.filter(f => f.type === 'pdf' && f.needs_vision);
  for (const pdf of visionPDFs.slice(0, 5)) {
    content.push({
      type: 'text',
      text: `\n[PDF (scanned/image-based): ${pdf.filename} — this PDF has no extractable text, dimensions must be read visually]`,
    });
  }

  // User message
  if (userMessage) {
    content.push({ type: 'text', text: `\nUser instruction: ${userMessage}` });
  }

  return content;
}

// ─── SMART CONTEXT BUILDER ────────────────────────────────────────────────────

/**
 * Quick summary for chat response — tells user what was found before extraction
 */
function buildUploadSummary(zipData) {
  const s = zipData.summary;
  const lines = [`ZIP processed: ${s.total_files} files`];

  if (s.has_floor_plan) lines.push('✅ Floor plan(s) found');
  if (s.has_elevation) lines.push('✅ Elevations found');
  if (s.has_sections) lines.push('✅ Sections found');
  if (s.has_schedule) lines.push('✅ Door/window schedule found');
  if (s.has_spec) lines.push('✅ Specification found');

  if (zipData.all_rooms.length > 0) {
    lines.push(`✅ Room schedule: ${zipData.all_rooms.length} rooms, ${zipData.all_rooms.reduce((s, r) => s + (r.area_m2 || 0), 0).toFixed(1)}m² total`);
  }
  if (zipData.all_openings.length > 0) {
    lines.push(`✅ ${zipData.all_openings.length} door/window sizes extracted`);
  }
  if (zipData.all_dimensions.length > 0) {
    lines.push(`✅ ${zipData.all_dimensions.length} annotated dimensions extracted`);
  }

  const visionNeeded = zipData.files.filter(f => f.needs_vision).length;
  if (visionNeeded > 0) {
    lines.push(`⚠️ ${visionNeeded} image-based files need visual analysis`);
  }

  return lines.join('\n');
}

module.exports = { processZip, formatForClaude, buildClaudeContent, buildUploadSummary, extractDimensions, extractRooms, extractOpenings };
