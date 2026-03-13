const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { generateToken, authMiddleware, adminMiddleware } = require('./auth');
const { logActivity } = require('./activityRoutes');
const { startPipelineRun } = require('./pipelineRoutes');

const router = express.Router();

const ADMIN_EMAIL = 'hello@crmwizardai.com';
const PIPEDREAM_WEBHOOK = process.env.PIPEDREAM_WEBHOOK_URL || 'https://eojsrx5dgazyle8.m.pipedream.net';
const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL || 'https://aiqs-portal.onrender.com';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = `${PORTAL_BASE_URL}/api/auth/google/callback`;

const PLANS = {
  starter:      { label: 'Starter (PAYG)', quota: 0,  boqQuota: 0,  price: 99  },
  professional: { label: 'Professional',   quota: 10, boqQuota: 10, price: 347 },
  premium:      { label: 'Premium',        quota: 20, boqQuota: 20, price: 447 },
  custom:       { label: 'Custom',         quota: 0,  boqQuota: 0,  price: 0   },
};

// Ensure new columns exist (safe to run on every start)
try { db.exec('ALTER TABLE users ADD COLUMN monthly_boq_quota INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN bonus_messages INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN bonus_docs INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN suspended INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN suspended_reason TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN force_password_change INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN google_id TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch(e) {}

// ── SMTP Email Setup (Google Workspace) ──────────────────────────────────────
const smtpTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_EMAIL || 'hello@crmwizardai.com',
    pass: process.env.SMTP_PASSWORD || '',
  },
});

async function sendEmail({ to, subject, html }) {
  if (!process.env.SMTP_PASSWORD) {
    console.log(`[Email] SMTP_PASSWORD not set, skipping email to ${to}`);
    return false;
  }
  try {
    await smtpTransporter.sendMail({
      from: `"AI QS" <${process.env.SMTP_EMAIL || 'hello@crmwizardai.com'}>`,
      to, subject, html,
    });
    console.log(`[Email] Sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[Email] Failed to send to ${to}:`, err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      icon TEXT DEFAULT 'user',
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('[Notifications] Table ready');
} catch (err) {
  console.error('[Notifications] Failed to create table:', err.message);
}

async function notifyAdmin({ type, title, detail, icon }) {
  try {
    const id = uuidv4();
    db.prepare('INSERT INTO notifications (id, type, title, detail, icon) VALUES (?, ?, ?, ?, ?)').run(id, type, title, detail || null, icon || 'user');
    console.log(`[Notification] Created: ${title}`);
  } catch (err) {
    console.error('[Notification] Failed to create:', err.message);
  }
}

async function sendAdminSignupEmail({ fullName, email, company, phone }) {
  const companyLine = company ? `<tr><td style="padding:6px 12px;color:#94A3B8;font-size:13px;">Company</td><td style="padding:6px 12px;font-size:14px;font-weight:600;color:#F1F5F9;">${company}</td></tr>` : '';
  const phoneLine = phone ? `<tr><td style="padding:6px 12px;color:#94A3B8;font-size:13px;">Phone</td><td style="padding:6px 12px;font-size:14px;font-weight:600;color:#F1F5F9;">${phone}</td></tr>` : '';
  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `🆕 New Signup: ${fullName}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0F172A;border-radius:16px;">
        <div style="text-align:center;margin-bottom:28px;">
          <div style="font-size:28px;font-weight:800;color:#F1F5F9;">AI <span style="color:#F59E0B;">QS</span></div>
          <div style="font-size:10px;letter-spacing:3px;color:#64748B;text-transform:uppercase;margin-top:2px;">New Account Alert</div>
        </div>
        <div style="background:#1E293B;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:20px;">
          <div style="font-size:16px;font-weight:700;color:#F59E0B;margin-bottom:16px;">📬 Someone just signed up</div>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:6px 12px;color:#94A3B8;font-size:13px;">Name</td><td style="padding:6px 12px;font-size:14px;font-weight:600;color:#F1F5F9;">${fullName}</td></tr>
            <tr><td style="padding:6px 12px;color:#94A3B8;font-size:13px;">Email</td><td style="padding:6px 12px;font-size:14px;font-weight:600;color:#F1F5F9;"><a href="mailto:${email}" style="color:#38BDF8;text-decoration:none;">${email}</a></td></tr>
            ${companyLine}${phoneLine}
            <tr><td style="padding:6px 12px;color:#94A3B8;font-size:13px;">Plan</td><td style="padding:6px 12px;font-size:14px;font-weight:600;color:#10B981;">Free Trial (2 projects)</td></tr>
            <tr><td style="padding:6px 12px;color:#94A3B8;font-size:13px;">Time</td><td style="padding:6px 12px;font-size:14px;color:#F1F5F9;">${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>
          </table>
        </div>
        <div style="text-align:center;">
          <a href="https://aiqs-portal.onrender.com/admin" style="display:inline-block;padding:12px 28px;background:#F59E0B;color:#0F172A;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">View in Admin Panel</a>
        </div>
        <p style="font-size:11px;color:#475569;text-align:center;margin-top:24px;">AI QS Portal — Automated Quantity Surveying</p>
      </div>
    `,
  });
}

async function sendClientWelcomeEmail({ fullName, email }) {
  const firstName = (fullName || 'there').split(' ')[0];
  const portalUrl = process.env.PORTAL_URL || 'https://aiqs-portal.onrender.com';
  await sendEmail({
    to: email,
    subject: `Welcome to AI QS — Let's get your first BOQ`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
        <div style="text-align:center;margin-bottom:32px;">
          <div style="font-size:28px;font-weight:800;color:#0F172A;">AI <span style="color:#F59E0B;">QS</span></div>
          <div style="font-size:10px;letter-spacing:3px;color:#94A3B8;text-transform:uppercase;margin-top:2px;">Quantity Surveying</div>
        </div>
        <h2 style="font-size:20px;color:#0F172A;margin:0 0 12px;">Welcome, ${firstName}!</h2>
        <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 20px;">Your AI QS account is ready. Here's what you can do:</p>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:18px;margin:0 0 24px;">
          <p style="margin:0 0 6px;font-size:14px;color:#1E293B;"><strong>💬 Chat with AI</strong> — upload drawings and get instant cost estimates</p>
          <p style="margin:0 0 6px;font-size:14px;color:#1E293B;"><strong>📥 Download BOQs</strong> — professional Excel &amp; Word documents</p>
          <p style="margin:0 0 6px;font-size:14px;color:#1E293B;"><strong>📋 Raise Variations</strong> — manage change orders from the project page</p>
          <p style="margin:0 0 6px;font-size:14px;color:#1E293B;"><strong>💰 My Rates</strong> — customise your pricing library</p>
          <p style="margin:0;font-size:14px;color:#1E293B;"><strong>📊 Track Usage</strong> — monitor message &amp; BOQ credits on the dashboard</p>
        </div>
        <div style="text-align:center;margin:28px 0;">
          <a href="${portalUrl}/chat" style="display:inline-block;padding:14px 36px;background:#F59E0B;color:#0F172A;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">Start Your First Project</a>
        </div>
        <p style="font-size:13px;color:#94A3B8;line-height:1.5;">You're on the free trial with 2 project credits. Need more? Upgrade anytime from your dashboard.</p>
        <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 16px;" />
        <p style="font-size:11px;color:#CBD5E1;text-align:center;">AI QS — Automated Quantity Surveying<br/><a href="https://theaiqs.co.uk" style="color:#94A3B8;">theaiqs.co.uk</a></p>
      </div>
    `,
  });
}

// ── File Upload Config ────────────────────────────────────────────────────────
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => { const ext = path.extname(file.originalname); cb(null, `${uuidv4()}${ext}`); }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.dwg', '.dxf', '.png', '.jpg', '.jpeg', '.xlsx', '.docx', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`File type ${ext} not supported. Allowed: ${allowed.join(', ')}`));
  }
});

// Returns the start of the user's billing cycle (Stripe renewal date, or 1st of month fallback)
function getBillingCycleStart(user) {
  if (user && user.billing_cycle_start) return user.billing_cycle_start;
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function getMonthlyUsage(userId, user) {
  const cycleStart = getBillingCycleStart(user);
  return db.prepare('SELECT COUNT(*) as count FROM projects WHERE user_id = ? AND created_at >= ?').get(userId, cycleStart).count;
}

function getUserPlanInfo(user) {
  const plan = user.plan || 'starter';
  const planDef = PLANS[plan] || PLANS.starter;
  const quota = user.monthly_quota > 0 ? user.monthly_quota : planDef.quota;
  const used = getMonthlyUsage(user.id, user);
  return {
    plan, planLabel: planDef.label, quota, used,
    remaining: quota > 0 ? Math.max(0, quota - used) : (plan === 'starter' ? null : 0),
    isPayg: plan === 'starter' && quota === 0,
    atLimit: quota > 0 && used >= quota,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT RATE SEEDING
// ═══════════════════════════════════════════════════════════════════════════════

function seedDefaultRates(userId) {
  try {
    const defaults = [
      { category: 'groundworks',       item_key: 'strip_foundations',    display_name: 'Strip Foundations 600x250mm',         value: 87,    unit: '£/m'    },
      { category: 'groundworks',       item_key: 'concrete_slab_100mm',  display_name: 'Concrete Slab 100mm Reinforced',      value: 50,    unit: '£/m2'   },
      { category: 'groundworks',       item_key: 'dpm',                  display_name: 'DPM 1200g',                           value: 10,    unit: '£/m2'   },
      { category: 'groundworks',       item_key: 'floor_insulation',     display_name: 'Floor Insulation 100mm Celotex',      value: 21,    unit: '£/m2'   },
      { category: 'masonry',           item_key: 'blockwork_below_dpc',  display_name: 'Blockwork Below DPC 440mm',           value: 63,    unit: '£/m2'   },
      { category: 'masonry',           item_key: 'blockwork_inner_leaf', display_name: 'Blockwork Inner Leaf 100mm',          value: 42,    unit: '£/m2'   },
      { category: 'masonry',           item_key: 'brick_outer_leaf',     display_name: 'Brick Outer Leaf Facing',             value: 63,    unit: '£/m2'   },
      { category: 'masonry',           item_key: 'cavity_insulation',    display_name: 'Cavity Insulation 100mm',             value: 14,    unit: '£/m2'   },
      { category: 'masonry',           item_key: 'cavity_wall_ties',     display_name: 'Cavity Wall Ties',                   value: 4,     unit: '£/m2'   },
      { category: 'masonry',           item_key: 'render_monocouche',    display_name: 'Render Monocouche',                  value: 85,    unit: '£/m2'   },
      { category: 'structural_steel',  item_key: 'structural_steel_saf', display_name: 'Structural Steel Supply Fab Install', value: 3500,  unit: '£/T'    },
      { category: 'masonry',           item_key: 'concrete_lintels',     display_name: 'Concrete Lintels',                   value: 35,    unit: '£/ea'   },
      { category: 'masonry',           item_key: 'steel_lintels',        display_name: 'Steel Lintels Catnic',               value: 75,    unit: '£/ea'   },
      { category: 'carpentry',         item_key: 'roof_structure',       display_name: 'Roof Structure Cut Timber',          value: 95,    unit: '£/m2'   },
      { category: 'roofing',           item_key: 'roof_covering_tiles',  display_name: 'Roof Covering Concrete Tiles',       value: 52,    unit: '£/m2'   },
      { category: 'roofing',           item_key: 'breathable_membrane',  display_name: 'Breathable Membrane',                value: 5,     unit: '£/m2'   },
      { category: 'roofing',           item_key: 'tile_battens',         display_name: 'Tile Battens',                       value: 7,     unit: '£/m2'   },
      { category: 'roofing',           item_key: 'lead_flashings',       display_name: 'Lead Flashings',                     value: 55,    unit: '£/m'    },
      { category: 'roofing',           item_key: 'fascia_soffit',        display_name: 'Fascia Soffit uPVC',                 value: 33,    unit: '£/m'    },
      { category: 'roofing',           item_key: 'guttering',            display_name: 'Guttering uPVC',                     value: 22,    unit: '£/m'    },
      { category: 'general',           item_key: 'upvc_windows',         display_name: 'UPVC Windows Standard',              value: 450,   unit: '£/ea'   },
      { category: 'general',           item_key: 'composite_door',       display_name: 'Composite External Door',            value: 1100,  unit: '£/ea'   },
      { category: 'carpentry',         item_key: 'bifold_doors',         display_name: 'Bi-fold Doors Per Leaf',             value: 650,   unit: '£/leaf' },
      { category: 'carpentry',         item_key: 'internal_doors',       display_name: 'Internal Doors Painted Softwood',    value: 330,   unit: '£/ea'   },
      { category: 'plastering',        item_key: 'plasterboard_skim',    display_name: 'Plasterboard and Skim',              value: 22,    unit: '£/m2'   },
      { category: 'plastering',        item_key: 'wall_tiling',          display_name: 'Wall Tiling Ceramic',                value: 55,    unit: '£/m2'   },
      { category: 'flooring',          item_key: 'floor_tiling',         display_name: 'Floor Tiling Porcelain',             value: 65,    unit: '£/m2'   },
      { category: 'decorating',        item_key: 'painting_emulsion',    display_name: 'Painting Emulsion 2 Coats',          value: 15,    unit: '£/m2'   },
      { category: 'decorating',        item_key: 'painting_gloss',       display_name: 'Painting Gloss Woodwork',            value: 12,    unit: '£/m'    },
      { category: 'flooring',          item_key: 'lvt_flooring',         display_name: 'LVT Flooring',                       value: 62,    unit: '£/m2'   },
      { category: 'flooring',          item_key: 'carpet',               display_name: 'Carpet Mid Range',                   value: 28,    unit: '£/m2'   },
      { category: 'flooring',          item_key: 'screed_50mm',          display_name: 'Screed 50mm',                        value: 22,    unit: '£/m2'   },
      { category: 'kitchen',           item_key: 'kitchen_fitout',       display_name: 'Kitchen Fit-out Mid Range',          value: 11000, unit: '£/ea'   },
      { category: 'bathroom',          item_key: 'bathroom_fitout',      display_name: 'Bathroom Fit-out Mid Range',         value: 6000,  unit: '£/ea'   },
      { category: 'electrical',        item_key: 'electrical_1st_fix',   display_name: 'First Fix Electrical',               value: 3500,  unit: '£/item' },
      { category: 'electrical',        item_key: 'electrical_2nd_fix',   display_name: 'Second Fix Electrical',              value: 1500,  unit: '£/item' },
      { category: 'plumbing',          item_key: 'plumbing_1st_fix',     display_name: 'First Fix Plumbing',                 value: 2800,  unit: '£/item' },
      { category: 'plumbing',          item_key: 'plumbing_2nd_fix',     display_name: 'Second Fix Plumbing',                value: 1400,  unit: '£/item' },
      { category: 'plumbing',          item_key: 'radiator',             display_name: 'Radiator Double Panel 600x1000',     value: 230,   unit: '£/ea'   },
      { category: 'preliminaries',     item_key: 'scaffolding',          display_name: 'Scaffolding',                        value: 20,    unit: '£/m2'   },
      { category: 'preliminaries',     item_key: 'skip_hire',            display_name: 'Skip Hire 8yd',                      value: 330,   unit: '£/ea'   },
      { category: 'preliminaries',     item_key: 'site_setup',           display_name: 'Site Setup Welfare Lump Sum',        value: 2000,  unit: '£'      },
      { category: 'preliminaries',     item_key: 'project_management',   display_name: 'Project Management Allowance',       value: 1500,  unit: '£'      },
    ];
    const insert = db.prepare(`INSERT OR IGNORE INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit, confidence, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 0.75, 1)`);
    const tx = db.transaction(() => { for (const r of defaults) insert.run('rl_' + uuidv4().slice(0, 8), userId, r.category, r.item_key, r.display_name, r.value, r.unit); });
    tx();
    console.log(`[Rates] Seeded ${defaults.length} default rates for user ${userId}`);
  } catch (err) {
    console.error('[Rates] Seed error:', err.message);
  }
}

async function triggerPipedream(project, user, files) {
  try {
    const fileUrls = files.map(f => ({ url: `${PORTAL_BASE_URL}/api/files/download/${f.filename}`, name: f.original_name, fieldName: 'file' }));
    const payload = {
      source: 'portal', projectId: project.id, fullName: user.full_name,
      clientEmail: user.email, email: user.email,
      projectDetails: project.description || project.title, projectType: project.project_type,
      address: project.location || '', location: project.location || '', company: user.company || '',
      drawings_urls: fileUrls.map(f => f.url), file_urls: fileUrls,
      fileCount: files.length, plan: user.plan || 'starter', submittedAt: new Date().toISOString(),
    };
    console.log(`[Pipedream] Triggering pipeline for project: ${project.title} (${files.length} files)`);
    startPipelineRun({ project_id: project.id, project_title: project.title, client_name: user.full_name, client_email: user.email });
    const resp = await fetch(PIPEDREAM_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!resp.ok) { console.error(`[Pipedream] Webhook returned ${resp.status}`); return false; }
    console.log(`[Pipedream] Pipeline triggered successfully`);
    db.prepare('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('in_progress', project.id);
    return true;
  } catch (err) {
    console.error('[Pipedream] Failed to trigger pipeline:', err.message);
    return false;
  }
}

router.get('/files/download/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  const ext = path.extname(req.params.filename).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.dwg': 'application/octet-stream', '.dxf': 'application/octet-stream',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.zip': 'application/zip',
  };
  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  res.sendFile(filePath);
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, fullName, company, phone } = req.body;
    if (!email || !password || !fullName) return res.status(400).json({ error: 'Email, password and full name are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const emailDomain = email.toLowerCase().split('@')[1];
    const freeProviders = ['gmail.com','googlemail.com','outlook.com','hotmail.com','hotmail.co.uk','live.com','live.co.uk','yahoo.com','yahoo.co.uk','icloud.com','me.com','aol.com','protonmail.com','proton.me','btinternet.com','sky.com','virginmedia.com','talktalk.net','mail.com','zoho.com','gmx.com'];
    if (!freeProviders.includes(emailDomain)) {
      const domainUser = db.prepare("SELECT id, full_name, email FROM users WHERE LOWER(email) LIKE ? LIMIT 1").get(`%@${emailDomain}`);
      if (domainUser) {
        notifyAdmin({ type: 'blocked_signup', title: `Blocked signup: ${fullName}`, detail: `${email.toLowerCase()} — domain already registered by ${domainUser.full_name} (${domainUser.email})`, icon: 'user-blocked' });
        return res.status(409).json({ error: 'An account already exists for your organisation. Please contact your colleague or reach out to us for access.' });
      }
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);
    const role = email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'client';
    db.prepare("INSERT INTO users (id, email, password_hash, full_name, company, phone, role, plan, monthly_quota) VALUES (?, ?, ?, ?, ?, ?, ?, 'starter', 2)").run(id, email.toLowerCase(), passwordHash, fullName, company || null, phone || null, role);
    seedDefaultRates(id);

    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    const token = generateToken(newUser);
    const planInfo = getUserPlanInfo(newUser);

    logActivity({ event_type: 'signup', title: fullName + ' signed up', detail: company ? company + ' — ' + email.toLowerCase() : email.toLowerCase(), user_id: id, user_name: fullName, user_email: email.toLowerCase() });

    if (role !== 'admin') {
      notifyAdmin({ type: 'new_signup', title: `New signup: ${fullName}`, detail: [email.toLowerCase(), company, phone].filter(Boolean).join(' · '), icon: 'user-plus' });
      sendAdminSignupEmail({ fullName, email: email.toLowerCase(), company, phone });
      sendClientWelcomeEmail({ fullName, email: email.toLowerCase() }).catch(err => console.error('[Welcome email] Failed:', err.message));
    }

    res.status(201).json({ token, user: { id: newUser.id, email: newUser.email, fullName: newUser.full_name, company: newUser.company, phone: newUser.phone, role: newUser.role, plan: planInfo.plan, planLabel: planInfo.planLabel, quota: planInfo.quota, used: planInfo.used, remaining: planInfo.remaining, isPayg: planInfo.isPayg, atLimit: planInfo.atLimit } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.suspended) return res.status(403).json({ error: 'Your account has been suspended. Contact support for assistance.', suspended: true, reason: user.suspended_reason || null });
    const token = generateToken(user);
    const planInfo = getUserPlanInfo(user);
    logActivity({ event_type: 'login', title: (user.full_name || email) + ' logged in', user_id: user.id, user_name: user.full_name, user_email: user.email });
    res.json({ token, user: { id: user.id, email: user.email, fullName: user.full_name, company: user.company, phone: user.phone, role: user.role, plan: planInfo.plan, planLabel: planInfo.planLabel, quota: planInfo.quota, used: planInfo.used, remaining: planInfo.remaining, isPayg: planInfo.isPayg, atLimit: planInfo.atLimit, forcePasswordChange: user.force_password_change === 1 } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const planInfo = getUserPlanInfo(user);
  res.json({ id: user.id, email: user.email, fullName: user.full_name, company: user.company, phone: user.phone, role: user.role, plan: planInfo.plan, planLabel: planInfo.planLabel, quota: planInfo.quota, used: planInfo.used, remaining: planInfo.remaining, isPayg: planInfo.isPayg, atLimit: planInfo.atLimit });
});

router.put('/auth/change-password', authMiddleware, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET password_hash = ?, force_password_change = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

router.get('/auth/magic', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token is required' });
    try { db.prepare('SELECT 1 FROM magic_links LIMIT 1').get(); } catch (e) { return res.status(400).json({ error: 'Invalid or expired magic link' }); }
    const link = db.prepare('SELECT * FROM magic_links WHERE token = ? AND used = 0').get(token);
    if (!link) return res.status(400).json({ error: 'Invalid or expired magic link' });
    const now = new Date().toISOString();
    if (now > link.expires_at) return res.status(400).json({ error: 'Magic link has expired' });
    db.prepare('UPDATE magic_links SET used = 1 WHERE id = ?').run(link.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(link.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.suspended) return res.status(403).json({ error: 'Your account has been suspended. Contact support for assistance.', suspended: true, reason: user.suspended_reason || null });
    const authToken = generateToken(user);
    const planInfo = getUserPlanInfo(user);
    logActivity({ event_type: 'login', title: (user.full_name || user.email) + ' logged in via magic link', user_id: user.id, user_name: user.full_name, user_email: user.email });
    res.json({ token: authToken, user: { id: user.id, email: user.email, fullName: user.full_name, company: user.company, phone: user.phone, role: user.role, plan: planInfo.plan, planLabel: planInfo.planLabel, quota: planInfo.quota, used: planInfo.used, remaining: planInfo.remaining, isPayg: planInfo.isPayg, atLimit: planInfo.atLimit } });
  } catch (err) {
    console.error('Magic link login error:', err);
    res.status(500).json({ error: 'Failed to process magic link' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE OAUTH
// ═══════════════════════════════════════════════════════════════════════════════

// Step 1: Redirect to Google
router.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google OAuth not configured' });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Step 2: Google redirects back here with a code
router.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error || !code) return res.redirect(`/login?error=google_denied`);

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return res.redirect(`/login?error=google_token_failed`);

    // Get user info from Google
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    if (!profile.email) return res.redirect(`/login?error=google_no_email`);

    const email = profile.email.toLowerCase();
    const fullName = profile.name || email.split('@')[0];
    const googleId = profile.id;
    const avatar = profile.picture || null;

    // Find or create user
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      // New user — create account
      const id = uuidv4();
      const role = email === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'client';
      db.prepare("INSERT INTO users (id, email, password_hash, full_name, google_id, avatar, role, plan, monthly_quota) VALUES (?, ?, '', ?, ?, ?, ?, 'starter', 2)")
        .run(id, email, fullName, googleId, avatar, role);
      seedDefaultRates(id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

      logActivity({ event_type: 'signup', title: fullName + ' signed up via Google', detail: email, user_id: id, user_name: fullName, user_email: email });
      if (role !== 'admin') {
        notifyAdmin({ type: 'new_signup', title: `New signup (Google): ${fullName}`, detail: email, icon: 'user-plus' });
        sendAdminSignupEmail({ fullName, email, company: null, phone: null });
        sendClientWelcomeEmail({ fullName, email }).catch(err => console.error('[Welcome email] Failed:', err.message));
      }
    } else {
      // Existing user — update google_id and avatar if not set
      db.prepare('UPDATE users SET google_id = COALESCE(google_id, ?), avatar = COALESCE(avatar, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(googleId, avatar, user.id);
      logActivity({ event_type: 'login', title: fullName + ' logged in via Google', user_id: user.id, user_name: user.full_name, user_email: user.email });
    }

    if (user.suspended) return res.redirect(`/login?error=account_suspended`);

    const authToken = generateToken(user);
    // Redirect to frontend with token in query param — frontend will store it
    res.redirect(`/auth/google/success?token=${authToken}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    res.redirect(`/login?error=google_failed`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS API
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/notifications', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const notifications = db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all();
    const unreadCount = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0').get().count;
    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.json({ notifications: [], unreadCount: 0 });
  }
});

router.put('/notifications/:id/read', authMiddleware, adminMiddleware, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

router.put('/notifications/read-all', authMiddleware, adminMiddleware, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVITY FEED
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/admin/activity', authMiddleware, adminMiddleware, (req, res) => {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT,
        user_id TEXT,
        user_name TEXT,
        user_email TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const filter = req.query.filter || 'all';

    const events = filter !== 'all'
      ? db.prepare('SELECT * FROM activity_log WHERE event_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(filter, limit, offset)
      : db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);

    const total = filter !== 'all'
      ? db.prepare('SELECT COUNT(*) as c FROM activity_log WHERE event_type = ?').get(filter).c
      : db.prepare('SELECT COUNT(*) as c FROM activity_log').get().c;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const summary = {
      total_users:         db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'client'").get().c,
      signups_this_month:  db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'client' AND created_at >= ?").get(monthStart).c,
      logins_today:        (() => { try { return db.prepare("SELECT COUNT(*) as c FROM activity_log WHERE event_type = 'login' AND created_at >= ?").get(todayStart).c; } catch(e) { return 0; } })(),
      projects_this_month: db.prepare('SELECT COUNT(*) as c FROM projects WHERE created_at >= ?').get(monthStart).c,
      docs_generated:      (() => { try { return db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE action = 'doc_generated'").get().c; } catch(e) { return 0; } })(),
    };

    res.json({ events, total, summary });
  } catch (err) {
    console.error('Activity feed error:', err);
    res.status(500).json({ error: 'Failed to load activity', events: [], total: 0, summary: {} });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// USAGE
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/usage', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const planInfo = getUserPlanInfo(user);
  const cycleStart = getBillingCycleStart(user);
  const monthProjects = db.prepare('SELECT id, title, project_type, status, created_at FROM projects WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC').all(req.user.id, cycleStart);

  // Message usage this billing cycle
  let messagesUsed = 0;
  try {
    const row = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='chat_message' AND created_at>=?").get(req.user.id, cycleStart);
    messagesUsed = row?.c || 0;
  } catch(e) {}
  const plan = user.plan || 'starter';
  const defaultMsgLimit = plan === 'starter' ? 10 : plan === 'professional' ? 100 : 200;
  const messagesLimit = (user.monthly_quota != null && user.monthly_quota >= 0) ? user.monthly_quota : defaultMsgLimit;
  const messagesRemaining = Math.max(0, messagesLimit - messagesUsed);

  // Calculate cycle dates for display
  const cycleStartDate = new Date(cycleStart);
  const cycleEndDate = new Date(cycleStartDate);
  cycleEndDate.setMonth(cycleEndDate.getMonth() + 1);

  res.json({
    ...planInfo, monthProjects,
    monthName: cycleStartDate.toLocaleString('en-GB', { day: 'numeric', month: 'long' }) + ' – ' + cycleEndDate.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    billingCycleStart: cycleStart,
    billingCycleEnd: cycleEndDate.toISOString(),
    messagesUsed, messagesLimit, messagesRemaining,
    messagesAtLimit: messagesLimit > 0 && messagesUsed >= messagesLimit,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN — USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json({ users: users.map(u => {
    const planInfo = getUserPlanInfo(u);
    const userCycleStart = getBillingCycleStart(u);
    // Count BOQ docs generated this billing cycle (exclude revisions)
    let docsUsed = 0;
    try {
      const docsGen = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_generated' AND created_at>=?").get(u.id, userCycleStart);
      const docsRev = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_revision' AND created_at>=?").get(u.id, userCycleStart);
      docsUsed = (docsGen?.c || 0) - (docsRev?.c || 0);
      if (docsUsed < 0) docsUsed = 0;
    } catch(e) {}
    const plan = u.plan || 'starter';
    const defaultDocLimit = plan === 'premium' ? 20 : plan === 'professional' ? 10 : 0;
    const docsLimit = (u.monthly_boq_quota != null && u.monthly_boq_quota >= 0) ? u.monthly_boq_quota : defaultDocLimit;
    return {
      id: u.id, email: u.email, full_name: u.full_name, fullName: u.full_name,
      company: u.company, phone: u.phone, role: u.role,
      plan: plan, planLabel: planInfo.planLabel,
      quota: planInfo.quota, used: planInfo.used, remaining: planInfo.remaining,
      messages_used: planInfo.used, monthly_quota: u.monthly_quota || 0,
      atLimit: planInfo.atLimit,
      suspended: u.suspended || 0, suspended_reason: u.suspended_reason,
      bonus_messages: u.bonus_messages || 0, bonus_docs: u.bonus_docs || 0,
      monthly_boq_quota: u.monthly_boq_quota || 0,
      docs_used: docsUsed, docs_limit: docsLimit,
      created_at: u.created_at, project_count: 0,
    };
  }) });
});

router.post('/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { email, fullName, company, phone, role, sendInvite } = req.body;
    if (!email || !fullName) return res.status(400).json({ error: 'Email and full name are required' });
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'A user with this email already exists' });
    const id = uuidv4();
    // Generate a random temporary password — user will set their own via magic link
    const tempPassword = crypto.randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    db.prepare("INSERT INTO users (id, email, password_hash, full_name, company, phone, role, plan, monthly_quota, force_password_change) VALUES (?, ?, ?, ?, ?, ?, ?, 'starter', 2, 1)").run(id, email.toLowerCase(), passwordHash, fullName, company || null, phone || null, role || 'client');
    seedDefaultRates(id);
    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    logActivity({ event_type: 'signup', title: fullName + ' added by admin', detail: company ? company + ' — ' + email.toLowerCase() : email.toLowerCase(), user_id: id, user_name: fullName, user_email: email.toLowerCase() });

    // Auto-send welcome email with magic link
    let emailSent = false;
    let magicUrl = null;
    if (sendInvite !== false) {
      try {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days for new user invite
        db.exec('CREATE TABLE IF NOT EXISTS magic_links (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
        db.prepare('INSERT INTO magic_links (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(uuidv4(), id, token, expiresAt);
        const portalUrl = process.env.PORTAL_URL || 'https://aiqs-portal.onrender.com';
        magicUrl = `${portalUrl}/magic?token=${token}`;
        const firstName = (fullName || 'there').split(' ')[0];
        emailSent = await sendEmail({
          to: email.toLowerCase(),
          subject: 'Welcome to AI QS — Set Up Your Account',
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
              <div style="text-align:center;margin-bottom:32px;">
                <div style="font-size:28px;font-weight:800;color:#0F172A;">AI <span style="color:#F59E0B;">QS</span></div>
                <div style="font-size:10px;letter-spacing:3px;color:#94A3B8;text-transform:uppercase;margin-top:2px;">Quantity Surveying</div>
              </div>
              <h2 style="font-size:20px;color:#0F172A;margin:0 0 12px;">Hi ${firstName},</h2>
              <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 8px;">You've been signed up to the <strong>AI QS Portal</strong> — automated quantity surveying powered by AI.</p>
              <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 24px;">Click the button below to set your password and get started.</p>
              <div style="text-align:center;margin:32px 0;">
                <a href="${magicUrl}" style="display:inline-block;padding:14px 36px;background:#F59E0B;color:#0F172A;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">Set Up Your Account</a>
              </div>
              <p style="font-size:13px;color:#94A3B8;line-height:1.5;">This link expires in 7 days. If it expires, ask your administrator to send a new one.</p>
              <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 16px;" />
              <p style="font-size:11px;color:#CBD5E1;text-align:center;">AI QS — Automated Quantity Surveying<br/><a href="https://theaiqs.co.uk" style="color:#94A3B8;">theaiqs.co.uk</a></p>
            </div>
          `,
        });
        if (emailSent) console.log(`[Invite] Welcome email sent to ${email}`);
        else console.log(`[Invite] Email not configured — magic link: ${magicUrl}`);
      } catch (inviteErr) {
        console.error('[Invite] Failed to send welcome email:', inviteErr.message);
      }
    }

    res.status(201).json({ id: newUser.id, email: newUser.email, fullName: newUser.full_name, company: newUser.company, phone: newUser.phone, role: newUser.role, createdAt: newUser.created_at, emailSent, magicUrl: emailSent ? null : magicUrl });
  } catch (err) {
    console.error('Add user error:', err);
    res.status(500).json({ error: 'Failed to add user' });
  }
});

router.delete('/admin/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
    const user = db.prepare('SELECT id, full_name, email FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const uid = req.params.id;
    const del = db.transaction(() => {
      db.prepare('DELETE FROM files WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)').run(uid);
      try { db.prepare('DELETE FROM project_data WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)').run(uid); } catch(e) {}
      db.prepare('DELETE FROM projects WHERE user_id = ?').run(uid);
      try { db.prepare('DELETE FROM chat_projects WHERE user_id = ?').run(uid); } catch(e) {}
      try { db.prepare('DELETE FROM chat_sessions WHERE user_id = ?').run(uid); } catch(e) {}
      try { db.prepare('DELETE FROM rate_corrections_log WHERE user_id = ?').run(uid); } catch(e) {}
      try { db.prepare('DELETE FROM client_rate_library WHERE user_id = ?').run(uid); } catch(e) {}
      try { db.prepare('DELETE FROM client_insights WHERE user_id = ?').run(uid); } catch(e) {}
      try { db.prepare('DELETE FROM usage_log WHERE user_id = ?').run(uid); } catch(e) {}
      try { db.prepare('DELETE FROM activity_log WHERE user_id = ?').run(uid); } catch(e) {}
      try { db.prepare('DELETE FROM magic_links WHERE user_id = ?').run(uid); } catch(e) {}
      db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    });
    del();
    logActivity({ event_type: 'user_deleted', title: (user.full_name || user.email) + ' deleted by admin', detail: user.email, user_id: null, user_name: 'Admin', user_email: null });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

router.put('/admin/users/:id/plan', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { plan, monthlyQuota, boqQuota } = req.body;
    const validPlans = ['starter', 'professional', 'premium', 'custom'];
    if (!plan || !validPlans.includes(plan)) return res.status(400).json({ error: 'Invalid plan. Must be: starter, professional, premium, or custom' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const quota = monthlyQuota !== undefined ? parseInt(monthlyQuota) : (PLANS[plan]?.quota || 0);
    const boq   = boqQuota    !== undefined ? parseInt(boqQuota)     : (PLANS[plan]?.boqQuota || 0);
    db.prepare('UPDATE users SET plan = ?, monthly_quota = ?, monthly_boq_quota = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(plan, quota, boq, req.params.id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    const planInfo = getUserPlanInfo(updated);
    logActivity({ event_type: 'plan_changed', title: (user.full_name || user.email) + ' plan changed to ' + plan, detail: quota + ' msgs, ' + boq + ' BOQs/month', user_id: user.id, user_name: user.full_name, user_email: user.email });
    res.json({ id: updated.id, email: updated.email, fullName: updated.full_name, plan: planInfo.plan, planLabel: planInfo.planLabel, quota: planInfo.quota, used: planInfo.used, remaining: planInfo.remaining });
  } catch (err) {
    console.error('Update plan error:', err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

router.put('/admin/users/:id/credits', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const bonus_messages = parseInt(req.body.bonus_messages) || 0;
    const bonus_docs     = parseInt(req.body.bonus_docs)     || 0;
    db.prepare('UPDATE users SET bonus_messages = ?, bonus_docs = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(bonus_messages, bonus_docs, req.params.id);
    logActivity({ event_type: 'plan_changed', title: (user.full_name || user.email) + ' credits updated by admin', detail: bonus_messages + ' bonus messages, ' + bonus_docs + ' bonus docs', user_id: user.id, user_name: user.full_name, user_email: user.email });
    res.json({ success: true, bonus_messages, bonus_docs });
  } catch (err) {
    console.error('Set credits error:', err);
    res.status(500).json({ error: 'Failed to update credits' });
  }
});

router.post('/admin/users/:id/grant-doc', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const amount   = Math.max(1, parseInt(req.body.amount) || 1);
    const newBonus = (user.bonus_docs || 0) + amount;
    db.prepare('UPDATE users SET bonus_docs = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newBonus, req.params.id);
    try {
      db.prepare("INSERT INTO usage_log (id, user_id, action, detail, model_used, tokens_in, tokens_out, cost_estimate) VALUES (?, ?, 'admin_credit', ?, 'admin', 0, 0, 0)")
        .run('ul_' + uuidv4().slice(0, 8), req.params.id, amount + ' paid BOQ credit(s) granted by admin');
    } catch(e) {}
    logActivity({ event_type: 'plan_changed', title: (user.full_name || user.email) + ' granted ' + amount + ' BOQ credit(s)', detail: 'bonus_docs: ' + (user.bonus_docs || 0) + ' → ' + newBonus, user_id: user.id, user_name: user.full_name, user_email: user.email });
    res.json({ success: true, bonus_docs: newBonus });
  } catch (err) {
    console.error('Grant doc error:', err);
    res.status(500).json({ error: 'Failed to grant doc credit' });
  }
});

router.post('/admin/grant-doc/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const newBonus = (user.bonus_docs || 0) + 1;
    db.prepare('UPDATE users SET bonus_docs = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newBonus, req.params.id);
    res.json({ success: true, bonus_docs: newBonus });
  } catch (err) {
    res.status(500).json({ error: 'Failed to grant doc credit' });
  }
});

router.post('/admin/suspend/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const reason = req.body.reason || 'Suspended by admin';
    db.prepare('UPDATE users SET suspended = 1, suspended_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(reason, req.params.id);
    logActivity({ event_type: 'plan_changed', title: (user.full_name || user.email) + ' account suspended', detail: reason, user_id: user.id, user_name: user.full_name, user_email: user.email });
    res.json({ success: true });
  } catch (err) {
    console.error('Suspend error:', err);
    res.status(500).json({ error: 'Failed to suspend account' });
  }
});

router.post('/admin/unsuspend/:id', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    db.prepare('UPDATE users SET suspended = 0, suspended_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(req.params.id);
    logActivity({ event_type: 'plan_changed', title: (user.full_name || user.email) + ' account reactivated', user_id: user.id, user_name: user.full_name, user_email: user.email });
    res.json({ success: true });
  } catch (err) {
    console.error('Unsuspend error:', err);
    res.status(500).json({ error: 'Failed to reactivate account' });
  }
});

router.put('/admin/users/:id/role', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'client'].includes(role)) return res.status(400).json({ error: 'Role must be admin or client' });
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot change your own role' });
    db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(role, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

router.put('/admin/users/:id/password', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET password_hash = ?, force_password_change = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.post('/admin/users/:id/magic-link', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, full_name FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.exec('CREATE TABLE IF NOT EXISTS magic_links (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    // Clean up expired/used magic links for this user (keep table intact for other users)
    db.prepare('DELETE FROM magic_links WHERE user_id = ? OR (used = 1) OR (expires_at < ?)').run(user.id, new Date().toISOString());
    db.prepare('INSERT INTO magic_links (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(uuidv4(), user.id, token, expiresAt);
    const portalUrl = process.env.PORTAL_URL || 'https://aiqs-portal.onrender.com';
    const magicUrl = `${portalUrl}/magic?token=${token}`;
    const firstName = (user.full_name || 'there').split(' ')[0];
    const emailSent = await sendEmail({
      to: user.email,
      subject: 'Your AI QS Portal Login Link',
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
          <div style="text-align:center;margin-bottom:32px;">
            <div style="font-size:28px;font-weight:800;color:#0F172A;">AI <span style="color:#F59E0B;">QS</span></div>
            <div style="font-size:10px;letter-spacing:3px;color:#94A3B8;text-transform:uppercase;margin-top:2px;">Quantity Surveying</div>
          </div>
          <h2 style="font-size:20px;color:#0F172A;margin:0 0 12px;">Hi ${firstName},</h2>
          <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 24px;">You've been invited to access the AI QS Portal. Click the button below to log in instantly — no password needed.</p>
          <div style="text-align:center;margin:32px 0;">
            <a href="${magicUrl}" style="display:inline-block;padding:14px 36px;background:#F59E0B;color:#0F172A;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;">Log In to AI QS Portal</a>
          </div>
          <p style="font-size:13px;color:#94A3B8;line-height:1.5;">This link expires in 24 hours and can only be used once.</p>
          <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 16px;" />
          <p style="font-size:11px;color:#CBD5E1;text-align:center;">AI QS — Automated Quantity Surveying<br/><a href="https://theaiqs.co.uk" style="color:#94A3B8;">theaiqs.co.uk</a></p>
        </div>
      `,
    });
    res.json({ success: true, email: user.email, magicUrl, magicLink: magicUrl, emailSent, message: emailSent ? `Magic link emailed to ${user.email}` : `Magic link generated (email not configured).` });
  } catch (err) {
    console.error('Magic link error:', err);
    res.status(500).json({ error: 'Failed to generate magic link' });
  }
});

router.get('/admin/projects', authMiddleware, adminMiddleware, (req, res) => {
  const projects = db.prepare('SELECT p.*, u.full_name as client_name, u.email as client_email, COUNT(f.id) as file_count FROM projects p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN files f ON f.project_id = p.id GROUP BY p.id ORDER BY p.created_at DESC').all();
  res.json(projects.map(p => ({ id: p.id, title: p.title, projectType: p.project_type, description: p.description, location: p.location, status: p.status, clientName: p.client_name, clientEmail: p.client_email, fileCount: p.file_count, createdAt: p.created_at })));
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROJECT ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/projects', authMiddleware, (req, res) => {
  const projects = db.prepare('SELECT p.*, COUNT(f.id) as file_count FROM projects p LEFT JOIN files f ON f.project_id = p.id WHERE p.user_id = ? GROUP BY p.id ORDER BY p.created_at DESC').all(req.user.id);
  res.json(projects.map(p => ({ ...p, fullName: undefined, fileCount: p.file_count })));
});

router.get('/projects/:id', authMiddleware, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const files = db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC').all(project.id);
  res.json({ ...project, files });
});

router.post('/projects', authMiddleware, upload.array('drawings', 10), (req, res) => {
  try {
    const { title, projectType, description, location } = req.body;
    if (!title || !projectType) return res.status(400).json({ error: 'Project title and type are required' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const planInfo = getUserPlanInfo(user);
    if (planInfo.atLimit) return res.status(403).json({ error: 'Monthly project limit reached', code: 'LIMIT_REACHED', usage: planInfo });
    const isPayg = req.body.payg === 'true' || planInfo.isPayg;
    const initialStatus = isPayg ? 'awaiting_payment' : 'submitted';
    const projectId = uuidv4();
    db.prepare('INSERT INTO projects (id, user_id, title, project_type, description, location, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(projectId, req.user.id, title, projectType, description || null, location || null, initialStatus);
    if (req.files && req.files.length > 0) {
      const insertFile = db.prepare('INSERT INTO files (id, project_id, filename, original_name, file_type, file_size) VALUES (?, ?, ?, ?, ?, ?)');
      for (const file of req.files) insertFile.run(uuidv4(), projectId, file.filename, file.originalname, path.extname(file.originalname).toLowerCase(), file.size);
    }
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    const files = db.prepare('SELECT * FROM files WHERE project_id = ?').all(projectId);
    if (!isPayg && files.length > 0) triggerPipedream(project, user, files);
    const updatedPlanInfo = getUserPlanInfo(user);
    logActivity({ event_type: 'project_created', title: (user.full_name || user.email) + ' submitted a project', detail: title + (location ? ' — ' + location : '') + ' (' + (files.length || 0) + ' files)', user_id: user.id, user_name: user.full_name, user_email: user.email });
    notifyAdmin({ type: 'new_project', title: `New project: ${title}`, detail: (user.full_name || user.email) + (location ? ' — ' + location : '') + ' (' + (files.length || 0) + ' files)', icon: 'folder-plus' });
    res.status(201).json({ ...project, files, usage: updatedPlanInfo });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

router.post('/projects/:id/files', authMiddleware, upload.array('drawings', 10), (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  const insertFile = db.prepare('INSERT INTO files (id, project_id, filename, original_name, file_type, file_size) VALUES (?, ?, ?, ?, ?, ?)');
  const newFiles = [];
  for (const file of req.files) {
    const fileId = uuidv4();
    insertFile.run(fileId, project.id, file.filename, file.originalname, path.extname(file.originalname).toLowerCase(), file.size);
    newFiles.push({ id: fileId, filename: file.filename, originalName: file.originalname });
  }
  res.status(201).json({ files: newFiles });
});

router.post('/projects/:id/activate', authMiddleware, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.status !== 'awaiting_payment') return res.json(project);
    db.prepare('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('submitted', project.id);
    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
    const files = db.prepare('SELECT * FROM files WHERE project_id = ?').all(project.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (files.length > 0) triggerPipedream(updated, user, files);
    res.json({ ...updated, files });
  } catch (err) {
    console.error('Activate project error:', err);
    res.status(500).json({ error: 'Failed to activate project' });
  }
});

module.exports = router;
