// Onboarding trade profiles — server/onboardingProfile.js
//
// The onboarding flow asks the client their trade (live search), a handful of
// qualifying questions for that trade, and anything they want to add. The
// whole submission is kept verbatim here — not just exploded into memories —
// so the moment someone finishes, the admin gets a bell + email and can pull
// the full profile down as a spreadsheet (with their logo alongside, via the
// existing /branding/logo/:userId route).

const { v4: uuidv4 } = require('uuid');
const { getQuestionsForTrade } = require('./tradeCatalog');

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS onboarding_submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      trade TEXT,
      qualifying TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_onboarding_submissions_user ON onboarding_submissions(user_id);
  `);
}

// Persist one completed run. Re-running onboarding adds a new row — the
// history of what they told us is worth more than saving a few bytes, and
// the admin list shows the latest per user first.
function saveSubmission(db, { userId, trade, qualifying, notes }) {
  if (!userId) return null;
  ensureTable(db);
  const id = 'ob_' + uuidv4().slice(0, 8);
  const tradeStr = String(trade || '').trim().slice(0, 80) || null;
  const notesStr = String(notes || '').trim().slice(0, 4000) || null;
  const qual = qualifying && typeof qualifying === 'object' && !Array.isArray(qualifying) ? qualifying : {};
  db.prepare('INSERT INTO onboarding_submissions (id, user_id, trade, qualifying, notes) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, tradeStr, JSON.stringify(qual), notesStr);
  return db.prepare('SELECT * FROM onboarding_submissions WHERE id = ?').get(id);
}

// Latest submission per user, newest first, with who they are and whether a
// logo exists to download. Powers the admin Onboarding tab.
function listSubmissions(db) {
  ensureTable(db);
  return db.prepare(`
    SELECT s.*, u.full_name, u.email, u.company,
           CASE WHEN b.logo_filename IS NOT NULL THEN 1 ELSE 0 END AS has_logo
    FROM onboarding_submissions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN user_branding b ON b.user_id = s.user_id
    ORDER BY s.created_at DESC
  `).all();
}

function getSubmission(db, id) {
  ensureTable(db);
  return db.prepare(`
    SELECT s.*, u.full_name, u.email, u.company, b.logo_filename
    FROM onboarding_submissions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN user_branding b ON b.user_id = s.user_id
    WHERE s.id = ?
  `).get(id);
}

// Answers as [label, value] pairs in the order the questions were asked, so
// the admin sheet reads like the screen did. Unknown ids (questions we've
// since removed) still come out, labelled by their id.
function answerRows(submission) {
  let qual = {};
  try { qual = JSON.parse(submission.qualifying || '{}') || {}; } catch (e) {}
  const questions = getQuestionsForTrade(submission.trade);
  const rows = [];
  const seen = new Set();
  for (const q of questions) {
    if (!(q.id in qual)) continue;
    seen.add(q.id);
    const v = qual[q.id];
    const val = Array.isArray(v) ? v.join(', ') : String(v);
    if (val !== '') rows.push([q.label + (q.unit ? ' (' + q.unit + ')' : ''), val]);
  }
  for (const [id, v] of Object.entries(qual)) {
    if (seen.has(id)) continue;
    const val = Array.isArray(v) ? v.join(', ') : String(v);
    if (val !== '') rows.push([id, val]);
  }
  return rows;
}

// One-sheet Excel of the profile, logo embedded top-right when there is one.
async function buildWorkbook(submission, logoPath) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Onboarding profile');
  ws.columns = [{ width: 34 }, { width: 60 }];

  if (logoPath) {
    try {
      const fs = require('fs');
      if (fs.existsSync(logoPath)) {
        const img = wb.addImage({ filename: logoPath, extension: 'png' });
        ws.addImage(img, { tl: { col: 1.6, row: 0.2 }, ext: { width: 140, height: 70 } });
      }
    } catch (e) { /* a bad logo must never block the download */ }
  }

  const title = ws.getCell('A1');
  title.value = 'Onboarding profile — ' + (submission.full_name || submission.email);
  title.font = { bold: true, size: 14 };
  ws.getCell('A2').value = 'Submitted ' + String(submission.created_at || '');
  ws.getCell('A2').font = { color: { argb: 'FF777777' }, size: 10 };

  let r = 4;
  const put = (label, value) => {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = value;
    ws.getCell(r, 2).alignment = { wrapText: true, vertical: 'top' };
    r++;
  };
  put('Name', submission.full_name || '—');
  put('Email', submission.email || '—');
  put('Company', submission.company || '—');
  put('Trade', submission.trade || '—');
  r++;
  for (const [label, value] of answerRows(submission)) put(label, value);
  if (submission.notes) { r++; put('Anything else', submission.notes); }

  return wb;
}

// Bell + email the admin the moment a profile lands. Fire-and-forget: an
// alert failure must never fail the client's onboarding save.
function alertAdmin(db, user, submission) {
  try {
    const mailer = require('./mailer');
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hello@crmwizardai.com';
    const who = (user && (user.full_name || user.email)) || submission.full_name || submission.email || 'A client';
    const tradeLabel = submission.trade ? ' — ' + submission.trade : '';

    try {
      db.prepare('INSERT INTO notifications (id, type, title, detail, icon) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), 'onboarding_profile', who + ' completed onboarding' + tradeLabel,
          'Profile ready to download from Admin → Onboarding', 'clipboard');
    } catch (e) {
      console.error('[OnboardingProfile] notification insert failed:', e.message);
    }

    const lines = answerRows(submission).map(([label, value]) => label + ': ' + value);
    mailer.sendMail({
      type: 'onboarding_profile_admin',
      to: ADMIN_EMAIL,
      subject: 'Onboarding completed — ' + who + tradeLabel,
      heading: 'A client just completed onboarding',
      paragraphs: [
        who + (submission.company ? ' (' + submission.company + ')' : '') + ' — ' + (submission.email || '') + ' — just finished onboarding' + tradeLabel + '.',
        lines.length ? lines.join(' · ') : 'No qualifying answers given.',
        submission.notes ? 'They added: "' + submission.notes + '"' : 'No extra notes.',
        'Download the full profile (and their logo) from the Onboarding tab in admin.',
      ],
      ctaText: 'Open admin',
      ctaUrl: mailer.BASE_URL + '/admin',
    }).catch(() => {});
  } catch (err) {
    console.error('[OnboardingProfile] alertAdmin failed:', err.message);
  }
}

module.exports = { ensureTable, saveSubmission, listSubmissions, getSubmission, answerRows, buildWorkbook, alertAdmin };
