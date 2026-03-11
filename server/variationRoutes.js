const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./database');
const { authMiddleware } = require('./auth');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
const outputsDir = path.join(DATA_DIR, 'outputs');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `var_${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Helper: get next VO number for a project ────────────────────────────────
function getNextVONumber(projectId) {
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM variations WHERE project_id = ?').get(projectId);
  const n = (existing?.cnt || 0) + 1;
  return `VO-${String(n).padStart(3, '0')}`;
}

// ─── Helper: read file as base64 ─────────────────────────────────────────────
function fileToBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.toString('base64');
}

function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  return map[ext] || 'application/pdf';
}

// ─── Generate VO document (Word .docx) ───────────────────────────────────────
async function generateVODocument(variation, project, clientName) {
  let Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType;
  try {
    ({ Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType } = require('docx'));
  } catch (e) {
    console.log('[Variations] docx not available');
    return null;
  }

  const navy = '1B2A4A';
  const amber = 'D97706';
  const lightBlue = 'EFF6FF';
  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  const children = [];

  // Header
  children.push(new Paragraph({
    children: [new TextRun({ text: 'VARIATION ORDER', bold: true, size: 40, color: navy, font: 'Arial' })],
    alignment: AlignmentType.CENTER, spacing: { after: 80 }
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: variation.vo_number, bold: true, size: 28, color: amber, font: 'Arial' })],
    alignment: AlignmentType.CENTER, spacing: { after: 80 }
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: project.title, bold: true, size: 24, color: navy, font: 'Arial' })],
    alignment: AlignmentType.CENTER, spacing: { after: 80 }
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: `Date: ${date}  |  Prepared for: ${clientName}`, size: 20, color: '666666', font: 'Arial' })],
    alignment: AlignmentType.CENTER, spacing: { after: 300 }
  }));

  // Divider
  children.push(new Paragraph({ border: { bottom: { color: navy, size: 2, style: BorderStyle.SINGLE } }, spacing: { after: 300 } }));

  // 1. Variation Details
  children.push(new Paragraph({ children: [new TextRun({ text: '1. VARIATION DETAILS', bold: true, size: 24, color: navy, font: 'Arial' })], spacing: { before: 200, after: 120 } }));

  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, shading: { fill: lightBlue, type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: 'VO Number', bold: true, size: 20, font: 'Arial' })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: variation.vo_number, size: 20, font: 'Arial' })] })] }),
      ]}),
      new TableRow({ children: [
        new TableCell({ shading: { fill: lightBlue, type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: 'Project', bold: true, size: 20, font: 'Arial' })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: project.title, size: 20, font: 'Arial' })] })] }),
      ]}),
      new TableRow({ children: [
        new TableCell({ shading: { fill: lightBlue, type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: 'Location', bold: true, size: 20, font: 'Arial' })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: project.location || '—', size: 20, font: 'Arial' })] })] }),
      ]}),
      new TableRow({ children: [
        new TableCell({ shading: { fill: lightBlue, type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: 'Date Raised', bold: true, size: 20, font: 'Arial' })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: date, size: 20, font: 'Arial' })] })] }),
      ]}),
      new TableRow({ children: [
        new TableCell({ shading: { fill: lightBlue, type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: 'Status', bold: true, size: 20, font: 'Arial' })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: variation.status.toUpperCase(), bold: true, size: 20, color: variation.status === 'approved' ? '10B981' : amber, font: 'Arial' })] })] }),
      ]}),
    ]
  }));

  // 2. Description
  children.push(new Paragraph({ children: [new TextRun({ text: '2. DESCRIPTION OF VARIATION', bold: true, size: 24, color: navy, font: 'Arial' })], spacing: { before: 300, after: 120 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: variation.title, bold: true, size: 22, font: 'Arial' })], spacing: { after: 100 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: variation.description, size: 22, font: 'Arial' })], spacing: { after: 200 } }));

  // 3. Analysis (if present)
  if (variation.raw_analysis) {
    let analysis;
    try { analysis = JSON.parse(variation.raw_analysis); } catch (e) { analysis = null; }
    if (analysis?.scope_changes?.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: '3. SCOPE CHANGES', bold: true, size: 24, color: navy, font: 'Arial' })], spacing: { before: 300, after: 120 } }));
      for (const change of analysis.scope_changes) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: `• [${change.type?.toUpperCase() || 'CHANGE'}] `, bold: true, size: 20, color: change.type === 'addition' ? '10B981' : change.type === 'omission' ? 'EF4444' : amber, font: 'Arial' }),
            new TextRun({ text: `${change.item}: ${change.detail}`, size: 20, font: 'Arial' })
          ],
          spacing: { after: 80 }
        }));
      }
    }
    if (analysis?.assumptions?.length) {
      children.push(new Paragraph({ children: [new TextRun({ text: '4. ASSUMPTIONS & EXCLUSIONS', bold: true, size: 24, color: navy, font: 'Arial' })], spacing: { before: 300, after: 120 } }));
      for (const a of analysis.assumptions) {
        children.push(new Paragraph({ children: [new TextRun({ text: `• ${a}`, size: 20, font: 'Arial' })], spacing: { after: 80 } }));
      }
    }
  }

  // 4. Financial Summary
  const sym = variation.currency === 'EUR' ? '€' : '£';
  const fmt = (v) => sym + Math.abs(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const netColor = (variation.net_change || 0) >= 0 ? 'EF4444' : '10B981';

  children.push(new Paragraph({ children: [new TextRun({ text: '5. FINANCIAL SUMMARY', bold: true, size: 24, color: navy, font: 'Arial' })], spacing: { before: 300, after: 120 } }));
  children.push(new Table({
    width: { size: 60, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        new TableCell({ shading: { fill: lightBlue, type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: 'Additions', bold: true, size: 22, font: 'Arial' })] })] }),
        new TableCell({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: fmt(variation.additions), size: 22, color: '10B981', font: 'Arial' })] })] }),
      ]}),
      new TableRow({ children: [
        new TableCell({ shading: { fill: lightBlue, type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: 'Omissions', bold: true, size: 22, font: 'Arial' })] })] }),
        new TableCell({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `(${fmt(variation.omissions)})`, size: 22, color: 'EF4444', font: 'Arial' })] })] }),
      ]}),
      new TableRow({ children: [
        new TableCell({ shading: { fill: navy, type: ShadingType.CLEAR }, children: [new Paragraph({ children: [new TextRun({ text: 'NET CHANGE TO CONTRACT SUM', bold: true, size: 22, color: 'FFFFFF', font: 'Arial' })] })] }),
        new TableCell({ shading: { fill: navy, type: ShadingType.CLEAR }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: (variation.net_change >= 0 ? '+' : '-') + fmt(variation.net_change), bold: true, size: 22, color: netColor, font: 'Arial' })] })] }),
      ]}),
    ]
  }));

  // 5. Signature Block
  children.push(new Paragraph({ children: [new TextRun({ text: '6. AUTHORISATION', bold: true, size: 24, color: navy, font: 'Arial' })], spacing: { before: 400, after: 120 } }));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        new TableCell({ children: [
          new Paragraph({ children: [new TextRun({ text: 'Client Signature:', size: 20, font: 'Arial' })], spacing: { after: 400 } }),
          new Paragraph({ border: { bottom: { color: '999999', size: 1, style: BorderStyle.SINGLE } }, spacing: { after: 80 } }),
          new Paragraph({ children: [new TextRun({ text: 'Name: ________________________', size: 20, font: 'Arial' })], spacing: { after: 80 } }),
          new Paragraph({ children: [new TextRun({ text: `Date: ________________________`, size: 20, font: 'Arial' })] }),
        ]}),
        new TableCell({ children: [
          new Paragraph({ children: [new TextRun({ text: 'QS / Contract Administrator:', size: 20, font: 'Arial' })], spacing: { after: 400 } }),
          new Paragraph({ border: { bottom: { color: '999999', size: 1, style: BorderStyle.SINGLE } }, spacing: { after: 80 } }),
          new Paragraph({ children: [new TextRun({ text: 'CRM Wizard AI', size: 20, font: 'Arial' })], spacing: { after: 80 } }),
          new Paragraph({ children: [new TextRun({ text: `Date: ${date}`, size: 20, font: 'Arial' })] }),
        ]}),
      ]}),
    ]
  }));

  // Footer note
  children.push(new Paragraph({ children: [new TextRun({ text: 'This Variation Order forms part of the Contract. The net change above adjusts the original Contract Sum accordingly. Works described herein should not commence until this VO has been signed by both parties.', size: 18, color: '888888', italics: true, font: 'Arial' })], spacing: { before: 300 } }));

  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  const filename = `VO_${variation.vo_number}_${Date.now()}.docx`;
  const outPath = path.join(outputsDir, filename);
  fs.writeFileSync(outPath, buf);
  return filename;
}

// ═══════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════

// GET /api/variations/:projectId — list all VOs for a project
router.get('/variations/:projectId', authMiddleware, (req, res) => {
  try {
    const { projectId } = req.params;
    // Verify user owns this project
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
    if (!project && req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    const variations = db.prepare('SELECT * FROM variations WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
    res.json({ variations });
  } catch (err) {
    console.error('[Variations] list error:', err);
    res.status(500).json({ error: 'Failed to load variations' });
  }
});

// POST /api/variations/:projectId — create new variation (with optional drawing upload)
router.post('/variations/:projectId', authMiddleware, upload.array('drawings', 5), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { title, description } = req.body;

    if (!title || !description) return res.status(400).json({ error: 'Title and description are required' });

    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
    if (!project && req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });

    // Get original BOQ data for context
    const boqData = db.prepare("SELECT data FROM project_data WHERE project_id = ? AND data_type = 'boq_summary'").get(projectId);

    // Build Claude prompt
    const systemPrompt = `You are an expert UK Quantity Surveyor specialising in construction contract variations. 
You analyse variation requests and produce structured cost assessments following JCT/NEC contract principles.
You must respond ONLY with valid JSON — no preamble, no markdown.`;

    const userPrompt = `Analyse this variation request for a construction project and produce a cost assessment.

PROJECT: ${project.title}
LOCATION: ${project.location || 'UK'}
TYPE: ${project.project_type}
${boqData ? `ORIGINAL BOQ CONTEXT: ${boqData.data}` : ''}

VARIATION REQUESTED:
Title: ${title}
Description: ${description}

${req.files?.length ? `${req.files.length} revised drawing(s) have been uploaded (see attached files).` : ''}

Respond ONLY with this JSON structure:
{
  "additions": <number — cost of new/extra work in GBP>,
  "omissions": <number — cost of omitted/removed work in GBP, positive number>,
  "net_change": <number — additions minus omissions, can be negative>,
  "scope_changes": [
    { "type": "addition|omission|change", "item": "item name", "detail": "brief description of change", "cost": <number> }
  ],
  "assumptions": ["assumption 1", "assumption 2"],
  "confidence": "high|medium|low",
  "notes": "any important caveats or qualifications"
}`;

    // Build message content — include uploaded drawings if present
    const content = [];
    if (req.files?.length) {
      for (const file of req.files) {
        const mediaType = getMediaType(file.path);
        const b64 = fileToBase64(file.path);
        if (mediaType === 'application/pdf') {
          content.push({ type: 'document', source: { type: 'base64', media_type: mediaType, data: b64 } });
        } else {
          content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } });
        }
      }
    }
    content.push({ type: 'text', text: userPrompt });

    const aiResponse = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content }]
    });

    let analysis = {};
    try {
      const raw = aiResponse.content[0].text.replace(/```json|```/g, '').trim();
      analysis = JSON.parse(raw);
    } catch (e) {
      console.error('[Variations] parse error:', e.message);
      analysis = { additions: 0, omissions: 0, net_change: 0, scope_changes: [], assumptions: [], notes: 'Analysis could not be parsed.' };
    }

    const voNumber = getNextVONumber(projectId);
    const id = uuidv4();
    const currency = project.currency || 'GBP';

    db.prepare(`
      INSERT INTO variations (id, project_id, user_id, vo_number, title, description, additions, omissions, net_change, currency, status, raw_analysis)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
    `).run(id, projectId, req.user.id, voNumber, title, description,
      analysis.additions || 0, analysis.omissions || 0, analysis.net_change || 0,
      currency, JSON.stringify(analysis)
    );

    // Generate VO document
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id);
    const voFilename = await generateVODocument(
      { id, vo_number: voNumber, title, description, additions: analysis.additions || 0, omissions: analysis.omissions || 0, net_change: analysis.net_change || 0, currency, status: 'draft', raw_analysis: JSON.stringify(analysis) },
      project,
      user?.full_name || 'Client'
    );

    if (voFilename) {
      db.prepare('UPDATE variations SET vo_doc_filename = ? WHERE id = ?').run(voFilename, id);
    }

    const variation = db.prepare('SELECT * FROM variations WHERE id = ?').get(id);
    res.json({ variation, analysis });

  } catch (err) {
    console.error('[Variations] create error:', err);
    res.status(500).json({ error: 'Failed to create variation: ' + err.message });
  }
});

// PATCH /api/variations/:id/approve
router.patch('/variations/:id/approve', authMiddleware, async (req, res) => {
  try {
    const variation = db.prepare('SELECT * FROM variations WHERE id = ?').get(req.params.id);
    if (!variation) return res.status(404).json({ error: 'Variation not found' });

    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(variation.project_id, req.user.id);
    if (!project && req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });

    db.prepare('UPDATE variations SET status = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('approved', req.params.id);

    // Regenerate VO doc with approved status
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id);
    const voFilename = await generateVODocument(
      { ...variation, status: 'approved' }, project, user?.full_name || 'Client'
    );
    if (voFilename) {
      db.prepare('UPDATE variations SET vo_doc_filename = ? WHERE id = ?').run(voFilename, req.params.id);
    }

    const updated = db.prepare('SELECT * FROM variations WHERE id = ?').get(req.params.id);
    res.json({ variation: updated });
  } catch (err) {
    console.error('[Variations] approve error:', err);
    res.status(500).json({ error: 'Failed to approve variation' });
  }
});

// PATCH /api/variations/:id/reject
router.patch('/variations/:id/reject', authMiddleware, (req, res) => {
  try {
    const { reason } = req.body;
    const variation = db.prepare('SELECT * FROM variations WHERE id = ?').get(req.params.id);
    if (!variation) return res.status(404).json({ error: 'Variation not found' });

    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(variation.project_id, req.user.id);
    if (!project && req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });

    db.prepare('UPDATE variations SET status = ?, rejected_at = CURRENT_TIMESTAMP, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('rejected', reason || null, req.params.id);

    const updated = db.prepare('SELECT * FROM variations WHERE id = ?').get(req.params.id);
    res.json({ variation: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject variation' });
  }
});

// GET /api/variations/download/:filename
router.get('/variations/download/:filename', authMiddleware, (req, res) => {
  try {
    const filePath = path.join(outputsDir, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.download(filePath, req.params.filename);
  } catch (err) {
    res.status(500).json({ error: 'Download failed' });
  }
});

module.exports = router;
