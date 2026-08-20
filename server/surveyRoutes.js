// surveyRoutes.js — in-portal feedback surveys.
//
// One row per (user, survey_key). The popup asks three things: star rating,
// ease-of-navigation score out of 10, and a feature wish. Submitting completes
// the survey permanently; "not now" is only snoozed client-side so a gentle
// re-ask happens next session. Admins read the results aggregated.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware } = require('./auth');
const { recommendTier, FEATURES, TEAM_SIZES, JOBS_BANDS, TIERS } = require('./suitability');

const router = express.Router();

const ATP_REGISTER_URL = process.env.ATP_REGISTER_URL || 'https://app.aitradespilot.com/register';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'hello@crmwizardai.com';

let schemaReady = false;
function ensureSchema() {
  if (schemaReady) return;
  db.exec(`CREATE TABLE IF NOT EXISTS user_surveys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    survey_key TEXT NOT NULL,
    stars INTEGER,
    nav_score INTEGER,
    feature_request TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, survey_key)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS suitability_surveys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    survey_key TEXT NOT NULL,
    features TEXT NOT NULL,
    team_size TEXT,
    jobs_per_month TEXT,
    recommended_tier TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, survey_key)
  )`);
  schemaReady = true;
}

// GET /api/survey/status?key=portal_2026_06 — has this user already answered?
router.get('/survey/status', authMiddleware, (req, res) => {
  try {
    ensureSchema();
    const key = String(req.query.key || '').slice(0, 64);
    if (!key) return res.status(400).json({ error: 'key required' });
    const row = db.prepare('SELECT id FROM user_surveys WHERE user_id = ? AND survey_key = ?').get(req.user.id, key);
    res.json({ completed: !!row });
  } catch (e) {
    console.error('[Survey] status error:', e.message);
    res.status(500).json({ error: 'Failed to check survey status' });
  }
});

// POST /api/survey — { survey_key, stars (1-5), nav_score (1-10), feature_request }
router.post('/survey', authMiddleware, (req, res) => {
  try {
    ensureSchema();
    const b = req.body || {};
    const key = String(b.survey_key || '').slice(0, 64);
    if (!key) return res.status(400).json({ error: 'survey_key required' });
    const stars = parseInt(b.stars, 10);
    if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'A star rating (1-5) is required.' });
    const navRaw = parseInt(b.nav_score, 10);
    const navScore = navRaw >= 1 && navRaw <= 10 ? navRaw : null;
    const feature = String(b.feature_request || '').trim().slice(0, 2000) || null;

    db.prepare(`
      INSERT INTO user_surveys (id, user_id, survey_key, stars, nav_score, feature_request)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, survey_key) DO UPDATE SET
        stars = excluded.stars, nav_score = excluded.nav_score, feature_request = excluded.feature_request
    `).run(uuidv4(), req.user.id, key, stars, navScore, feature);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Survey] submit error:', e.message);
    res.status(500).json({ error: 'Failed to save survey' });
  }
});

// GET /api/admin/surveys?key=... — responses + averages (all keys if none given)
router.get('/admin/surveys', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    ensureSchema();
    const key = String(req.query.key || '').slice(0, 64) || null;
    const where = key ? 'WHERE s.survey_key = ?' : '';
    const params = key ? [key] : [];
    const rows = db.prepare(`
      SELECT s.*, u.full_name, u.email, u.company
      FROM user_surveys s JOIN users u ON u.id = s.user_id
      ${where}
      ORDER BY s.created_at DESC
      LIMIT 500
    `).all(...params);
    const summary = db.prepare(`
      SELECT s.survey_key, COUNT(*) AS responses,
             ROUND(AVG(s.stars), 2) AS avg_stars,
             ROUND(AVG(s.nav_score), 2) AS avg_nav_score,
             SUM(CASE WHEN s.feature_request IS NOT NULL THEN 1 ELSE 0 END) AS feature_requests
      FROM user_surveys s ${where ? where.replace('s.survey_key', 's.survey_key') : ''}
      GROUP BY s.survey_key
      ORDER BY MAX(s.created_at) DESC
    `).all(...params);
    res.json({ responses: rows, summary });
  } catch (e) {
    console.error('[Survey] admin list error:', e.message);
    res.status(500).json({ error: 'Failed to load survey results' });
  }
});

// ═══ Suitability survey — qualifying questions → tailored AI Trades Pilot ═══
// package + free-trial invite. Answer once per survey_key; the recommendation
// is computed server-side (suitability.js) so admin sees exactly what each
// user was offered.

// GET /api/survey/suitability/status?key=... — has this user already answered?
router.get('/survey/suitability/status', authMiddleware, (req, res) => {
  try {
    ensureSchema();
    const key = String(req.query.key || '').slice(0, 64);
    if (!key) return res.status(400).json({ error: 'key required' });
    const row = db.prepare('SELECT id FROM suitability_surveys WHERE user_id = ? AND survey_key = ?').get(req.user.id, key);
    res.json({ completed: !!row });
  } catch (e) {
    console.error('[Suitability] status error:', e.message);
    res.status(500).json({ error: 'Failed to check survey status' });
  }
});

// POST /api/survey/suitability
//   { survey_key, features: [ids], team_size, jobs_per_month }
// Stores the answers, returns the tailored package, and (best-effort) emails
// the user their free-trial invite so the offer survives the popup closing.
router.post('/survey/suitability', authMiddleware, (req, res) => {
  try {
    ensureSchema();
    const b = req.body || {};
    const key = String(b.survey_key || '').slice(0, 64);
    if (!key) return res.status(400).json({ error: 'survey_key required' });

    const features = Array.isArray(b.features) ? b.features.filter((f) => FEATURES[f]).slice(0, 32) : [];
    if (!features.length) return res.status(400).json({ error: 'Pick at least one feature.' });
    const teamSize = TEAM_SIZES[b.team_size] ? b.team_size : null;
    const jobsPerMonth = JOBS_BANDS[b.jobs_per_month] ? b.jobs_per_month : null;
    if (!teamSize || !jobsPerMonth) return res.status(400).json({ error: 'Tell us your team size and how often you price work.' });

    const rec = recommendTier({ features, teamSize, jobsPerMonth });

    db.prepare(`
      INSERT INTO suitability_surveys (id, user_id, survey_key, features, team_size, jobs_per_month, recommended_tier)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, survey_key) DO UPDATE SET
        features = excluded.features, team_size = excluded.team_size,
        jobs_per_month = excluded.jobs_per_month, recommended_tier = excluded.recommended_tier
    `).run(uuidv4(), req.user.id, key, JSON.stringify(features), teamSize, jobsPerMonth, rec.tier);

    sendTrialInvite(req.user.id, rec).catch((e) => console.warn('[Suitability] invite email failed:', e.message));
    sendAdminSuitabilityAlert(req.user.id, rec, { features, teamSize, jobsPerMonth })
      .catch((e) => console.warn('[Suitability] admin alert failed:', e.message));

    res.json({ ok: true, recommendation: rec, trialUrl: trialUrl(rec.tier) });
  } catch (e) {
    console.error('[Suitability] submit error:', e.message);
    res.status(500).json({ error: 'Failed to save survey' });
  }
});

// GET /api/admin/suitability — responses + demand counts for the admin panel.
router.get('/admin/suitability', authMiddleware, (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    ensureSchema();
    const rows = db.prepare(`
      SELECT s.*, u.full_name, u.email, u.company
      FROM suitability_surveys s JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC
      LIMIT 500
    `).all();
    const featureCounts = {};
    const tierCounts = {};
    const responses = rows.map((r) => {
      let features = [];
      try { features = JSON.parse(r.features) || []; } catch (e) {}
      features.forEach((f) => { featureCounts[f] = (featureCounts[f] || 0) + 1; });
      tierCounts[r.recommended_tier] = (tierCounts[r.recommended_tier] || 0) + 1;
      return { ...r, features };
    });
    res.json({ responses, featureCounts, tierCounts });
  } catch (e) {
    console.error('[Suitability] admin list error:', e.message);
    res.status(500).json({ error: 'Failed to load suitability results' });
  }
});

function trialUrl(tier) {
  return ATP_REGISTER_URL + '?plan=' + encodeURIComponent(tier) + '&src=aiqs-survey';
}

// The emailed version of the popup's result card. Best-effort: SMTP not
// configured or a send failure never breaks the survey submission.
async function sendTrialInvite(userId, rec) {
  const { sendEmail } = require('./routes'); // lazy — avoids any load-order tangle
  const user = db.prepare('SELECT full_name, email FROM users WHERE id = ?').get(userId);
  if (!user || !user.email || typeof sendEmail !== 'function') return;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const firstName = (user.full_name || '').trim().split(/\s+/)[0] || 'there';
  const url = trialUrl(rec.tier);
  const coveredList = rec.covered.map((f) => '<li style="margin:0 0 6px;">' + esc(FEATURES[f].label) + '</li>').join('');
  const addonNote = rec.addons.length
    ? '<p style="margin:0 0 14px;font-size:14px;color:#334155;">Plus the ' + esc(rec.addons.map((f) => FEATURES[f].label).join(', ')) + ' — available as an optional add-on on any plan.</p>'
    : '';

  await sendEmail({
    to: user.email,
    subject: 'Your tailored AI Trades Pilot package — 14-day free trial',
    html: ''
      + '<div style="background:#F1F5F9;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">'
      +   '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0;">'
      +     '<div style="background:#1B2A4A;padding:18px 24px;color:#ffffff;font-size:18px;font-weight:700;">AI QS</div>'
      +     '<div style="padding:26px 24px 22px;">'
      +       '<h2 style="margin:0 0 14px;font-size:19px;color:#0F172A;">' + esc(firstName) + ', here\'s the package we\'d build for you</h2>'
      +       '<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#334155;">Based on what you told us in the portal, the <strong>' + esc(TIERS[rec.tier].label) + '</strong> plan on AI Trades Pilot fits your business best — <strong>&pound;' + rec.monthly + '/month</strong>, with a 14-day free trial.</p>'
      +       (coveredList ? '<p style="margin:0 0 6px;font-size:14px;color:#0F172A;font-weight:700;">It covers what you asked for:</p><ul style="margin:0 0 14px;padding-left:20px;font-size:14px;color:#334155;">' + coveredList + '</ul>' : '')
      +       addonNote
      +       '<div style="text-align:center;margin:24px 0 8px;">'
      +         '<a href="' + esc(url) + '" style="display:inline-block;padding:14px 32px;background:#0071F3;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;border-radius:10px;">Start my free trial</a>'
      +       '</div>'
      +       '<p style="margin:10px 0 0;font-size:12px;color:#94A3B8;text-align:center;word-break:break-all;">Or copy this link: ' + esc(url) + '</p>'
      +     '</div>'
      +     '<div style="padding:14px 24px;border-top:1px solid #E2E8F0;font-size:12px;color:#94A3B8;text-align:center;">Card at signup, first charge after the trial — cancel anytime on monthly.</div>'
      +   '</div>'
      + '</div>',
  });
}

// Tells the admin who just completed the suitability survey: their contact
// details, what they picked, and the package they were offered — so trial
// follow-ups can happen while the lead is warm. Also drops an admin bell
// notification. Best-effort, same as the invite: never breaks the submission.
async function sendAdminSuitabilityAlert(userId, rec, { features, teamSize, jobsPerMonth }) {
  const { sendEmail, notifyAdmin } = require('./routes'); // lazy — avoids any load-order tangle
  const user = db.prepare('SELECT full_name, email, company FROM users WHERE id = ?').get(userId);
  if (!user) return;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tier = TIERS[rec.tier];
  const packageLine = `${tier.label} — £${rec.monthly}/month`;

  if (typeof notifyAdmin === 'function') {
    notifyAdmin({
      type: 'suitability_survey',
      title: `Survey completed: ${user.full_name || user.email}`,
      detail: `${user.email} — offered ${packageLine}`,
      icon: 'clipboard-check',
    });
  }

  if (!user.email || typeof sendEmail !== 'function') return;

  const row = (label, value) =>
    `<tr><td style="padding:6px 12px;color:#94A3B8;font-size:13px;vertical-align:top;">${label}</td><td style="padding:6px 12px;font-size:14px;font-weight:600;color:#F1F5F9;">${value}</td></tr>`;
  // Add-on features (the work phone) aren't part of any package — flag them
  // so the admin doesn't read them as included in the offered price.
  const featureList = features
    .map((f) => esc(FEATURES[f].label)
      + (FEATURES[f].addon ? ' <span style="color:#94A3B8;font-weight:500;font-size:12px;">(add-on — extra over, not in the package price)</span>' : ''))
    .join('<br/>');

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `📋 Suitability survey completed: ${user.full_name || user.email}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0F172A;border-radius:16px;">
        <div style="text-align:center;margin-bottom:28px;">
          <div style="font-size:28px;font-weight:800;color:#F1F5F9;">AI <span style="color:#F59E0B;">QS</span></div>
          <div style="font-size:10px;letter-spacing:3px;color:#64748B;text-transform:uppercase;margin-top:2px;">Suitability Survey — New Response</div>
        </div>
        <div style="background:#1E293B;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:20px;">
          <div style="font-size:16px;font-weight:700;color:#F59E0B;margin-bottom:16px;">📋 Someone just filled out the survey</div>
          <table style="width:100%;border-collapse:collapse;">
            ${row('Name', esc(user.full_name || '—'))}
            ${row('Email', `<a href="mailto:${esc(user.email)}" style="color:#38BDF8;text-decoration:none;">${esc(user.email)}</a>`)}
            ${user.company ? row('Company', esc(user.company)) : ''}
            ${row('Offered', `<span style="color:#10B981;">${esc(packageLine)}</span>`)}
            ${row('Features wanted', featureList || '—')}
            ${row('Team size', esc(TEAM_SIZES[teamSize] ? TEAM_SIZES[teamSize].label : teamSize || '—'))}
            ${row('Prices work', esc(JOBS_BANDS[jobsPerMonth] ? JOBS_BANDS[jobsPerMonth].label : jobsPerMonth || '—'))}
            ${row('Time', new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}
          </table>
        </div>
        <div style="text-align:center;">
          <a href="mailto:${esc(user.email)}" style="display:inline-block;padding:12px 28px;background:#F59E0B;color:#0F172A;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">Follow up with ${esc((user.full_name || '').split(' ')[0] || 'them')}</a>
        </div>
        <p style="font-size:11px;color:#475569;text-align:center;margin-top:24px;">They've been emailed their tailored package and free-trial link. Full results are in the Admin Dashboard feedback tab.</p>
      </div>
    `,
  });
}

module.exports = router;
