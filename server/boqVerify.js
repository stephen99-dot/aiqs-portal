/**
 * BOQ verification gate.
 *
 * Every figure on the Builder Pack, the Client Copy and a quote started from a
 * delivered bill comes from parseBOQ() reading the QS's spreadsheet. Each QS
 * lays a bill out differently, and twice now a layout the parser had not seen
 * put wrong figures in front of a customer: a labour breakdown wired up as
 * the bill (a £217k job shown as £2k), and a bill whose section-total rows and
 * summary page were read as priced lines (a £430k job shown as £1.02m).
 *
 * The rule this module enforces: a bill is only served to a customer once the
 * lines read from it add up to the total the bill itself prints. A bill that
 * fails is locked — the customer sees "being checked", not numbers — and the
 * admin is told what failed, so the problem is fixed before anyone is misled.
 *
 * Status values (stored on projects.boq_verification as JSON):
 *   verified          lines reconcile to the printed total
 *   overridden        an admin unlocked it after checking by hand
 *   not_a_bill        no Description / Qty header on any sheet (wrong file)
 *   no_printed_total  a bill with no total line to check against
 *   mismatch          lines do not add up to the printed total
 *   unreadable        the workbook could not be opened / parsed
 *   missing           the wired file is not on disk
 */

const fs = require('fs');
const path = require('path');
const db = require('./database');
const { parseBOQ, sniffBOQ, reconcileParsed } = require('./builderExports');

const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const outputsDir = path.join(DATA_DIR, 'outputs');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hello@crmwizardai.com';

const round2 = (v) => Math.round((v || 0) * 100) / 100;

// Pure check of one workbook. No database, no side effects — unit-testable.
//   → { ok, status, message, detail }
async function verifyBoqFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, status: 'missing', message: 'The BOQ file is not on the server.', detail: {} };
  }
  let parsed;
  try {
    parsed = await parseBOQ(filePath);
  } catch (err) {
    return { ok: false, status: 'unreadable', message: 'The BOQ could not be read: ' + (err.message || err), detail: {} };
  }
  const items = parsed.sections.reduce((a, s) => a + s.items.length, 0);
  const detail = {
    sheet: parsed.sheet || null,
    header_detected: parsed.header_detected !== false,
    sections: parsed.sections.length,
    items,
    parsed_total: round2(parsed.grand.total),
    printed_total: null,
    basis: null,
  };
  if (parsed.header_detected === false) {
    return {
      ok: false, status: 'not_a_bill', detail,
      message: 'No Item / Description / Qty / Total header was found on any sheet (sheet read: "' + detail.sheet + '"). '
        + 'This is probably not the bill — a labour breakdown or materials list delivered alongside it.',
    };
  }
  if (!parsed.sections.length || !items) {
    return { ok: false, status: 'not_a_bill', detail, message: 'No priced lines were found in the bill.' };
  }
  const recon = reconcileParsed(parsed);
  if (!recon) {
    return {
      ok: false, status: 'no_printed_total', detail,
      message: 'The bill prints no net / ex-VAT total line to check the lines against, so the ' + items
        + ' lines read (£' + detail.parsed_total.toLocaleString('en-GB') + ') cannot be verified. Add a "Net construction cost" or "Total (excl. VAT)" line to the bill.',
    };
  }
  detail.printed_total = round2(recon.printed);
  detail.basis = recon.basis;
  if (!recon.ok) {
    return {
      ok: false, status: 'mismatch', detail,
      message: 'The ' + items + ' lines read from the bill add up to £' + detail.parsed_total.toLocaleString('en-GB')
        + ' but the bill prints ' + (recon.basis === 'net' ? 'a net total' : 'an ex-VAT total') + ' of £'
        + detail.printed_total.toLocaleString('en-GB') + '. A total row, summary page or unusual column layout is being misread.',
    };
  }
  return {
    ok: true, status: 'verified', detail,
    message: items + ' lines across ' + parsed.sections.length + ' sections reconcile to the bill\'s printed total of £'
      + detail.printed_total.toLocaleString('en-GB') + '.',
  };
}

// ── The bill behind a project, self-healing ────────────────────────────────
// projects.boq_filename used to be wired to the FIRST .xlsx of a delivery
// batch, so a labour breakdown or materials list sent alongside the bill could
// shadow it. When the wired file doesn't read as a bill but another delivered
// spreadsheet does, switch to that one and persist it.
const billCache = new Map(); // filename → looks_like_boq (files are immutable once written)
async function looksLikeBill(filename) {
  if (billCache.has(filename)) return billCache.get(filename);
  let ok = false;
  try {
    const fp = path.join(outputsDir, filename);
    if (fs.existsSync(fp)) ok = !!(await sniffBOQ(fp)).looks_like_boq;
  } catch (e) { ok = false; }
  billCache.set(filename, ok);
  return ok;
}

async function resolveProjectBoq(project) {
  if (!project || !project.boq_filename) return null;
  const current = project.boq_filename;
  if (await looksLikeBill(current)) return { filePath: path.join(outputsDir, current), filename: current };
  let rows = [];
  try {
    rows = db.prepare(
      "SELECT filename, original_name FROM project_deliverables WHERE project_id = ? AND kind = 'boq' "
      + "AND (filename LIKE '%.xlsx' OR filename LIKE '%.xls') ORDER BY is_latest DESC, version DESC, created_at DESC"
    ).all(project.id);
  } catch (e) { rows = []; }
  for (const r of rows) {
    if (r.filename === current) continue;
    if (await looksLikeBill(r.filename)) {
      console.warn('[BoqVerify] project ' + project.id + ': wired BOQ ' + current + ' is not a bill; switching to ' + r.filename + ' (' + (r.original_name || '') + ')');
      try { db.prepare('UPDATE projects SET boq_filename = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(r.filename, project.id); } catch (e) { /* keep serving */ }
      project.boq_filename = r.filename;
      return { filePath: path.join(outputsDir, r.filename), filename: r.filename };
    }
  }
  return { filePath: path.join(outputsDir, current), filename: current };
}

// ── Stored verification ────────────────────────────────────────────────────
function readStored(project) {
  if (!project || !project.boq_verification) return null;
  try {
    const v = JSON.parse(project.boq_verification);
    return v && typeof v === 'object' ? v : null;
  } catch (e) { return null; }
}

function store(project, v) {
  try {
    db.prepare('UPDATE projects SET boq_verification = ? WHERE id = ?').run(JSON.stringify(v), project.id);
    project.boq_verification = JSON.stringify(v);
  } catch (e) { console.error('[BoqVerify] could not store verification:', e.message); }
}

// Tell the admin once per (project, file, status) — never on every page open.
async function notifyAdmin(project, v) {
  try {
    const mailer = require('./mailer');
    const owner = db.prepare('SELECT email, full_name, company FROM users WHERE id = ?').get(project.user_id) || {};
    const url = mailer.BASE_URL + '/project/' + project.id;
    await mailer.sendMail({
      platform: true,
      type: 'boq_verification_failed',
      to: ADMIN_EMAIL,
      subject: 'BOQ locked — ' + (project.title || project.id) + ' (' + v.status + ')',
      heading: 'A delivered BOQ failed verification',
      paragraphs: [
        'Project: "' + (project.title || project.id) + '" for ' + (owner.company || owner.full_name || owner.email || 'unknown customer') + '.',
        'File: ' + (v.filename || project.boq_filename) + '.',
        'Result: ' + v.message,
        'The customer\'s Builder Pack and Client Copy are locked until this is fixed — they see "being checked", not figures. '
          + 'Re-upload a corrected bill, or if the parser is at fault get it fixed and re-run verification from the project page.',
      ],
      ctaText: 'Open the project',
      ctaUrl: url,
    });
  } catch (e) {
    console.error('[BoqVerify] admin notification failed:', e.message);
  }
}

/**
 * Verify the project's bill, reusing a stored result for the same file.
 *   opts.force     re-run even when a stored result exists
 *   opts.override  mark the bill as checked by hand (unlocks it)
 *   → verification record { ok, status, message, detail, filename, checked_at, alerted_at? }
 */
async function ensureBoqVerified(project, opts = {}) {
  const boq = await resolveProjectBoq(project);
  if (!boq) return { ok: false, status: 'missing', message: 'No BOQ on this project yet.', detail: {}, filename: null, checked_at: new Date().toISOString() };

  const stored = readStored(project);
  if (opts.override) {
    const v = {
      ...(stored && stored.filename === boq.filename ? stored : {}),
      ok: true, status: 'overridden', filename: boq.filename,
      message: 'Unlocked by ' + (opts.by || 'an admin') + ' after checking by hand.',
      checked_at: new Date().toISOString(),
    };
    store(project, v);
    return v;
  }
  if (!opts.force && stored && stored.filename === boq.filename && stored.status) return stored;

  const result = await verifyBoqFile(boq.filePath);
  const v = { ...result, filename: boq.filename, checked_at: new Date().toISOString() };
  if (!v.ok) {
    const alreadyAlerted = stored && stored.filename === boq.filename && stored.status === v.status && stored.alerted_at;
    if (alreadyAlerted) v.alerted_at = stored.alerted_at;
    else { v.alerted_at = new Date().toISOString(); notifyAdmin(project, v); }
  }
  store(project, v);
  return v;
}

// Route helper: null when the bill may be served, else the 423 body.
async function boqGate(project) {
  const v = await ensureBoqVerified(project);
  if (v.ok) return null;
  return {
    error: 'This BOQ is being checked by our team before the figures are released. '
      + 'You will be able to build the Client Copy as soon as it has been verified.',
    locked: true,
    status: v.status,
    checked_at: v.checked_at,
  };
}

// Every project with a wired bill, verified (stored result reused unless force).
async function auditAll({ force = false } = {}) {
  const projects = db.prepare(
    "SELECT * FROM projects WHERE boq_filename IS NOT NULL AND boq_filename != '' ORDER BY COALESCE(updated_at, created_at) DESC"
  ).all();
  const rows = [];
  for (const p of projects) {
    let v;
    try { v = await ensureBoqVerified(p, { force }); } catch (e) { v = { ok: false, status: 'unreadable', message: e.message, detail: {} }; }
    rows.push({
      project_id: p.id, title: p.title, user_id: p.user_id, boq_filename: p.boq_filename,
      ok: v.ok, status: v.status, message: v.message, detail: v.detail || {}, checked_at: v.checked_at,
    });
  }
  return rows;
}

module.exports = { verifyBoqFile, resolveProjectBoq, ensureBoqVerified, boqGate, auditAll, readStored };
