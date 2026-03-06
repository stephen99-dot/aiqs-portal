/**
 * pdfScaleReader.js
 *
 * Converts architectural PDF drawings to high-resolution images,
 * detects the scale bar, calculates pixel-to-metre ratio,
 * then passes image + scale to Claude Vision for accurate measurement.
 *
 * This replaces visual guessing with actual measurement.
 *
 * Dependencies needed in package.json:
 *   "pdf2pic": "^3.1.1"
 *   "sharp": "^0.33.0"
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DPI = 200;
const MAX_PAGES = 2; // process first 2 pages per PDF

// ─── RENDER PDF PAGE TO IMAGE ─────────────────────────────────────────────────

async function renderPdfToImages(pdfPath, outputDir) {
  const images = [];

  // Check file exists before attempting render
  if (!fs.existsSync(pdfPath)) {
    console.log(`[ScaleReader] File not found: ${pdfPath}`);
    return images;
  }

  // Use poppler pdftoppm — pre-installed on Render/Ubuntu Linux
  // Much more reliable than pdf2pic/ImageMagick for server environments
  try {
    const outputPrefix = path.join(outputDir, 'page');
    const result = spawnSync('pdftoppm', [
      '-r', String(DPI),
      '-png',
      '-f', '1',
      '-l', String(MAX_PAGES),
      pdfPath,
      outputPrefix
    ], { timeout: 30000, encoding: 'buffer' });

    if (result.status === 0 || result.status === null) {
      const files = fs.readdirSync(outputDir)
        .filter(f => f.startsWith('page') && f.endsWith('.png'))
        .sort()
        .slice(0, MAX_PAGES);

      for (const f of files) {
        const fullPath = path.join(outputDir, f);
        if (fs.existsSync(fullPath)) {
          const buf = fs.readFileSync(fullPath);
          const dims = getPngDimensions(buf);
          if (dims.width > 0) {
            images.push({ path: fullPath, buffer: buf, ...dims, method: 'poppler' });
          }
        }
      }

      if (images.length > 0) {
        console.log(`[ScaleReader] Rendered ${images.length} pages via poppler (${images[0].width}x${images[0].height}px)`);
        return images;
      }
    }

    if (result.stderr && result.stderr.length > 0) {
      console.log(`[ScaleReader] pdftoppm stderr: ${result.stderr.toString().substring(0, 200)}`);
    }
  } catch(e) {
    console.log(`[ScaleReader] poppler error: ${e.message}`);
  }

  // Fallback: try pdftocairo (also part of poppler)
  try {
    const outputPrefix = path.join(outputDir, 'cairo');
    const result = spawnSync('pdftocairo', [
      '-png', '-r', String(DPI),
      '-f', '1', '-l', String(MAX_PAGES),
      pdfPath, outputPrefix
    ], { timeout: 30000, encoding: 'buffer' });

    if (result.status === 0) {
      const files = fs.readdirSync(outputDir)
        .filter(f => f.startsWith('cairo') && f.endsWith('.png'))
        .sort()
        .slice(0, MAX_PAGES);

      for (const f of files) {
        const fullPath = path.join(outputDir, f);
        if (fs.existsSync(fullPath)) {
          const buf = fs.readFileSync(fullPath);
          const dims = getPngDimensions(buf);
          if (dims.width > 0) {
            images.push({ path: fullPath, buffer: buf, ...dims, method: 'pdftocairo' });
          }
        }
      }

      if (images.length > 0) {
        console.log(`[ScaleReader] Rendered ${images.length} pages via pdftocairo`);
        return images;
      }
    }
  } catch(e) {
    console.log(`[ScaleReader] pdftocairo not available: ${e.message}`);
  }

  console.log(`[ScaleReader] No PDF renderer available for ${path.basename(pdfPath)}`);
  return [];
}

// Read PNG dimensions from header bytes (no dependency needed)
function getPngDimensions(buffer) {
  try {
    if (buffer[0] === 0x89 && buffer[1] === 0x50) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
  } catch(e) {}
  return { width: 0, height: 0 };
}

// ─── SCALE BAR DETECTION ──────────────────────────────────────────────────────

/**
 * Detect scale bar from extracted text annotations
 * Looks for patterns like "1:50", "Scale 1:100", "0 1 2 3 4 5m"
 * Returns { ratio, label } where ratio = real metres per drawing metre
 * e.g. scale 1:50 means 1mm on drawing = 50mm real = 0.05m per drawing mm
 */
function detectScaleFromText(text) {
  if (!text) return null;

  // "1:50", "1:100", "Scale: 1:200" etc
  const ratioMatch = text.match(/(?:scale[:\s]+)?1\s*:\s*(\d+)/i);
  if (ratioMatch) {
    const ratio = parseInt(ratioMatch[1]);
    if (ratio >= 5 && ratio <= 2000) {
      return { ratio, label: `1:${ratio}`, source: 'text_annotation' };
    }
  }

  // "Scale 1/50", "1/100"
  const fracMatch = text.match(/1\s*\/\s*(\d+)/);
  if (fracMatch) {
    const ratio = parseInt(fracMatch[1]);
    if (ratio >= 5 && ratio <= 2000) {
      return { ratio, label: `1:${ratio}`, source: 'text_fraction' };
    }
  }

  return null;
}

/**
 * Build a precise measurement prompt for Claude Vision
 * Given a known scale, ask Claude to measure specific elements
 */
function buildScaleMeasurementPrompt(scaleInfo, drawingType, projectContext) {
  const scaleDesc = scaleInfo
    ? `SCALE: This drawing is at ${scaleInfo.label}. This means 1mm on the drawing = ${scaleInfo.ratio}mm in reality. The scale bar on this drawing confirms this — use it as your measurement reference.`
    : `SCALE: No scale was found in the text. Look for the scale bar on this drawing (usually bottom left or bottom right — a line with tick marks and numbers like "0 1 2 3 4 5m"). Identify the length of the scale bar in pixels, note what real distance it represents, and use that to calibrate all your measurements.`;

  return `You are a professional quantity surveyor measuring an architectural drawing.

${scaleDesc}

DRAWING TYPE: ${drawingType || 'Architectural drawing'}

${projectContext ? `PROJECT CONTEXT: ${projectContext}` : ''}

INSTRUCTIONS:
1. Find the scale bar on this drawing. Note its pixel length and the real-world distance it represents (e.g. "scale bar = 287px = 5 metres → 57.4px per metre").
2. Using this pixel-to-metre ratio, measure every element you can see:
   - Room dimensions (length × width)
   - Wall lengths and heights
   - Window and door opening widths
   - Extension/new build floor area
   - Roof area (from plan, apply pitch factor if elevation shown)
3. Show ALL working explicitly: "Rear wall: 487px ÷ 57.4px/m = 8.49m wide"
4. For each measurement state your CONFIDENCE: HIGH (measured from scale bar), MEDIUM (estimated from context), LOW (cannot determine)

OUTPUT FORMAT - respond with valid JSON only:
{
  "scale_bar_found": true/false,
  "scale_ratio": 50,
  "pixels_per_metre": 57.4,
  "drawing_type": "floor_plan",
  "measurements": [
    {
      "element": "Ground floor extension",
      "dimension_type": "area",
      "working": "Width: 487px ÷ 57.4 = 8.49m. Depth: 344px ÷ 57.4 = 5.99m. Area = 8.49 × 5.99 = 50.9m²",
      "value": 50.9,
      "unit": "m2",
      "confidence": "HIGH"
    }
  ],
  "room_schedule": [
    { "name": "Kitchen/Dining", "width_m": 8.49, "depth_m": 5.99, "area_m2": 50.9 }
  ],
  "openings": [
    { "type": "bifold_door", "ref": "D01", "width_m": 4.0, "height_m": 2.1, "confidence": "HIGH" }
  ],
  "notes": "Any important observations about the drawing"
}`;
}

// ─── MAIN FUNCTION ────────────────────────────────────────────────────────────

/**
 * Process a single PDF with scale-aware measurement
 * Returns structured measurements ready for quantity extraction
 */
async function processPdfWithScale(pdfPath, filename, outputDir, { projectContext, drawingType, existingText, anthropicHeaders } = {}) {
  console.log(`[ScaleReader] Processing: ${filename}`);

  // First try to get scale from text (fast, no rendering needed)
  const textScale = detectScaleFromText(existingText || '');
  
  // Render to images
  const tmpDir = path.join(outputDir, 'scale_tmp_' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  let measurements = null;
  
  try {
    const images = await renderPdfToImages(pdfPath, tmpDir);
    
    if (images.length === 0) {
      console.log(`[ScaleReader] Could not render ${filename} — no images produced`);
      return null;
    }

    // Use the first rendered image (usually floor plan or most important view)
    const mainImage = images[0];
    const base64 = mainImage.buffer.toString('base64');
    
    console.log(`[ScaleReader] Image: ${mainImage.width}x${mainImage.height}px, sending to Claude Vision`);

    // Classify drawing type from filename + text
    const dt = drawingType || classifyDrawing(filename, existingText || '');
    
    // Build measurement prompt
    const prompt = buildScaleMeasurementPrompt(textScale, dt, projectContext);

    // Call Claude Vision
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: anthropicHeaders || {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: base64 }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[ScaleReader] Claude Vision error: ${err}`);
      return null;
    }

    const data = await response.json();
    const rawText = data.content.filter(c => c.type === 'text').map(c => c.text).join('');
    
    // Parse JSON response
    const cleaned = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    // Find JSON object in response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      measurements = JSON.parse(jsonMatch[0]);
      measurements.filename = filename;
      measurements.drawing_type = dt;
      measurements.rendered_size = `${mainImage.width}x${mainImage.height}`;
      measurements.scale_source = textScale ? 'text_annotation' : 'visual_detection';
      
      const highConf = (measurements.measurements || []).filter(m => m.confidence === 'HIGH').length;
      console.log(`[ScaleReader] Got ${(measurements.measurements||[]).length} measurements (${highConf} HIGH confidence) from ${filename}`);
    }

  } catch(e) {
    console.error(`[ScaleReader] Error processing ${filename}: ${e.message}`);
  } finally {
    // Cleanup temp images
    try { fs.rmSync(tmpDir, { recursive: true }); } catch(e) {}
  }

  return measurements;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function classifyDrawing(filename, text) {
  const s = (filename + ' ' + text).toLowerCase();
  if (/floor.?plan|gf\s*plan|ff\s*plan|ground.?floor|first.?floor|proposed.?plan/.test(s)) return 'floor_plan';
  if (/elevation|front\s+elev|rear\s+elev|side\s+elev/.test(s)) return 'elevation';
  if (/section|cross.?section/.test(s)) return 'section';
  if (/roof\s*plan/.test(s)) return 'roof_plan';
  if (/site\s*plan|block\s*plan/.test(s)) return 'site_plan';
  return 'architectural_drawing';
}

/**
 * Format scale measurements into structured context for the quantity extraction prompt
 * This replaces the raw text dump with properly measured quantities
 */
function formatMeasurementsForExtraction(allMeasurements) {
  if (!allMeasurements || allMeasurements.length === 0) return '';

  const lines = ['=== SCALE-MEASURED QUANTITIES (HIGH ACCURACY) ===\n'];
  lines.push('These measurements were taken from rendered drawing images using the scale bar.');
  lines.push('HIGH confidence = measured directly. MEDIUM = estimated. LOW = unclear.\n');

  for (const m of allMeasurements) {
    if (!m) continue;
    lines.push(`--- ${m.filename} (${m.drawing_type}) ---`);
    
    if (m.scale_bar_found && m.pixels_per_metre) {
      lines.push(`Scale: 1:${m.scale_ratio} | ${m.pixels_per_metre.toFixed(1)} pixels/metre | Source: ${m.scale_source}`);
    } else {
      lines.push(`Scale: NOT CONFIRMED — measurements may be estimated`);
    }

    if (m.measurements && m.measurements.length > 0) {
      lines.push('\nMEASURED ELEMENTS:');
      for (const meas of m.measurements) {
        const conf = meas.confidence === 'HIGH' ? '✅' : meas.confidence === 'MEDIUM' ? '⚠️' : '❌';
        lines.push(`  ${conf} ${meas.element}: ${meas.value} ${meas.unit}`);
        if (meas.working) lines.push(`     Working: ${meas.working}`);
      }
    }

    if (m.room_schedule && m.room_schedule.length > 0) {
      lines.push('\nROOM SCHEDULE (from drawing):');
      const total = m.room_schedule.reduce((s, r) => s + (r.area_m2 || 0), 0);
      for (const room of m.room_schedule) {
        lines.push(`  ${room.name}: ${room.area_m2}m² (${room.width_m}m × ${room.depth_m}m)`);
      }
      lines.push(`  TOTAL FLOOR AREA: ${total.toFixed(1)}m²`);
    }

    if (m.openings && m.openings.length > 0) {
      lines.push('\nDOOR/WINDOW OPENINGS:');
      for (const o of m.openings) {
        lines.push(`  ${o.ref || o.type}: ${o.width_m}m wide × ${o.height_m}m high (${o.confidence})`);
      }
    }

    if (m.notes) lines.push(`\nNotes: ${m.notes}`);
    lines.push('');
  }

  lines.push('=== END SCALE-MEASURED QUANTITIES ===\n');
  lines.push('INSTRUCTION: Use the HIGH confidence measurements above as your primary source.');
  lines.push('Only use MEDIUM/LOW confidence items if no better data exists, and flag them.');

  return lines.join('\n');
}

module.exports = {
  renderPdfToImages,
  detectScaleFromText,
  processPdfWithScale,
  formatMeasurementsForExtraction,
  classifyDrawing,
};
