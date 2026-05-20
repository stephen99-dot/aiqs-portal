// ═══════════════════════════════════════════════════════════════════════════════
// WAVE 5 — DOCUMENTS & COMPLIANCE — server/documentsRoutes.js
//
// Code-defined, branded, fillable templates. The builder picks one, fills the
// schema, exports a branded PDF. Filled values are stored as a JSON blob on
// the row; the template_id points at code that owns the schema + render.
//
// Templates are deliberately fixed in code, not user-editable — same reason
// the doc XLSX/DOCX templates in PORTAL_SPEC.md are fixed.
//
//   GET    /api/documents/templates
//   GET    /api/documents
//   POST   /api/documents
//   GET    /api/documents/:id
//   PATCH  /api/documents/:id
//   POST   /api/documents/:id/duplicate
//   DELETE /api/documents/:id
//   GET    /api/documents/:id/pdf
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware, requireEstimator, requireEstimatorPassword } = require('./auth');

const router = express.Router();
router.use(authMiddleware, requireEstimator, requireEstimatorPassword);

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const brandingDir = path.join(DATA_DIR, 'branding');

// ─── Template definitions ───────────────────────────────────────────────────
// Each template = { id, label, description, fields[], render(doc, ctx) }.
// Field types: text | textarea | date | number | checkbox | list (one-per-line).

const TEMPLATES = [
  {
    id: 'contract',
    label: 'Contract for works',
    description: 'A short JCT-style works contract between you and your client. Edit any field after generating.',
    fields: [
      { key: 'contract_date', label: 'Contract date', type: 'date', required: true },
      { key: 'client_name', label: 'Client (employer) name', type: 'text', required: true },
      { key: 'client_address', label: 'Client address', type: 'textarea' },
      { key: 'site_address', label: 'Site address', type: 'textarea', required: true },
      { key: 'scope_summary', label: 'Scope summary', type: 'textarea', required: true,
        help: 'A short description of the works. Full scope can be referenced as an attachment.' },
      { key: 'contract_sum', label: 'Contract sum (£, excl. VAT)', type: 'number', required: true },
      { key: 'vat_pct', label: 'VAT %', type: 'number', default: 20 },
      { key: 'start_date', label: 'Start date on site', type: 'date' },
      { key: 'duration_weeks', label: 'Duration (weeks)', type: 'number' },
      { key: 'retention_pct', label: 'Retention %', type: 'number', default: 5 },
      { key: 'payment_terms', label: 'Payment terms', type: 'textarea',
        default: 'Stage payments per the payment schedule attached. Net 14 days from invoice date.' },
      { key: 'variations_clause', label: 'Variations clause', type: 'textarea',
        default: 'Variations to the scope must be agreed in writing (or via the e-approval link in this system) before work proceeds. Approved variations form part of this contract.' },
      { key: 'governing_law', label: 'Governing law', type: 'text', default: 'England & Wales' },
    ],
    render: renderContract,
  },
  {
    id: 'terms-conditions',
    label: 'Terms & conditions',
    description: 'Standard small-builder T&Cs. Use as a permanent attachment to quotes and contracts.',
    fields: [
      { key: 'effective_date', label: 'Effective from', type: 'date', required: true },
      { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', default: 'England & Wales' },
      { key: 'payment_days', label: 'Payment terms (days)', type: 'number', default: 14 },
      { key: 'late_payment_pct', label: 'Late payment interest %', type: 'number', default: 8 },
      { key: 'warranty_months', label: 'Warranty on workmanship (months)', type: 'number', default: 12 },
      { key: 'extra_clauses', label: 'Additional clauses (one per line)', type: 'list' },
    ],
    render: renderTerms,
  },
  {
    id: 'scope-of-work',
    label: 'Scope of work',
    description: 'A clear inclusions / exclusions / assumptions sheet to attach to a quote or contract.',
    fields: [
      { key: 'project_name', label: 'Project name', type: 'text', required: true },
      { key: 'site_address', label: 'Site address', type: 'textarea' },
      { key: 'overview', label: 'Overview', type: 'textarea', required: true,
        help: 'A 2-4 sentence summary of what the works are.' },
      { key: 'inclusions', label: 'Inclusions (one per line)', type: 'list', required: true,
        help: 'What is in the price. Be specific.' },
      { key: 'exclusions', label: 'Exclusions (one per line)', type: 'list',
        help: 'What is NOT in the price — building control fees, structural eng, finishes, etc.' },
      { key: 'assumptions', label: 'Assumptions (one per line)', type: 'list' },
      { key: 'access_hours', label: 'Working hours / site access', type: 'text', default: 'Monday-Friday, 08:00-17:00' },
    ],
    render: renderScopeOfWork,
  },
  {
    id: 'payment-terms',
    label: 'Payment terms',
    description: 'Payment schedule and late-payment / retention clauses, ready to send with the contract.',
    fields: [
      { key: 'project_name', label: 'Project name', type: 'text', required: true },
      { key: 'contract_sum', label: 'Contract sum (£, excl. VAT)', type: 'number', required: true },
      { key: 'vat_pct', label: 'VAT %', type: 'number', default: 20 },
      { key: 'deposit_pct', label: 'Deposit %', type: 'number', default: 10 },
      { key: 'stages', label: 'Stages (one per line, "label | amount or %")', type: 'list',
        default: 'Deposit on signing | 10%\nFrame complete | 30%\n1st fix complete | 30%\nPractical completion | 25%\nRetention release after 6mo | 5%' },
      { key: 'retention_pct', label: 'Retention %', type: 'number', default: 5 },
      { key: 'retention_period_months', label: 'Retention period (months)', type: 'number', default: 6 },
      { key: 'late_payment_clause', label: 'Late payment clause', type: 'textarea',
        default: 'Late payments accrue interest at 8% above the Bank of England base rate per the Late Payment of Commercial Debts (Interest) Act.' },
    ],
    render: renderPaymentTerms,
  },
  {
    id: 'health-safety-rams',
    label: 'Health & safety — RAMS',
    description: 'A short Risk Assessment & Method Statement for a single task on site.',
    fields: [
      { key: 'site_address', label: 'Site address', type: 'textarea', required: true },
      { key: 'task_description', label: 'Task description', type: 'textarea', required: true },
      { key: 'duration', label: 'Estimated duration', type: 'text' },
      { key: 'hazards', label: 'Hazards identified (one per line)', type: 'list', required: true },
      { key: 'controls', label: 'Control measures (one per line)', type: 'list', required: true },
      { key: 'ppe', label: 'PPE required (one per line)', type: 'list',
        default: 'Hard hat\nHi-vis vest\nSafety boots\nGloves\nEye protection' },
      { key: 'first_aider', label: 'First aider on site', type: 'text' },
      { key: 'emergency_contact', label: 'Emergency contact (name + phone)', type: 'text' },
      { key: 'nearest_hospital', label: 'Nearest A&E', type: 'text' },
    ],
    render: renderRAMS,
  },
];

const TEMPLATE_INDEX = Object.fromEntries(TEMPLATES.map(t => [t.id, t]));

// Public-facing template metadata: strips the render function.
function publicTemplate(tpl) {
  return {
    id: tpl.id,
    label: tpl.label,
    description: tpl.description,
    fields: tpl.fields.map(f => ({ ...f })),
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function getBranding(userId) {
  let row = db.prepare('SELECT * FROM user_branding WHERE user_id = ?').get(userId);
  if (!row) {
    row = { logo_filename: null, primary_colour: '#1B2A4A', accent_colour: '#F59E0B',
      company_name: null, company_address: null, footer_text: null };
  }
  return row;
}
function getUserDisplay(userId) {
  return db.prepare('SELECT email, full_name, company FROM users WHERE id = ?').get(userId);
}

// Build default field values from the template schema. Used when creating
// new docs so the form opens pre-populated.
function defaultsFor(tpl) {
  const out = {};
  for (const f of tpl.fields) {
    if ('default' in f) out[f.key] = f.default;
    else if (f.type === 'list') out[f.key] = '';
    else if (f.type === 'checkbox') out[f.key] = false;
    else out[f.key] = '';
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════════════

router.get('/templates', (req, res) => {
  res.json({ templates: TEMPLATES.map(publicTemplate) });
});

router.get('/', (req, res) => {
  try {
    const jobId = (req.query.job_id || '').toString();
    let sql = `SELECT d.id, d.user_id, d.job_id, d.template_id, d.title, d.created_at, d.updated_at,
                      j.name AS job_name
               FROM documents d
               LEFT JOIN estimator_jobs j ON j.id = d.job_id
               WHERE d.user_id = ?`;
    const params = [req.user.id];
    if (jobId) { sql += ' AND d.job_id = ?'; params.push(jobId); }
    sql += ' ORDER BY d.created_at DESC LIMIT 500';
    const rows = db.prepare(sql).all(...params);
    const labelFor = (id) => TEMPLATE_INDEX[id] ? TEMPLATE_INDEX[id].label : id;
    res.json({ documents: rows.map(r => ({ ...r, template_label: labelFor(r.template_id) })) });
  } catch (err) {
    console.error('[Documents] list error:', err);
    res.status(500).json({ error: 'Failed to load documents.' });
  }
});

router.post('/', (req, res) => {
  try {
    const b = req.body || {};
    const tpl = TEMPLATE_INDEX[b.template_id];
    if (!tpl) return res.status(400).json({ error: 'Unknown template.' });
    if (b.job_id) {
      const job = db.prepare('SELECT id FROM estimator_jobs WHERE id = ? AND user_id = ?').get(b.job_id, req.user.id);
      if (!job) return res.status(400).json({ error: 'Invalid job_id.' });
    }
    const fields = { ...defaultsFor(tpl), ...(b.fields || {}) };
    const id = uuidv4();
    const title = (b.title || '').toString().slice(0, 200) || (tpl.label + ' — ' + new Date().toLocaleDateString('en-GB'));
    db.prepare(
      'INSERT INTO documents (id, user_id, job_id, template_id, title, fields) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, req.user.id, b.job_id || null, tpl.id, title, JSON.stringify(fields));
    res.status(201).json({ id });
  } catch (err) {
    console.error('[Documents] create error:', err);
    res.status(500).json({ error: 'Failed to create document.' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Document not found.' });
    let fields = {};
    try { fields = JSON.parse(row.fields || '{}'); } catch (e) {}
    res.json({ document: { ...row, fields }, template: TEMPLATE_INDEX[row.template_id] ? publicTemplate(TEMPLATE_INDEX[row.template_id]) : null });
  } catch (err) {
    console.error('[Documents] get error:', err);
    res.status(500).json({ error: 'Failed to load document.' });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Document not found.' });
    const b = req.body || {};
    const sets = [];
    const vals = [];
    if ('title' in b) { sets.push('title = ?'); vals.push((b.title || '').toString().slice(0, 200)); }
    if ('job_id' in b) {
      if (b.job_id) {
        const job = db.prepare('SELECT id FROM estimator_jobs WHERE id = ? AND user_id = ?').get(b.job_id, req.user.id);
        if (!job) return res.status(400).json({ error: 'Invalid job_id.' });
      }
      sets.push('job_id = ?'); vals.push(b.job_id || null);
    }
    if ('fields' in b) {
      // Merge with existing so partial updates work.
      let prev = {};
      try { prev = JSON.parse(row.fields || '{}'); } catch (e) {}
      const next = { ...prev, ...b.fields };
      sets.push('fields = ?'); vals.push(JSON.stringify(next));
    }
    if (sets.length > 0) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(row.id);
      db.prepare('UPDATE documents SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
    }
    res.json({ id: row.id });
  } catch (err) {
    console.error('[Documents] patch error:', err);
    res.status(500).json({ error: 'Failed to update document.' });
  }
});

router.post('/:id/duplicate', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Document not found.' });
    const newId = uuidv4();
    db.prepare(
      'INSERT INTO documents (id, user_id, job_id, template_id, title, fields) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(newId, req.user.id, row.job_id, row.template_id, (row.title || '') + ' (copy)', row.fields);
    res.status(201).json({ id: newId });
  } catch (err) {
    console.error('[Documents] duplicate error:', err);
    res.status(500).json({ error: 'Failed to duplicate document.' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const r = db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Document not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Documents] delete error:', err);
    res.status(500).json({ error: 'Failed to delete document.' });
  }
});

// ─── PDF ────────────────────────────────────────────────────────────────────

router.get('/:id/pdf', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Document not found.' });
    const tpl = TEMPLATE_INDEX[row.template_id];
    if (!tpl) return res.status(500).json({ error: 'Unknown template.' });
    let fields = {};
    try { fields = JSON.parse(row.fields || '{}'); } catch (e) {}

    const branding = getBranding(req.user.id);
    const user = getUserDisplay(req.user.id);
    const job = row.job_id ? db.prepare('SELECT * FROM estimator_jobs WHERE id = ?').get(row.job_id) : null;

    const fnameBase = (row.title || tpl.id).replace(/[^a-z0-9\-_]/gi, '_').slice(0, 80);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fnameBase + '.pdf"');

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    const ctx = { row, tpl, fields, branding, user, job };
    paintHeader(doc, ctx);
    tpl.render(doc, ctx);
    paintFooter(doc, ctx);

    doc.end();
  } catch (err) {
    console.error('[Documents] PDF error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate PDF.' });
  }
});

// ─── PDF rendering helpers ──────────────────────────────────────────────────

function paintHeader(doc, ctx) {
  const primary = ctx.branding.primary_colour || '#1B2A4A';
  doc.rect(0, 0, doc.page.width, 90).fill(primary);
  let titleX = 50;
  if (ctx.branding.logo_filename) {
    const logoPath = path.join(brandingDir, ctx.branding.logo_filename);
    if (fs.existsSync(logoPath) && /\.(png|jpe?g)$/i.test(ctx.branding.logo_filename)) {
      try { doc.image(logoPath, 50, 22, { fit: [120, 46] }); titleX = 185; } catch (e) {}
    }
  }
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
    .text(ctx.branding.company_name || ctx.user?.company || ctx.user?.full_name || 'Document', titleX, 28);
  doc.font('Helvetica').fontSize(10)
    .text(ctx.tpl.label, titleX, 56)
    .text(new Date().toLocaleDateString('en-GB'), titleX, 70);
}

function paintFooter(doc, ctx) {
  const footY = doc.page.height - 40;
  doc.font('Helvetica').fontSize(8).fillColor('#666666').text(
    ctx.branding.footer_text || 'Generated via the AI QS portal.',
    50, footY, { width: doc.page.width - 100, align: 'center' }
  );
}

// Section heading bar inside the body.
function sectionH(doc, text, opts = {}) {
  const y = doc.y + (opts.gap ?? 10);
  doc.y = y;
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111').text(text, 50, y);
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10).fillColor('#333333');
}

// Paragraph block helper.
function para(doc, text) {
  if (!text) return;
  doc.font('Helvetica').fontSize(10).fillColor('#333333').text(text, { width: doc.page.width - 100 });
  doc.moveDown(0.3);
}

// Key-value row: "Label: value".
function kvRow(doc, label, value) {
  if (value == null || value === '') return;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111');
  doc.text(label + ': ', { continued: true });
  doc.font('Helvetica').fillColor('#333333').text(String(value));
}

// Bulleted list (one item per line of `text`, separated by \n).
function bulletList(doc, text) {
  if (!text) return;
  const items = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (items.length === 0) return;
  doc.font('Helvetica').fontSize(10).fillColor('#333333');
  for (const item of items) {
    doc.text('•  ' + item, { width: doc.page.width - 100, indent: 0 });
  }
  doc.moveDown(0.3);
}

function startBody(doc) {
  doc.y = 120;
  doc.fillColor('#111111');
}

function fmtCurrency(n) {
  const v = num(n);
  return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Template renderers ─────────────────────────────────────────────────────

function renderContract(doc, ctx) {
  const f = ctx.fields;
  startBody(doc);

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111111').text('Contract for works', { align: 'left' });
  doc.moveDown(0.5);
  if (f.contract_date) {
    doc.font('Helvetica').fontSize(10).fillColor('#666666').text('Dated ' + f.contract_date);
    doc.moveDown(0.5);
  }

  sectionH(doc, '1. Parties');
  const contractorName = ctx.branding.company_name || ctx.user?.company || ctx.user?.full_name || '(contractor)';
  para(doc, 'Contractor: ' + contractorName);
  if (ctx.branding.company_address) para(doc, ctx.branding.company_address);
  kvRow(doc, 'Employer', f.client_name);
  if (f.client_address) para(doc, f.client_address);

  sectionH(doc, '2. The works');
  kvRow(doc, 'Site address', f.site_address);
  doc.moveDown(0.3);
  para(doc, f.scope_summary);

  sectionH(doc, '3. Contract sum');
  const net = num(f.contract_sum);
  const vat = net * (num(f.vat_pct, 20) / 100);
  kvRow(doc, 'Net', fmtCurrency(net));
  kvRow(doc, 'VAT (' + num(f.vat_pct, 20) + '%)', fmtCurrency(vat));
  kvRow(doc, 'Total', fmtCurrency(net + vat));

  sectionH(doc, '4. Programme');
  kvRow(doc, 'Start on site', f.start_date);
  kvRow(doc, 'Duration', f.duration_weeks ? f.duration_weeks + ' weeks' : null);

  sectionH(doc, '5. Payment terms');
  para(doc, f.payment_terms);

  sectionH(doc, '6. Retention');
  if (f.retention_pct) {
    para(doc, num(f.retention_pct) + '% of each interim payment is retained. Half released on practical completion, the balance after the defects period.');
  }

  sectionH(doc, '7. Variations');
  para(doc, f.variations_clause);

  sectionH(doc, '8. Governing law');
  para(doc, 'This contract is governed by the law of ' + (f.governing_law || 'England & Wales') + '.');

  sectionH(doc, '9. Signatures', { gap: 18 });
  doc.moveDown(1);
  signatureLine(doc, 'Contractor', contractorName);
  doc.moveDown(1.5);
  signatureLine(doc, 'Employer', f.client_name);
}

function signatureLine(doc, role, name) {
  const startY = doc.y;
  doc.font('Helvetica').fontSize(10).fillColor('#111111').text(role + ': ' + (name || ''));
  doc.moveDown(2);
  const y = doc.y;
  doc.moveTo(50, y).lineTo(280, y).strokeColor('#333333').lineWidth(0.5).stroke();
  doc.moveTo(310, y).lineTo(440, y).stroke();
  doc.fontSize(8).fillColor('#666666').text('Signed', 50, y + 2).text('Date', 310, y + 2);
  doc.fillColor('#111111').fontSize(10);
}

function renderTerms(doc, ctx) {
  const f = ctx.fields;
  startBody(doc);
  doc.font('Helvetica-Bold').fontSize(16).text('Terms & Conditions');
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10).fillColor('#666666').text('Effective from ' + (f.effective_date || ''));
  doc.moveDown(0.6);
  const company = ctx.branding.company_name || ctx.user?.company || ctx.user?.full_name || '(the Contractor)';

  sectionH(doc, '1. Definitions');
  para(doc, '"Contractor" means ' + company + '. "Customer" means the party engaging the Contractor for the works. "Works" means the building or construction work agreed in the quote and/or contract.');

  sectionH(doc, '2. Acceptance');
  para(doc, 'A signed quote, signed contract, or written instruction to proceed constitutes acceptance of these terms. These terms apply to the exclusion of any other terms the Customer seeks to impose.');

  sectionH(doc, '3. Price & variations');
  para(doc, 'The price is fixed for the works described in the quote. Variations are priced and presented for approval before being undertaken. Approved variations are added to the contract sum.');

  sectionH(doc, '4. Payment');
  para(doc, 'Invoices are payable within ' + num(f.payment_days, 14) + ' days of issue. The Contractor reserves the right to charge interest at ' + num(f.late_payment_pct, 8) + '% above the Bank of England base rate on any overdue sums, per the Late Payment of Commercial Debts (Interest) Act 1998.');

  sectionH(doc, '5. Warranty');
  para(doc, 'The Contractor warrants its workmanship for ' + num(f.warranty_months, 12) + ' months from practical completion. The warranty excludes wear and tear, misuse, and works affected by changes by others.');

  sectionH(doc, '6. Liability');
  para(doc, 'Save for death or personal injury caused by negligence, the Contractor\'s total liability under this contract is limited to the contract sum.');

  sectionH(doc, '7. Insurance');
  para(doc, 'The Contractor maintains public liability insurance and employer\'s liability insurance to industry-standard limits; certificates available on request.');

  sectionH(doc, '8. Cancellation');
  para(doc, 'The Customer may cancel before works commence, paying for any costs already reasonably incurred by the Contractor. Once works have commenced, cancellation is subject to payment for works done and materials ordered.');

  sectionH(doc, '9. Jurisdiction');
  para(doc, 'This agreement is governed by the law of ' + (f.jurisdiction || 'England & Wales') + ' and subject to the exclusive jurisdiction of its courts.');

  if (f.extra_clauses) {
    sectionH(doc, '10. Additional terms');
    bulletList(doc, f.extra_clauses);
  }
}

function renderScopeOfWork(doc, ctx) {
  const f = ctx.fields;
  startBody(doc);
  doc.font('Helvetica-Bold').fontSize(16).text('Scope of work');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(11).fillColor('#444444').text(f.project_name || '');
  if (f.site_address) {
    doc.fontSize(10).fillColor('#666666').text(f.site_address);
  }
  doc.moveDown(0.5);

  sectionH(doc, 'Overview');
  para(doc, f.overview);

  sectionH(doc, 'Inclusions');
  bulletList(doc, f.inclusions);

  if (f.exclusions) {
    sectionH(doc, 'Exclusions');
    bulletList(doc, f.exclusions);
  }

  if (f.assumptions) {
    sectionH(doc, 'Assumptions');
    bulletList(doc, f.assumptions);
  }

  if (f.access_hours) {
    sectionH(doc, 'Working hours / site access');
    para(doc, f.access_hours);
  }
}

function renderPaymentTerms(doc, ctx) {
  const f = ctx.fields;
  startBody(doc);
  doc.font('Helvetica-Bold').fontSize(16).text('Payment terms');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(11).fillColor('#444444').text(f.project_name || '');
  doc.moveDown(0.5);

  sectionH(doc, 'Contract sum');
  const net = num(f.contract_sum);
  const vat = net * (num(f.vat_pct, 20) / 100);
  kvRow(doc, 'Net', fmtCurrency(net));
  kvRow(doc, 'VAT (' + num(f.vat_pct, 20) + '%)', fmtCurrency(vat));
  kvRow(doc, 'Total', fmtCurrency(net + vat));

  sectionH(doc, 'Payment schedule');
  const stageLines = String(f.stages || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (stageLines.length === 0) {
    para(doc, 'No stages defined.');
  } else {
    doc.font('Helvetica').fontSize(10).fillColor('#333333');
    for (const ln of stageLines) {
      const [label, amount] = ln.split('|').map(s => (s || '').trim());
      const amtRendered = (() => {
        if (!amount) return '';
        // Recognise "10%" vs "£500" vs "500".
        if (amount.endsWith('%')) {
          const pct = num(amount.replace('%', ''));
          if (net > 0) return amount + ' (' + fmtCurrency(net * pct / 100) + ')';
          return amount;
        }
        if (amount.startsWith('£')) return amount;
        return fmtCurrency(num(amount));
      })();
      doc.text('•  ' + label + (amtRendered ? '  —  ' + amtRendered : ''));
    }
    doc.moveDown(0.3);
  }

  if (f.retention_pct) {
    sectionH(doc, 'Retention');
    para(doc, num(f.retention_pct) + '% retention is held on each interim payment. Half is released on practical completion; the balance is released after the ' + num(f.retention_period_months, 6) + '-month retention period, subject to all defects being made good.');
  }

  sectionH(doc, 'Late payment');
  para(doc, f.late_payment_clause);
}

function renderRAMS(doc, ctx) {
  const f = ctx.fields;
  startBody(doc);
  doc.font('Helvetica-Bold').fontSize(16).text('Risk Assessment & Method Statement');
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10).fillColor('#666666').text(new Date().toLocaleDateString('en-GB'));
  doc.moveDown(0.6);

  sectionH(doc, 'Site');
  para(doc, f.site_address);

  sectionH(doc, 'Task');
  para(doc, f.task_description);
  if (f.duration) kvRow(doc, 'Estimated duration', f.duration);

  sectionH(doc, 'Hazards');
  bulletList(doc, f.hazards);

  sectionH(doc, 'Control measures');
  bulletList(doc, f.controls);

  sectionH(doc, 'PPE required');
  bulletList(doc, f.ppe);

  sectionH(doc, 'Emergency arrangements');
  if (f.first_aider) kvRow(doc, 'First aider', f.first_aider);
  if (f.emergency_contact) kvRow(doc, 'Emergency contact', f.emergency_contact);
  if (f.nearest_hospital) kvRow(doc, 'Nearest A&E', f.nearest_hospital);

  doc.moveDown(1);
  signatureLine(doc, 'Method approved by', ctx.user?.full_name || '');
}

module.exports = router;
