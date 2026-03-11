const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
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

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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

    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Anthropic API key not configured' });

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

    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content }]
      })
    });

    const aiData = await apiResponse.json();
    if (!apiResponse.ok) throw new Error(aiData.error?.message || 'Anthropic API error');

    let analysis = {};
    try {
      const raw = aiData.content[0].text.replace(/```json|```/g, '').trim();
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


// POST /api/variations/:id/generate-revised-boq
router.post('/variations/:id/generate-revised-boq', authMiddleware, async (req, res) => {
  try {
    const variation = db.prepare('SELECT * FROM variations WHERE id = ?').get(req.params.id);
    if (!variation) return res.status(404).json({ error: 'Variation not found' });
    if (variation.status !== 'approved') return res.status(400).json({ error: 'Variation must be approved first' });

    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(variation.project_id, req.user.id);
    if (!project && req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Anthropic API key not configured' });

    const allApproved = db.prepare("SELECT * FROM variations WHERE project_id = ? AND status = 'approved' ORDER BY created_at ASC").all(variation.project_id);
    const sym = (variation.currency === 'EUR') ? '€' : '£';

    // Build sections directly from stored variation analysis — no AI call needed
    // This is reliable because we already have the structured scope_changes from when the VO was created
    var sections = [];

    allApproved.forEach(function(v) {
      var analysis = {};
      try { analysis = JSON.parse(v.raw_analysis); } catch (e) {}

      var items = [];
      var itemLetter = 'A';

      // Build items from scope_changes
      var changes = analysis.scope_changes || [];
      changes.forEach(function(change) {
        var cost = parseFloat(change.cost) || 0;
        var labour = Math.round(cost * 0.55 * 100) / 100;
        var materials = Math.round(cost * 0.45 * 100) / 100;
        items.push({
          item: itemLetter,
          description: (change.type === 'omission' ? '[OMISSION] ' : '') + change.item + (change.detail ? ' — ' + change.detail : ''),
          unit: change.unit || 'item',
          qty: 1,
          rate: cost,
          labour: change.type === 'omission' ? -labour : labour,
          materials: change.type === 'omission' ? -materials : materials,
          total: change.type === 'omission' ? -cost : cost,
          rate_source: 'generic'
        });
        itemLetter = String.fromCharCode(itemLetter.charCodeAt(0) + 1);
      });

      // If no scope_changes, create a single summary item
      if (items.length === 0) {
        var net = parseFloat(v.net_change) || 0;
        var labour = Math.round(Math.abs(net) * 0.55 * 100) / 100;
        var materials = Math.round(Math.abs(net) * 0.45 * 100) / 100;
        items.push({
          item: 'A',
          description: v.description,
          unit: 'item',
          qty: 1,
          rate: Math.abs(net),
          labour: net >= 0 ? labour : -labour,
          materials: net >= 0 ? materials : -materials,
          total: net,
          rate_source: 'generic'
        });
      }

      sections.push({
        number: v.vo_number,
        title: v.title,
        items: items
      });
    });

    var totalVariations = allApproved.reduce(function(s, v) { return s + (parseFloat(v.net_change) || 0); }, 0);
    var originalTotal = parseFloat(project.total_value) || 0;

    var generateBOQExcel;
    try { var mod = require('./boqGenerator'); generateBOQExcel = mod.generateBOQExcel; } catch (e) {
      return res.status(500).json({ error: 'BOQ generator not available' });
    }

    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.user.id);
    const buffer = await generateBOQExcel(
      sections,
      project.title + ' — VARIATION ACCOUNT',
      user ? user.full_name : 'Client',
      { currency: sym }
    );

    const filename = 'VariationAccount_' + project.title.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now() + '.xlsx';
    const outPath = path.join(outputsDir, filename);
    fs.writeFileSync(outPath, buffer);

    db.prepare('UPDATE variations SET revised_boq_filename = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(filename, req.params.id);

    const updated = db.prepare('SELECT * FROM variations WHERE id = ?').get(req.params.id);
    res.json({
      variation: updated,
      filename: filename,
      summary: { original_total: originalTotal, variations_total: totalVariations, revised_total: originalTotal + totalVariations, currency: variation.currency || 'GBP' }
    });

  } catch (err) {
    console.error('[Variations] revised BOQ error:', err);
    res.status(500).json({ error: 'Failed to generate variation account: ' + err.message });
  }
});

// POST /api/projects/:projectId/client-copy — generate client copy with baked-in margins
router.post('/projects/:projectId/client-copy', authMiddleware, async (req, res) => {
  try {
    const { projectId } = req.params;
    const contingency = parseFloat(req.body.contingency) || 0;
    const ohp = parseFloat(req.body.ohp) || 0;
    const vat = parseFloat(req.body.vat) || 0;

    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(projectId, req.user.id);
    if (!project && req.user.role !== 'admin') return res.status(403).json({ error: 'Access denied' });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.boq_filename) return res.status(400).json({ error: 'No BOQ found for this project' });

    // Read the original BOQ Excel and re-build with uplifted values using ExcelJS
    const ExcelJS = require('exceljs');
    const originalPath = path.join(outputsDir, project.boq_filename);
    if (!require('fs').existsSync(originalPath)) return res.status(404).json({ error: 'Original BOQ file not found on server' });

    // Uplift multiplier: compound the percentages
    const multiplier = (1 + contingency / 100) * (1 + ohp / 100) * (1 + vat / 100);

    const srcWb = new ExcelJS.Workbook();
    await srcWb.xlsx.readFile(originalPath);

    const srcWs = srcWb.getWorksheet('BOQ') || srcWb.worksheets[0];
    if (!srcWs) return res.status(500).json({ error: 'Could not read BOQ worksheet' });

    // Build new workbook — clone structure, uplift monetary columns
    const newWb = new ExcelJS.Workbook();
    newWb.creator = 'The AI QS';
    newWb.created = new Date();

    const newWs = newWb.addWorksheet('BOQ', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 }
    });

    // Monetary columns (1-indexed): Rate=5, Labour=6, Materials=7, Total=8
    const monetaryCols = new Set([5, 6, 7, 8]);
    // Columns to HIDE in client copy: Rate Source (9)
    const hiddenCols = new Set([9]);

    srcWs.eachRow({ includeEmpty: true }, function(row, rowNumber) {
      const newRow = newWs.getRow(rowNumber);

      // Copy row height
      newRow.height = row.height;

      row.eachCell({ includeEmpty: true }, function(cell, colNumber) {
        if (hiddenCols.has(colNumber)) return; // skip rate source column

        const newCell = newRow.getCell(colNumber);

        // Copy style
        if (cell.style) {
          try { newCell.style = JSON.parse(JSON.stringify(cell.style)); } catch (e) {}
        }

        // Modify title row to add "CLIENT COPY" label
        if (rowNumber === 1 && colNumber === 1) {
          const origVal = (typeof cell.value === 'object' && cell.value?.richText)
            ? cell.value.richText.map(r => r.text).join('') : (cell.value || '');
          newCell.value = origVal + ' — CLIENT COPY';
          return;
        }

        // Uplift monetary cells that contain numbers
        if (monetaryCols.has(colNumber) && typeof cell.value === 'number') {
          newCell.value = Math.round(cell.value * multiplier * 100) / 100;
          return;
        }

        // For formula cells in monetary columns, extract cached value and uplift
        if (monetaryCols.has(colNumber) && cell.value && typeof cell.value === 'object' && cell.value.formula) {
          const cached = cell.value.result;
          if (typeof cached === 'number') {
            newCell.value = Math.round(cached * multiplier * 100) / 100;
          } else {
            newCell.value = cached || 0;
          }
          return;
        }

        // Everything else — copy as-is
        if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
          newCell.value = cell.value.result || 0;
        } else {
          newCell.value = cell.value;
        }
      });

      newRow.commit();
    });

    // Copy column widths (skip hidden)
    srcWs.columns.forEach(function(col, i) {
      if (!hiddenCols.has(i + 1) && col.width) {
        newWs.getColumn(i + 1).width = col.width;
      }
    });

    // Copy merged cells
    if (srcWs.mergeCells) {
      try {
        Object.keys(srcWs._merges || {}).forEach(function(key) {
          try { newWs.mergeCells(key); } catch (e) {}
        });
      } catch (e) {}
    }

    // Add uplift note at bottom
    const lastRow = newWs.rowCount + 2;
    const noteRow = newWs.getRow(lastRow);
    noteRow.getCell(1).value = 'This document is prepared for client use. All rates are inclusive of contingency, overhead & profit' + (vat > 0 ? ', and VAT' : '') + '.';
    noteRow.getCell(1).font = { name: 'Arial', size: 9, italic: true, color: { argb: 'FF888888' } };
    noteRow.commit();

    // Freeze panes
    newWs.views = [{ state: 'frozen', ySplit: 4, activeCell: 'A5' }];
    newWs.headerFooter.oddFooter = '&LThe AI QS - theaiqs.co.uk — CLIENT COPY&RPage &P of &N';

    const buffer = await newWb.xlsx.writeBuffer();
    const filename = 'ClientCopy_' + project.title.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now() + '.xlsx';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(Buffer.from(buffer));

  } catch (err) {
    console.error('[ClientCopy] error:', err);
    res.status(500).json({ error: 'Failed to generate client copy: ' + err.message });
  }
});

module.exports = router;
