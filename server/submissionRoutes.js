// ═══════════════════════════════════════════════════════════════════════════════
// DRAWING SUBMISSION ROUTES — server/submissionRoutes.js
//
// Handles the in-portal "Submit Drawings" form for paying clients.
// Mirrors the public theaiqs.co.uk Pipedream flow: forwards files to the file
// receiver and the JSON payload to the main webhook, decrements one free_credit
// per submission, and records the submission row for tracking.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { getBoqBalance, consumeBoqCredit } = require('./boqCredits');
const {
  STAGES, SOURCES, DEFAULT_STAGE, DEFAULT_TURNAROUND_DAYS,
  isValidStage, isValidSource, stageLabel, defaultDueAt,
} = require('./jobStages');
const { logEvent, listEvents, decorate, summarise, daySheet, daySeries, dayKey, OFFICE_TZ } = require('./jobTracker');

const router = express.Router();

// Matches the "Last updated" date on theaiqs.co.uk/terms.html — bump when the
// Terms change so acceptance records say WHICH terms were agreed.
const TERMS_VERSION = '2026-06-18';

const MAIN_WEBHOOK = process.env.PIPEDREAM_MAIN_WEBHOOK || 'https://eopd5lfexwf553m.m.pipedream.net';
const FILE_UPLOAD_URL = process.env.PIPEDREAM_FILE_WEBHOOK || 'https://eoinyvk74gbaqvh.m.pipedream.net';

// Where a customer sends drawings too big for the portal to accept. Mirrored in
// src/pages/SubmitDrawingsPage.js.
const OVERSIZE_EMAIL = process.env.OVERSIZE_UPLOAD_EMAIL || 'hello@theaiqs.com';

const MAX_FILE_MB = 100;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024; // 100 MB per file
const MAX_FILES = 20;

// Buffer uploads to disk rather than RAM. With memory storage a single
// submission could pin MAX_FILES * MAX_FILE_BYTES (≈2 GB) in the heap, and
// concurrent submissions stacked on top of each other — a real risk of the
// Render instance OOMing. Disk storage keeps memory flat; files are streamed
// to Pipedream from disk and cleaned up when the response finishes.
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'submission-uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Sweep temp files left behind by a rejected or interrupted upload (a crash, a
// deploy mid-POST, or — before the cleanup in uploadFiles below — every
// oversized submission). They are pure waste: the durable copies live in
// submission-store. Left unswept they quietly ate the 10 GB Render disk, and a
// full disk makes every subsequent upload fail with an opaque write error.
try {
  const stale = fs.readdirSync(uploadsDir);
  for (const f of stale) {
    try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) {}
  }
  if (stale.length) console.log('[Submissions] Purged ' + stale.length + ' stale temp upload(s)');
} catch (e) { console.error('[Submissions] temp cleanup error:', e.message); }

// Durable local copy of each submission's files, so a submission is never lost
// when the external (Pipedream/Drive) forward fails. The submission row is
// recorded regardless, so it always appears in the admin inbox.
const submissionStoreDir = path.join(DATA_DIR, 'submission-store');

// MOVE rather than copy. The temp dir and the store are both under DATA_DIR, so
// a rename is a metadata operation — instant, and it halves the disk written per
// submission. The previous copyFileSync read and re-wrote every byte
// SYNCHRONOUSLY: on a 300 MB submission that pinned the single Node worker for
// seconds at a time, freezing every other request on the instance (Render runs
// us at WEB_CONCURRENCY=1). Falls back to an async copy if the rename can't be
// done (e.g. the two paths ever land on different mounts).
//
// Mutates file.path to the stored location so the Pipedream forward reads from
// the copy we are keeping, and there is only ever one copy of the bytes.
function uniqueName(name, used) {
  if (!used.has(name)) { used.add(name); return name; }
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = stem + '-' + n + ext;
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
}

async function saveFilesLocally(files, submissionId) {
  const dir = path.join(submissionStoreDir, submissionId);
  await fs.promises.mkdir(dir, { recursive: true });
  // Two uploaded files can sanitise to the same name (two "Drawing.pdf"s from
  // different folders, or "plan 1.pdf" and "plan-1.pdf"). This is now the only
  // copy of the bytes, so a collision would silently lose a drawing — number
  // the duplicates instead.
  const used = new Set();
  for (const f of files) {
    const safe = uniqueName((f.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_'), used);
    const dest = path.join(dir, safe);
    try {
      await fs.promises.rename(f.path, dest);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      await fs.promises.copyFile(f.path, dest);
      fs.unlink(f.path, () => {});
    }
    f.path = dest;
    f.stored = true;
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

// Delete the temp files multer wrote for this request, whatever the outcome.
// Wired to res 'finish' so every return path (validation rejects, credit
// checks, Pipedream errors, success) cleans up without scattering unlink calls.
function cleanupUploads(req) {
  if (!req.files || req.files.length === 0) return;
  for (const f of req.files) {
    // Files moved into the durable store are the submission — leave them.
    if (f && f.path && !f.stored) {
      fs.unlink(f.path, () => {});
    }
  }
}

// Run multer and translate its errors into clean JSON. Without this, a multer
// error (oversized file, too many files) bypasses the route's try/catch and
// falls through to Express's default handler, which returns an opaque 500 —
// exactly what a client uploading a large ZIP would hit.
// How long we will keep draining a rejected upload before giving up and
// replying anyway. See the comment in uploadFiles below.
const DRAIN_TIMEOUT_MS = 60000;

function uploadFiles(req, res, next) {
  upload.array('files', MAX_FILES)(req, res, (err) => {
    if (!err) return next();
    console.error('[Submissions] Upload error:', err.code || 'UNKNOWN', err.message);

    let status = 500;
    let message = 'Upload failed — please try again.';
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        status = 413;
        message = 'That file is too big — the portal accepts up to ' + MAX_FILE_MB + ' MB per file. Please email it to us instead and we will take it from there: ' + OVERSIZE_EMAIL + '.';
      } else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        status = 400;
        message = 'Too many files — please upload at most ' + MAX_FILES + ' files per submission.';
      } else {
        status = 400;
        message = 'Upload failed: ' + err.message;
      }
    }

    // Multer stops reading the body the instant a limit trips, but the browser
    // is still streaming the rest of the request. Replying right there closed
    // the socket under an in-flight POST, so the browser reported a generic
    // network error instead of the message above — and the client then retried
    // the whole upload, which is a large part of the "it just takes ages and
    // then fails" reports. Draining the remainder first (bandwidth we have
    // already paid for) lets the real error land in the UI. Capped, so a
    // client that stops sending can't hold the request open.
    let replied = false;
    const reply = () => {
      if (replied) return;
      replied = true;
      clearTimeout(drainTimer);
      // Multer may have written part of a file before the limit tripped. The
      // route's res 'finish' cleanup never runs on this path, so without this
      // every rejected upload left its partial files on the disk forever.
      cleanupUploads(req);
      if (!res.headersSent) res.status(status).json({ error: message });
    };
    const drainTimer = setTimeout(reply, DRAIN_TIMEOUT_MS);

    if (req.readableEnded || req.complete) return reply();
    req.unpipe();
    req.on('end', reply);
    req.on('close', reply);
    req.on('error', reply);
    req.resume();
  });
}

// How many files to forward to Pipedream at once. Files are buffered in memory
// (up to MAX_FILE_BYTES each), so we cap concurrency to avoid spiking memory and
// outbound bandwidth while still turning a slow N-file serial upload into a few
// parallel batches.
const FORWARD_CONCURRENCY = 4;
// Hard ceiling per file so a single stalled connection to Pipedream can't hang
// the whole request indefinitely. Generous enough for a 100 MB file on a slow
// link; a timeout surfaces as a clean 502 rather than a silent hang.
const FORWARD_TIMEOUT_MS = 120000;

async function forwardFile(file, submissionId) {
  const fd = new FormData();
  // openAsBlob backs the Blob with the file on disk, so fetch streams it out
  // without loading the whole file into memory. Fall back to a buffered read on
  // older Node where openAsBlob isn't available.
  const type = file.mimetype || 'application/octet-stream';
  const blob = fs.openAsBlob
    ? await fs.openAsBlob(file.path, { type })
    : new Blob([fs.readFileSync(file.path)], { type });
  fd.append('file', blob, file.originalname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const resp = await fetch(FILE_UPLOAD_URL, {
      method: 'POST',
      headers: { 'X-Submission-Id': submissionId },
      body: fd,
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error('Pipedream file upload failed: ' + resp.status);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Pipedream file upload timed out after ' + (FORWARD_TIMEOUT_MS / 1000) + 's: ' + file.originalname);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Forward files to Pipedream in parallel, capped at FORWARD_CONCURRENCY in
// flight. Workers pull from a shared cursor so a mix of large and small files
// stays balanced. The first failure rejects (so the route still reports a clean
// error and charges no credit) without leaving later uploads to drag on.
async function forwardFiles(files, submissionId) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < files.length) {
      const file = files[cursor++];
      await forwardFile(file, submissionId);
    }
  };
  const workers = Array.from(
    { length: Math.min(FORWARD_CONCURRENCY, files.length) },
    () => worker()
  );
  await Promise.all(workers);
}

async function postMainWebhook(payload) {
  const resp = await fetch(MAIN_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error('Pipedream main webhook failed: ' + resp.status);
}

// Run the Pipedream forward after the customer has already been told the
// submission is in. Never throws — the worst case is a row left marked
// 'failed: …', which the admin inbox already surfaces, with the files sitting
// safely in the local store.
function forwardInBackgroundTask(files, submissionId, payload, rowId) {
  (async () => {
    let status = 'ok';
    try {
      await forwardFiles(files, submissionId);
      await postMainWebhook(payload);
    } catch (err) {
      console.error('[Submissions] Pipedream forward error (background):', err.message);
      status = 'failed: ' + err.message;
    }
    try {
      db.prepare('UPDATE drawing_submissions SET pipedream_status = ? WHERE id = ?').run(status, rowId);
    } catch (err) {
      console.error('[Submissions] could not record forward status:', err.message);
    }
  })();
}

router.post('/', uploadFiles, async (req, res) => {
  // Clean up the temp upload files once the response is sent, regardless of
  // which branch below returns (validation, credit check, error, or success).
  res.on('finish', () => cleanupUploads(req));
  res.on('close', () => cleanupUploads(req));
  try {
    const user = db.prepare(
      'SELECT id, email, full_name, company, phone, role, free_credits, bonus_docs, monthly_boq_quota, billing_cycle_start FROM users WHERE id = ?'
    ).get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isAdmin = user.role === 'admin';

    // Single spendable balance: free_credits + bonus_docs + monthly allowance left.
    const totalCredits = isAdmin ? Infinity : getBoqBalance(user.id).total;
    if (!isAdmin && totalCredits <= 0) {
      return res.status(403).json({ error: 'No BOQ credits remaining', upgrade_required: true });
    }

    const projectType = (req.body.project_type || '').trim();
    const siteAddress = (req.body.site_address || '').trim();
    const message = (req.body.message || '').trim();
    const files = req.files || [];

    if (!projectType) return res.status(400).json({ error: 'Project type is required' });
    if (!siteAddress) return res.status(400).json({ error: 'Site address is required' });
    if (message.length < 20) return res.status(400).json({ error: 'Please describe your project (min 20 characters)' });
    if (files.length === 0) return res.status(400).json({ error: 'Please upload at least one drawing or document' });
    // Legal gate — enforced here, not just in the UI, and recorded with a
    // timestamp + version below so there's an audit trail of acceptance.
    if (req.body.terms_accepted !== 'true') {
      return res.status(400).json({ error: 'Please tick the box to accept the Terms & Conditions before submitting.' });
    }

    const submissionId = 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    // Keep a durable local copy first so the submission is never lost, even if
    // the external forward below fails. Best-effort.
    let localSaved = false;
    try { await saveFilesLocally(files, submissionId); localSaved = true; }
    catch (e) { console.error('[Submissions] local save failed:', e.message); }

    const payload = {
      name: user.full_name,
      email: user.email,
      phone: user.phone || '',
      company: user.company || '',
      project_type: projectType,
      site_address: siteAddress,
      message,
      submission_id: submissionId,
      file_names: files.map(f => f.originalname),
      file_count: files.length,
      submitted_at: new Date().toISOString(),
      source: 'aiqs-portal/submit-drawings',
      portal_user_id: user.id,
    };

    // Forwarding to Pipedream re-uploads every byte a SECOND time, out to a
    // third party. Blocking the response on it meant the customer's browser sat
    // on the spinner for the upload PLUS the forward — roughly double the wait,
    // and up to FORWARD_TIMEOUT_MS per file when Pipedream was slow. Once the
    // files are in the durable local store the submission is safe and the
    // inbox row is authoritative, so the forward runs in the background and
    // stamps its result on the row when it finishes.
    let pipedreamStatus = 'ok';
    let forwarded = true;
    let forwardInBackground = false;
    if (localSaved) {
      pipedreamStatus = 'pending';
      forwardInBackground = true;
    } else {
      // Nothing on our disk — the forward is the only copy, so it has to
      // succeed before we charge a credit and tell the customer it's in.
      try {
        await forwardFiles(files, submissionId);
        await postMainWebhook(payload);
      } catch (err) {
        console.error('[Submissions] Pipedream forward error:', err.message);
        return res.status(502).json({ error: 'Could not save your submission. Please try again — no credit has been used.' });
      }
    }

    let creditsRemaining = isAdmin ? 999 : Math.max(0, totalCredits - 1);
    if (!isAdmin) {
      // Charge one BOQ credit (monthly allowance → bonus_docs → free_credits).
      // Called BEFORE the drawing_submissions row is inserted below, so the
      // helper measures this cycle's usage without counting this job yet.
      db.prepare('UPDATE users SET total_projects = total_projects + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
      const after = consumeBoqCredit(user.id, { eventAlreadyLogged: false });
      creditsRemaining = Math.max(0, after.total);
      // Confirm the spend to the customer — and the LOW-balance top-up email
      // when they're down to their last couple of credits.
      try {
        require('./creditNotifications').notifyCreditSpent(user, after.total, siteAddress || projectType);
      } catch (e) { console.error('[Submissions] credit notification error:', e.message); }
    }

    // A portal submission arrives the moment it is posted, so received_at is
    // now and the turnaround clock starts here. It lands at the front of the
    // pipeline with nobody assigned — it is real outstanding work until
    // somebody in the office picks it up.
    const rowId = uuidv4();
    const receivedAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO drawing_submissions
        (id, user_id, submission_id, project_type, site_address, message, file_count, file_names, pipedream_status, credits_remaining_after, terms_accepted_at, terms_version,
         stage, source, received_at, due_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'portal', ?, ?)
    `).run(
      rowId,
      user.id,
      submissionId,
      projectType,
      siteAddress,
      message,
      files.length,
      JSON.stringify(files.map(f => f.originalname)),
      pipedreamStatus,
      creditsRemaining,
      receivedAt,
      TERMS_VERSION,
      DEFAULT_STAGE,
      receivedAt,
      defaultDueAt(receivedAt)
    );

    logEvent({
      submission_id: rowId,
      event_type: 'created',
      detail: `Submitted through the portal — ${files.length} file${files.length === 1 ? '' : 's'}`,
      actor: user.email || user.id,
    });

    if (forwardInBackground) {
      forwardInBackgroundTask(files, submissionId, payload, rowId);
    }

    res.json({
      success: true,
      submission_id: submissionId,
      credits_remaining: creditsRemaining,
      forwarded,
    });
  } catch (err) {
    console.error('[Submissions] Error:', err);
    res.status(500).json({ error: 'Submission failed' });
  }
});

router.get('/', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT s.id, s.submission_id, s.project_type, s.site_address, s.file_count, s.file_names,
             s.credits_remaining_after, s.created_at, s.actioned_at, s.project_id,
             s.stage, s.received_at,
             p.status AS project_status, p.title AS project_title
      FROM drawing_submissions s
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.user_id = ?
      ORDER BY s.created_at DESC
      LIMIT 50
    `).all(req.user.id);

    // Collapse the internal stage into the three the customer sees:
    // received (with our QS team) → in_progress (being priced) → delivered.
    // The office's stages are our business; the customer only needs to know
    // whether we have started and whether it has gone out.
    function clientStatus(r) {
      if (r.stage === 'delivered') return 'delivered';
      if (r.project_status === 'delivered' || r.project_status === 'completed') return 'delivered';
      if (r.stage && r.stage !== 'new') return 'in_progress';
      if (r.project_id || r.actioned_at) return 'in_progress';
      return 'received';
    }

    res.json({
      submissions: rows.map(r => ({
        ...r,
        file_names: r.file_names ? JSON.parse(r.file_names) : [],
        status: clientStatus(r),
      })),
    });
  } catch (err) {
    console.error('[Submissions] List error:', err);
    res.status(500).json({ error: 'Failed to list submissions' });
  }
});

// Admin: list every submission across all users
router.get('/admin/all', (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    // Ordered by received_at, not created_at: an email enquiry logged today but
    // received last week belongs at the top of the queue, where it has been
    // waiting, not at the point somebody got round to typing it in.
    const rows = db.prepare(`
      SELECT s.id, s.submission_id, s.project_type, s.site_address, s.message, s.file_count, s.file_names,
             s.pipedream_status, s.credits_remaining_after, s.created_at,
             s.actioned_at, s.actioned_by, s.admin_notes, s.project_id, s.drive_link,
             s.stage, s.owner, s.source, s.received_at, s.due_at,
             u.id AS user_id,
             u.full_name AS user_name, u.email AS user_email,
             u.company AS user_company, u.phone AS user_phone
      FROM drawing_submissions s
      JOIN users u ON u.id = s.user_id
      ORDER BY COALESCE(s.received_at, s.created_at) DESC
      LIMIT 500
    `).all();

    const submissions = rows.map(r => decorate({
      ...r,
      file_names: r.file_names ? JSON.parse(r.file_names) : [],
    }));

    res.json({
      submissions,
      // The stage and source vocabularies travel with the data so the inbox
      // renders from the server's definition rather than keeping a second copy
      // that drifts the first time a stage is renamed.
      stages: STAGES,
      sources: SOURCES,
      turnaround_days: DEFAULT_TURNAROUND_DAYS,
      summary: summarise(rows),
      // Who a job can be handed to: everyone with admin access, plus any owner
      // already recorded on a job (so a hand-over survives that person's
      // account being changed or removed).
      owners: listOwners(),
    });
  } catch (err) {
    console.error('[Submissions] Admin list error:', err);
    res.status(500).json({ error: 'Failed to list submissions' });
  }
});

// Fetch one submission with its customer and tracking figures attached, in the
// shape the inbox expects back from every write.
function loadSubmission(id) {
  const row = db.prepare(`
    SELECT s.*, u.full_name AS user_name, u.email AS user_email,
           u.company AS user_company, u.phone AS user_phone
    FROM drawing_submissions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).get(id);
  if (!row) return null;
  if (row.file_names) {
    try { row.file_names = JSON.parse(row.file_names); } catch (e) { row.file_names = []; }
  }
  return decorate(row);
}

// Everyone a job can be handed to. Admins are the people who can open the
// inbox at all; owners already recorded on jobs are unioned in so a hand-over
// still reads correctly after somebody's account changes.
function listOwners() {
  try {
    const admins = db.prepare(
      "SELECT email, full_name FROM users WHERE role = 'admin' AND email IS NOT NULL"
    ).all();
    const seen = new Map();
    for (const a of admins) seen.set(a.email, a.full_name || a.email);
    const used = db.prepare(
      "SELECT DISTINCT owner FROM drawing_submissions WHERE owner IS NOT NULL AND owner != ''"
    ).all();
    for (const u of used) if (!seen.has(u.owner)) seen.set(u.owner, u.owner);
    return [...seen.entries()]
      .map(([email, name]) => ({ email, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.error('[Submissions] Failed to list owners:', err.message);
    return [];
  }
}

// Admin: update a submission — move its stage, hand it to someone, set a target
// date, edit notes, link it to a project. Every change that matters to "who did
// what, when" is written to the event trail as well as the row, because the row
// only ever holds the latest value.
// GET /api/submissions/admin/day-sheet — what got done, by day and by person.
//
// The queue answers "what is outstanding". This answers "what did we get
// through", which is the other half and the one you cannot reconstruct from a
// list of open jobs: a delivered job leaves the queue and takes its evidence
// with it. Jobs typed in by hand from an email count as work here, because
// they are, and they were invisible in every count before the source column.
//
// ?date=YYYY-MM-DD  the day to report on (office time), default today
// ?days=N           how many days of history to return alongside it (1-90)
router.get('/admin/day-sheet', (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    const today = dayKey(new Date());
    const raw = String(req.query.date || '').trim();
    if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const day = raw || today;
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 14));

    // Pull a window wide enough for the trend, plus a margin either side so a
    // job delivered near midnight is not clipped by the timezone shift.
    const windowStart = new Date(new Date(day + 'T12:00:00Z').getTime() - (days + 1) * 86400000)
      .toISOString().slice(0, 10);
    const windowEnd = new Date(new Date(day + 'T12:00:00Z').getTime() + 86400000)
      .toISOString().slice(0, 10);

    const jobs = db.prepare(`
      SELECT id, source, stage, owner, created_at, received_at, delivered_at, delivered_by
        FROM drawing_submissions
       WHERE date(created_at)   BETWEEN ? AND ?
          OR date(delivered_at) BETWEEN ? AND ?
    `).all(windowStart, windowEnd, windowStart, windowEnd);

    const events = db.prepare(`
      SELECT submission_id, event_type, actor, created_at
        FROM submission_events
       WHERE date(created_at) BETWEEN ? AND ?
    `).all(windowStart, windowEnd);

    // 'created' events can predate the window when a job is delivered inside
    // it, and they are what attributes a hand-logged job to a person.
    const createdEvents = db.prepare(`
      SELECT submission_id, event_type, actor, created_at
        FROM submission_events
       WHERE event_type = 'created'
    `).all();

    const allEvents = events.concat(
      createdEvents.filter(c => !events.some(e => e.submission_id === c.submission_id && e.event_type === 'created'))
    );

    res.json({
      date: day,
      today,
      timezone: OFFICE_TZ,
      sheet: daySheet({ jobs, events: allEvents, day }),
      history: daySeries({ jobs, events: allEvents, endDay: day, days }),
    });
  } catch (err) {
    console.error('[Submissions] Day sheet error:', err);
    res.status(500).json({ error: 'Could not build the day sheet' });
  }
});

router.patch('/admin/:id', (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    const existing = db.prepare('SELECT * FROM drawing_submissions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Submission not found' });

    const actor = req.user.email || req.user.id;
    const updates = [];
    const params = [];
    const events = [];
    const has = (k) => Object.prototype.hasOwnProperty.call(req.body, k);

    // Stage. Moving a job off 'new' is what "somebody has picked this up" means,
    // so actioned_at is kept in step with it rather than being a separate thing
    // to remember to tick — the two could otherwise disagree.
    if (has('stage')) {
      const stage = String(req.body.stage || '').trim();
      if (!isValidStage(stage)) {
        return res.status(400).json({ error: 'Unknown stage: ' + stage });
      }
      if (stage !== existing.stage) {
        updates.push('stage = ?');
        params.push(stage);
        events.push({
          event_type: 'stage',
          detail: `${stageLabel(existing.stage || 'new')} → ${stageLabel(stage)}`,
        });
        if (stage === 'new') {
          updates.push('actioned_at = NULL', 'actioned_by = NULL');
        } else if (!existing.actioned_at) {
          updates.push('actioned_at = CURRENT_TIMESTAMP', 'actioned_by = ?');
          params.push(actor);
        }
        // Stamp the delivery the moment it happens, so the day sheet counts
        // what went out on a given day rather than inferring it from the
        // wording of an event. Moving a job back OUT of delivered clears it —
        // it did not go out after all, and leaving the stamp would keep it in
        // a day's total forever.
        if (stage === 'delivered') {
          updates.push('delivered_at = CURRENT_TIMESTAMP', 'delivered_by = ?');
          params.push(actor);
        } else if (existing.stage === 'delivered') {
          updates.push('delivered_at = NULL', 'delivered_by = NULL');
        }
        // Moving a job forward with nobody on it leaves work that looks busy but
        // has no owner, so whoever moves it takes it unless it is already taken.
        if (stage !== 'new' && !existing.owner) {
          updates.push('owner = ?');
          params.push(actor);
          events.push({ event_type: 'owner', detail: 'Picked up by ' + actor });
        }
      }
    }

    // Legacy tick, still sent by older clients: done means delivered, untick
    // means back to the front of the queue.
    if (has('actioned') && !has('stage')) {
      const stage = req.body.actioned ? 'delivered' : 'new';
      if (stage !== existing.stage) {
        updates.push('stage = ?');
        params.push(stage);
        events.push({
          event_type: 'stage',
          detail: `${stageLabel(existing.stage || 'new')} → ${stageLabel(stage)}`,
        });
      }
      if (req.body.actioned) {
        updates.push('actioned_at = CURRENT_TIMESTAMP', 'actioned_by = ?');
        params.push(actor);
        updates.push('delivered_at = CURRENT_TIMESTAMP', 'delivered_by = ?');
        params.push(actor);
      } else {
        updates.push('actioned_at = NULL', 'actioned_by = NULL');
        updates.push('delivered_at = NULL', 'delivered_by = NULL');
      }
    }

    if (has('owner')) {
      const owner = (req.body.owner || '').trim() || null;
      if (owner !== (existing.owner || null)) {
        updates.push('owner = ?');
        params.push(owner);
        events.push({
          event_type: 'owner',
          detail: owner ? 'Assigned to ' + owner : 'Unassigned',
        });
      }
    }

    if (has('due_at')) {
      const raw = (req.body.due_at || '').trim();
      let dueAt = null;
      if (raw) {
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ error: 'Target date is not a valid date' });
        }
        dueAt = parsed.toISOString();
      }
      if (dueAt !== (existing.due_at || null)) {
        updates.push('due_at = ?');
        params.push(dueAt);
        events.push({
          event_type: 'due',
          detail: dueAt ? 'Target date set to ' + dueAt.slice(0, 10) : 'Target date cleared',
        });
      }
    }

    // When the enquiry actually arrived. Correctable, because a job logged by
    // hand is often typed in days after the email landed and the waiting time
    // every report shows is measured from this.
    if (has('received_at')) {
      const raw = (req.body.received_at || '').trim();
      if (!raw) return res.status(400).json({ error: 'Received date cannot be blank' });
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Received date is not a valid date' });
      }
      const receivedAt = parsed.toISOString();
      if (receivedAt !== (existing.received_at || null)) {
        updates.push('received_at = ?');
        params.push(receivedAt);
        events.push({ event_type: 'received', detail: 'Enquiry arrived ' + receivedAt.slice(0, 10) });
      }
    }

    if (has('source')) {
      const source = String(req.body.source || '').trim();
      if (!isValidSource(source)) {
        return res.status(400).json({ error: 'Unknown source: ' + source });
      }
      if (source !== existing.source) {
        updates.push('source = ?');
        params.push(source);
        events.push({ event_type: 'source', detail: 'Came in via ' + source });
      }
    }

    if (has('admin_notes')) {
      const notes = req.body.admin_notes || null;
      if (notes !== (existing.admin_notes || null)) {
        updates.push('admin_notes = ?');
        params.push(notes);
        events.push({ event_type: 'note', detail: 'Notes updated' });
      }
    }

    if (has('project_id')) {
      updates.push('project_id = ?');
      params.push(req.body.project_id || null);
    }

    if (has('drive_link')) {
      const link = (req.body.drive_link || '').trim();
      // Bare-bones URL sanity check so we don't store junk
      if (link && !/^https?:\/\//i.test(link)) {
        return res.status(400).json({ error: 'Drive link must start with http:// or https://' });
      }
      if (link !== (existing.drive_link || '')) {
        updates.push('drive_link = ?');
        params.push(link || null);
        events.push({ event_type: 'drive', detail: link ? 'Drive folder linked' : 'Drive link removed' });
      }
    }

    if (updates.length === 0) return res.json({ ok: true, unchanged: true });

    params.push(req.params.id);
    db.prepare(`UPDATE drawing_submissions SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    for (const e of events) logEvent({ submission_id: req.params.id, actor, ...e });

    res.json({ ok: true, submission: loadSubmission(req.params.id) });
  } catch (err) {
    console.error('[Submissions] Admin update error:', err);
    res.status(500).json({ error: 'Failed to update submission' });
  }
});

// Admin: add a note straight to the event trail. Distinct from admin_notes,
// which is the current state of play and gets overwritten — these are dated,
// attributed and permanent, so a job can be handed over without losing its
// history.
router.post('/admin/:id/note', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const existing = db.prepare('SELECT id FROM drawing_submissions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Submission not found' });
    const text = ((req.body && req.body.text) || '').trim();
    if (!text) return res.status(400).json({ error: 'Write something first' });
    if (text.length > 2000) return res.status(400).json({ error: 'Note is too long (max 2000 characters)' });
    logEvent({
      submission_id: req.params.id,
      event_type: 'note',
      detail: text,
      actor: req.user.email || req.user.id,
    });
    res.json({ ok: true, events: listEvents(req.params.id) });
  } catch (err) {
    console.error('[Submissions] note error:', err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// Admin: the history of one job — every stage move, hand-over and note, newest
// first.
router.get('/admin/:id/events', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  res.json({ events: listEvents(req.params.id) });
});

// Admin: turn a submission into a project (so deliverables can be uploaded
// against it). Idempotent — if the submission is already linked, returns the
// existing project_id.
router.post('/admin/:id/create-project', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const sub = db.prepare('SELECT * FROM drawing_submissions WHERE id = ? OR submission_id = ?').get(req.params.id, req.params.id);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    // If we're already linked, only reuse that project when its user_id still
    // matches the submission's user. Otherwise the customer can never see the
    // deliverables — the project belongs to someone else's account. This guards
    // against stale links (e.g. project_id pasted in by hand via PATCH, or the
    // original customer's user_id changing). Re-create cleanly in that case.
    if (sub.project_id) {
      const existing = db.prepare('SELECT id, user_id FROM projects WHERE id = ?').get(sub.project_id);
      if (existing && existing.user_id === sub.user_id) {
        return res.json({ ok: true, project_id: sub.project_id, created: false });
      }
      if (existing && existing.user_id !== sub.user_id) {
        console.warn(
          '[Submissions] stale link: submission %s pointed at project %s owned by %s, but submission belongs to %s — re-creating',
          sub.id, existing.id, existing.user_id, sub.user_id
        );
      }
    }

    const { v4: uuidv4 } = require('uuid');
    const projectId = uuidv4();
    // Title priority: explicit title from the admin, then the site address the
    // customer gave us, then type + date as a last resort. Customers know their
    // jobs by site, not by category.
    const siteAddress = (sub.site_address || '').trim();
    const title = (req.body && req.body.title)
      || siteAddress
      || (sub.project_type ? sub.project_type + ' — ' + new Date(sub.created_at).toLocaleDateString('en-GB') : 'Untitled job');
    const description = sub.message || null;

    db.prepare(`
      INSERT INTO projects (id, user_id, title, project_type, description, location, status, source)
      VALUES (?, ?, ?, ?, ?, ?, 'in_progress', 'submission')
    `).run(projectId, sub.user_id, title, sub.project_type || 'Other', description, siteAddress || null);

    db.prepare('UPDATE drawing_submissions SET project_id = ? WHERE id = ?').run(projectId, sub.id);

    logEvent({
      submission_id: sub.id,
      event_type: 'project',
      detail: 'Job created in the customer\'s portal: ' + title,
      actor: req.user.email || req.user.id,
    });

    res.json({ ok: true, project_id: projectId, created: true });
  } catch (err) {
    console.error('[Submissions] create-project error:', err);
    res.status(500).json({ error: 'Failed to create project: ' + err.message });
  }
});

// Admin: create a job (project) manually for a customer, without waiting for
// them to submit drawings. Produces the same submission + project pair the
// "create-project" flow does, so the manual job lands in the inbox with the
// full detail pane — deliverables uploader, notes, Drive link, view-as-customer.
//
// Body: { user_id, project_type, site_address, message, title? }
router.post('/admin/manual-job', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  try {
    const userId = (req.body && req.body.user_id || '').trim();
    if (!userId) return res.status(400).json({ error: 'Pick a customer for this job' });

    const customer = db.prepare("SELECT id, full_name, email FROM users WHERE id = ? AND role != 'system'").get(userId);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const projectType = (req.body.project_type || '').trim() || 'Other';
    const siteAddress = (req.body.site_address || '').trim();
    const message = (req.body.message || '').trim();
    const title = (req.body.title || '').trim()
      || siteAddress
      || (projectType + ' — ' + new Date().toLocaleDateString('en-GB'));

    // How it reached us. A job typed in by hand is nearly always an email or
    // phone enquiry, so 'email' is the default rather than 'manual'.
    const source = isValidSource(req.body.source) ? req.body.source : 'email';

    // When the ENQUIRY arrived — not when it was typed in. Without this every
    // email job reports a waiting time starting the moment somebody got round
    // to logging it, which is exactly the figure that hides a backlog.
    let receivedAt = new Date().toISOString();
    if (req.body.received_at) {
      const parsed = new Date(req.body.received_at);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Received date is not a valid date' });
      }
      receivedAt = parsed.toISOString();
    }

    // An email job is real outstanding work, so it starts at the front of the
    // pipeline like any other. It used to be written straight to "actioned",
    // which meant it never appeared in anybody's queue.
    const stage = isValidStage(req.body.stage) ? req.body.stage : DEFAULT_STAGE;

    let dueAt = defaultDueAt(receivedAt);
    if (req.body.due_at) {
      const parsed = new Date(req.body.due_at);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Target date is not a valid date' });
      }
      dueAt = parsed.toISOString();
    }

    const owner = (req.body.owner || '').trim() || (req.user.email || req.user.id);

    const projectId = uuidv4();
    db.prepare(`
      INSERT INTO projects (id, user_id, title, project_type, description, location, status, source)
      VALUES (?, ?, ?, ?, ?, ?, 'in_progress', 'manual')
    `).run(projectId, customer.id, title, projectType, message || null, siteAddress || null);

    // Mirror it as a submission row so the inbox shows it like any other job.
    // pipedream_status 'manual' marks it so it isn't counted against the
    // customer's BOQ allowance (admin added it as a courtesy, no credit spent).
    const submissionId = 'man_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const rowId = uuidv4();
    db.prepare(`
      INSERT INTO drawing_submissions
        (id, user_id, submission_id, project_type, site_address, message, file_count, file_names,
         pipedream_status, project_id, stage, owner, source, received_at, due_at, actioned_at, actioned_by)
      VALUES (?, ?, ?, ?, ?, ?, 0, '[]', 'manual', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(rowId, customer.id, submissionId, projectType, siteAddress || null, message || null,
           projectId, stage, owner, source, receivedAt, dueAt,
           stage === 'new' ? null : new Date().toISOString(),
           stage === 'new' ? null : (req.user.email || req.user.id));

    logEvent({
      submission_id: rowId,
      event_type: 'created',
      detail: `Logged by hand — ${source} enquiry received ${receivedAt.slice(0, 10)}`,
      actor: req.user.email || req.user.id,
    });

    res.json({ ok: true, project_id: projectId, submission: loadSubmission(rowId) });
  } catch (err) {
    console.error('[Submissions] manual-job error:', err);
    res.status(500).json({ error: 'Failed to create job: ' + err.message });
  }
});

// Inbound webhook: Pipedream calls this once it has finished uploading the
// customer's drawings to Drive, posting the folder URL back so the inbox
// auto-fills the "Open in Drive" link without any manual pasting.
//
// Configure the Pipedream HTTP step like this:
//   POST  https://<your-portal>/api/submissions/webhook/drive-link
//   Body: { "submission_id": "<the sub id>", "drive_link": "<folder URL>", "secret": "<shared secret>" }
//
// The secret must match DRIVE_LINK_WEBHOOK_SECRET in the portal's env.
// This route does NOT use authMiddleware (it's mounted from index.js with
// auth) — see the override at the bottom of this file.
function driveLinkWebhookHandler(req, res) {
  try {
    const expected = process.env.DRIVE_LINK_WEBHOOK_SECRET;
    if (!expected) {
      console.error('[Drive webhook] DRIVE_LINK_WEBHOOK_SECRET is not set — refusing.');
      return res.status(503).json({ error: 'Drive webhook not configured' });
    }
    const got = (req.body && req.body.secret) || req.get('x-aiqs-webhook-secret');
    if (!got || got !== expected) {
      return res.status(401).json({ error: 'Bad secret' });
    }
    const submissionId = (req.body && req.body.submission_id) || '';
    const driveLink = ((req.body && req.body.drive_link) || '').trim();
    if (!submissionId) return res.status(400).json({ error: 'submission_id is required' });
    if (!driveLink || !/^https?:\/\//i.test(driveLink)) {
      return res.status(400).json({ error: 'drive_link must be a http(s) URL' });
    }
    const result = db.prepare(
      'UPDATE drawing_submissions SET drive_link = ? WHERE submission_id = ? OR id = ?'
    ).run(driveLink, submissionId, submissionId);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'No matching submission for ' + submissionId });
    }
    const row = db.prepare(
      'SELECT id FROM drawing_submissions WHERE submission_id = ? OR id = ?'
    ).get(submissionId, submissionId);
    if (row) {
      logEvent({
        submission_id: row.id,
        event_type: 'drive',
        detail: 'Drive folder linked automatically after upload',
        actor: 'pipedream',
      });
    }
    res.json({ ok: true, updated: result.changes });
  } catch (err) {
    console.error('[Drive webhook] error:', err);
    res.status(500).json({ error: 'Webhook failed' });
  }
}

module.exports = router;
module.exports.driveLinkWebhookHandler = driveLinkWebhookHandler;
