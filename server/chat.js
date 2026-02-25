const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('./auth');

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
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

function extractFromZip(zipPath) {
  const AdmZip = require('adm-zip');
  const extracted = { visual: [], text: [], skipped: [], cad: [] };

  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    console.log(`[ZIP] Opening ZIP with ${entries.length} entries`);

    for (const entry of entries) {
      // Skip directories
      if (entry.isDirectory) continue;

      // Get just the filename (handles nested subfolders)
      const fullPath = entry.entryName;
      const name = path.basename(fullPath);

      // Skip macOS metadata files
      if (name.startsWith('._') || name.startsWith('.DS_Store') || fullPath.includes('__MACOSX')) {
        console.log(`[ZIP] Skipping metadata: ${fullPath}`);
        continue;
      }

      // Skip hidden files
      if (name.startsWith('.')) continue;

      const ext = path.extname(name).toLowerCase();
      console.log(`[ZIP] Found: ${fullPath} (ext: ${ext}, size: ${entry.header.size} bytes)`);

      // Visual files - extract and send to Claude
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
      }
      // Plain text files - read content
      else if (TEXT_EXTS.includes(ext)) {
        try {
          const textContent = entry.getData().toString('utf8');
          extracted.text.push({ name: name, content: textContent });
          console.log(`[ZIP] Extracted text: ${name} (${textContent.length} chars)`);
        } catch (err) {
          console.error(`[ZIP] Failed to read text from ${name}:`, err.message);
          extracted.skipped.push(name);
        }
      }
      // CAD files - can't process but tell user
      else if (CAD_EXTS.includes(ext)) {
        extracted.cad.push(name);
        console.log(`[ZIP] CAD file found (cannot process): ${name}`);
      }
      // Office files - note them
      else if (OFFICE_EXTS.includes(ext)) {
        // We could add xlsx/docx parsing later, for now note them
        extracted.skipped.push(name);
        console.log(`[ZIP] Office file found (not yet supported): ${name}`);
      }
      // Unknown
      else {
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
  return null;
}

router.post('/chat', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const { message, history } = req.body;
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Anthropic API key not configured' });
    }

    let messages = [];

    if (history) {
      try {
        const parsed = JSON.parse(history);
        messages = parsed.map(msg => ({
          role: msg.role,
          content: msg.content
        }));
      } catch (e) {}
    }

    const currentContent = [];
    let fileNames = [];
    let zipNotes = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const ext = path.extname(file.originalname).toLowerCase();
        console.log(`[Upload] File: ${file.originalname}, Size: ${(file.size / 1024 / 1024).toFixed(2)}MB, Type: ${ext}`);

        if (ext === '.zip') {
          console.log(`[Upload] Processing ZIP: ${file.originalname}`);
          const extracted = extractFromZip(file.path);

          // Add visual files (PDFs + images) as content blocks
          for (const ef of extracted.visual) {
            const block = fileToContentBlock(ef.path, ef.ext);
            if (block) {
              currentContent.push(block);
              fileNames.push(ef.name);
            }
          }

          // Add text file contents as text blocks
          for (const tf of extracted.text) {
            currentContent.push({
              type: 'text',
              text: `[Content from ${tf.name}]:\n${tf.content}`
            });
            fileNames.push(tf.name);
          }

          // Build notes about what we found/couldn't process
          if (extracted.cad.length > 0) {
            zipNotes.push(`Note: Found ${extracted.cad.length} CAD file(s) in the ZIP (${extracted.cad.join(', ')}) -- these are binary AutoCAD files that I can't read directly. Please export them as PDF from your CAD software and re-upload for analysis.`);
          }

          if (extracted.skipped.length > 0) {
            zipNotes.push(`Note: ${extracted.skipped.length} file(s) in the ZIP couldn't be processed: ${extracted.skipped.join(', ')}`);
          }

          if (extracted.visual.length === 0 && extracted.text.length === 0) {
            if (extracted.cad.length > 0) {
              zipNotes.push(`The ZIP file "${file.originalname}" only contains CAD files (${extracted.cad.join(', ')}). I can't read DWG/DXF files directly -- please export them as PDF from AutoCAD, Revit, or your CAD software and upload those PDFs instead.`);
            } else {
              zipNotes.push(`No supported files found inside "${file.originalname}". Please upload PDFs or images (JPG, PNG) directly, or ensure your ZIP contains these file types.`);
            }
          }
        } else {
          const block = fileToContentBlock(file.path, ext);
          if (block) {
            currentContent.push(block);
            fileNames.push(file.originalname);
          }
        }
      }
    }

    let textMessage = message || '';

    // Add ZIP processing notes to the message for Claude
    if (zipNotes.length > 0) {
      const noteText = zipNotes.join('\n');
      if (textMessage) {
        textMessage = `[Uploaded files: ${fileNames.join(', ')}]\n\n${textMessage}\n\n[System note for context: ${noteText}]`;
      } else if (fileNames.length > 0) {
        textMessage = `Please analyse these construction drawings: ${fileNames.join(', ')}\n\n[System note for context: ${noteText}]`;
      } else {
        textMessage = `[System note: ${noteText}]\n\nPlease let the user know about the file issue and suggest how they can get their drawings to you in a usable format.`;
      }
    } else if (fileNames.length > 0 && !textMessage) {
      textMessage = `Please analyse these construction drawings: ${fileNames.join(', ')}`;
    } else if (fileNames.length > 0) {
      textMessage = `[Uploaded files: ${fileNames.join(', ')}]\n\n${textMessage}`;
    }

    if (textMessage) {
      currentContent.push({ type: 'text', text: textMessage });
    }

    if (currentContent.length === 0) {
      return res.status(400).json({ error: 'Please provide a message or upload a file' });
    }

    messages.push({ role: 'user', content: currentContent });

    // Call Claude API with extended thinking
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        thinking: {
          type: 'enabled',
          budget_tokens: 8000
        },
        system: QS_SYSTEM_PROMPT,
        messages: messages
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Claude API error:', JSON.stringify(err, null, 2));
      return res.status(500).json({ error: 'AI service error -- please try again' });
    }

    const data = await response.json();

    let thinking = '';
    let reply = '';

    for (const block of data.content) {
      if (block.type === 'thinking') {
        thinking += (thinking ? '\n' : '') + block.thinking;
      } else if (block.type === 'text') {
        reply += (reply ? '\n' : '') + block.text;
      }
    }

    res.json({
      reply,
      thinking: thinking || null
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Something went wrong -- please try again' });
  }
});

module.exports = router;
