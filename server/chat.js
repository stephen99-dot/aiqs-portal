const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('./auth');

const router = express.Router();

// Use Render persistent disk if available, otherwise local data folder
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

const QS_SYSTEM_PROMPT = `You are an expert UK Quantity Surveyor AI assistant working for AI QS, a professional quantity surveying service covering the UK and Ireland.

Your role is to help construction professionals with:
- Analysing construction drawings and providing quantity take-offs
- Giving rough cost estimates based on current UK market rates
- Advising on specifications, materials, and building regulations
- Identifying scope items, risks, and potential issues in projects
- Providing elemental cost breakdowns (substructure, superstructure, finishes, services, etc.)

RATE KNOWLEDGE - Use these as baseline UK rates (adjust for location):
- Strip foundations 600x250mm: 80-95/m
- Concrete floor slab 100mm: 45-55/m2
- Blockwork below DPC: 58-68/m2
- Cavity wall (block/insulation/brick): 95-120/m2
- Roof structure (cut timber): 85-105/m2
- Roof covering (concrete tiles): 45-60/m2
- UPVC windows (standard): 350-550/each
- Internal doors (painted softwood): 280-380/each
- Kitchen fit-out (mid-range): 8,000-15,000
- Bathroom fit-out (mid-range): 4,000-8,000
- First fix electrical: 2,500-4,500
- First fix plumbing: 2,000-3,500
- Plastering & skim: 18-25/m2
- Painting & decorating: 12-18/m2
- Floor finishes (LVT): 55-70/m2
- Floor finishes (carpet): 22-35/m2
- Render (monocouche): 75-95/m2
- Structural steel (supply, fab & install): 3,200-3,800/T
- Prelims: typically 10-15% of build cost
- Contingency: typically 5-10%
- Professional fees: typically 10-15%

LOCATION FACTORS:
- London/SE: +15-25%
- South Wales: baseline
- Midlands: +5-10%
- North England: -5% to baseline
- Scotland: baseline to +5%
- Ireland: +5-15% (use EUR where appropriate)

WHEN ANALYSING DRAWINGS:
- Identify all visible elements and measure/estimate quantities where possible
- List items by elemental breakdown (Substructure, Superstructure, Internal Finishes, Services, External Works)
- Apply current UK rates and state your assumptions clearly
- Flag anything unclear or missing from the drawings
- Always note this is a rough estimate pending detailed measurement

COMMUNICATION STYLE:
- Be direct and professional -- like a real QS talking to a builder
- Use UK construction terminology
- Give specific numbers, not vague ranges where possible
- State assumptions clearly
- Flag risks and things to watch out for
- Be honest about limitations -- if you can't see something clearly in drawings, say so

IMPORTANT: Always clarify that estimates are approximate and subject to detailed measurement and site conditions. Recommend a full BOQ for accurate pricing.`;

// File types Claude can see directly (images + PDFs)
const VISUAL_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];

// File types we can extract text from
const TEXT_EXTS = ['.txt', '.csv', '.json', '.xml', '.html', '.htm', '.md'];

// File types we recognise but can't process (tell user)
const CAD_EXTS = ['.dwg', '.dxf', '.rvt', '.ifc', '.skp'];
const OFFICE_EXTS = ['.xlsx', '.xls', '.docx', '.doc', '.pptx', '.ppt'];

// Detect actual file type from magic bytes (first few bytes of the file)
function detectFileType(buffer) {
  if (!buffer || buffer.length < 4) return null;

  // PDF: starts with %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { ext: '.pdf', mime: 'application/pdf' };
  }
  // JPEG: starts with FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { ext: '.jpg', mime: 'image/jpeg' };
  }
  // PNG: starts with 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { ext: '.png', mime: 'image/png' };
  }
  // GIF: starts with GIF8
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return { ext: '.gif', mime: 'image/gif' };
  }
  // WebP: starts with RIFF....WEBP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer.length >= 12 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return { ext: '.webp', mime: 'image/webp' };
  }
  // ZIP: starts with PK (50 4B)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
    return { ext: '.zip', mime: 'application/zip' };
  }
  // TIFF: starts with II or MM
  if ((buffer[0] === 0x49 && buffer[1] === 0x49) || (buffer[0] === 0x4D && buffer[1] === 0x4D)) {
    return { ext: '.tiff', mime: 'image/tiff' };
  }
  // BMP: starts with BM
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
    return { ext: '.bmp', mime: 'image/bmp' };
  }

  return null;
}

function extractFromZip(zipPath) {
  const AdmZip = require('adm-zip');
  const extracted = { visual: [], text: [], skipped: [], cad: [] };

  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    console.log(`[ZIP] Opening ZIP with ${entries.length} entries`);

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const fullPath = entry.entryName;
      const name = path.basename(fullPath);

      // Skip macOS metadata and hidden files
      if (name.startsWith('._') || name.startsWith('.DS_Store') || fullPath.includes('__MACOSX') || name.startsWith('.')) {
        console.log(`[ZIP] Skipping metadata: ${fullPath}`);
        continue;
      }

      const ext = path.extname(name).toLowerCase();
      console.log(`[ZIP] Found: ${fullPath} (ext: ${ext}, size: ${entry.header.size} bytes)`);

      if (VISUAL_EXTS.includes(ext)) {
        try {
          const outPath = path.join(uploadsDir, `${uuidv4()}${ext}`);
          fs.writeFileSync(outPath, entry.getData());
          extracted.visual.push({ path: outPath, name: name, ext: ext });
          console.log(`[ZIP] Extracted visual: ${name}`);
        } catch (err) {
          console.error(`[ZIP] Failed to extract ${name}:`, err.message);
          extracted.skipped.push(name);
        }
      } else if (TEXT_EXTS.includes(ext)) {
        try {
          const textContent = entry.getData().toString('utf8');
          extracted.text.push({ name: name, content: textContent });
          console.log(`[ZIP] Extracted text: ${name} (${textContent.length} chars)`);
        } catch (err) {
          console.error(`[ZIP] Failed to read text from ${name}:`, err.message);
          extracted.skipped.push(name);
        }
      } else if (CAD_EXTS.includes(ext)) {
        extracted.cad.push(name);
        console.log(`[ZIP] CAD file found (cannot process): ${name}`);
      } else if (OFFICE_EXTS.includes(ext)) {
        extracted.skipped.push(name);
        console.log(`[ZIP] Office file found (not yet supported): ${name}`);
      } else if (ext === '.bin' || ext === '' || !ext) {
        // Unknown or .bin file -- try to detect actual type from magic bytes
        try {
          const fileData = entry.getData();
          const detected = detectFileType(fileData);
          if (detected && VISUAL_EXTS.includes(detected.ext)) {
            const outPath = path.join(uploadsDir, `${uuidv4()}${detected.ext}`);
            fs.writeFileSync(outPath, fileData);
            extracted.visual.push({ path: outPath, name: `${name} (detected as ${detected.ext})`, ext: detected.ext });
            console.log(`[ZIP] Magic byte detection: ${name} is actually a ${detected.ext} file -- extracted!`);
          } else if (detected) {
            extracted.skipped.push(`${name} (detected as ${detected.ext} -- not supported)`);
            console.log(`[ZIP] Magic byte detection: ${name} is ${detected.ext} -- not a supported visual type`);
          } else {
            extracted.skipped.push(name);
            console.log(`[ZIP] Magic byte detection: ${name} -- could not identify file type`);
          }
        } catch (err) {
          console.error(`[ZIP] Failed to detect type for ${name}:`, err.message);
          extracted.skipped.push(name);
        }
      } else {
        extracted.skipped.push(name);
        console.log(`[ZIP] Unknown file type skipped: ${name}`);
      }
    }

    console.log(`[ZIP] Summary: ${extracted.visual.length} visual, ${extracted.text.length} text, ${extracted.cad.length} CAD, ${extracted.skipped.length} skipped`);

  } catch (err) {
    console.error('[ZIP] Extraction error:', err.message);
  }

  return extracted;
}

function fileToContentBlock(filePath, ext) {
  const fileBuffer = fs.readFileSync(filePath);
  const base64 = fileBuffer.toString('base64');

  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
    const mediaType = ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`;
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64 }
    };
  } else if (ext === '.pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 }
    };
  }
