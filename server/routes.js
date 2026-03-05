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

const PLANS = {
  starter:      { label: 'Starter (PAYG)', quota: 0, price: 99 },
  professional: { label: 'Professional',   quota: 10, price: 347 },
  premium:      { label: 'Premium',        quota: 20, price: 447 },
  custom:       { label: 'Custom',         quota: 999, price: 0 },
};

// --- SMTP Email Setup (Hostinger) ---
const smtpTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
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
      to,
      subject,
      html,
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

// Create notifications table if it doesn't exist
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

// Helper: create a notification + email the admin
async function notifyAdmin({ type, title, detail, icon }) {
  try {
    const id = uuidv4();
    db.prepare(
      'INSERT INTO notifications (id, type, title, detail, icon) VALUES (?, ?, ?, ?, ?)'
    ).run(id, type, title, detail || null, icon || 'user');
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
            ${companyLine}
            ${phoneLine}
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

// --- File Upload Config ---
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', 'data');
const uploadsDir = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.dwg', '.dxf', '.png', '.jpg', '.jpeg', '.xlsx', '.docx', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not supported. Allowed: ${allowed.join(', ')}`));
    }
  }
});

function getMonthlyUsage(userId) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const result = db.prepare('SELECT COUNT(*) as count FROM projects WHERE user_id = ? AND created_at >= ? AND created_at < ?').get(userId, monthStart, monthEnd);
  return result.count;
}

function getUserPlanInfo(user) {
  const plan = user.plan || 'starter';
  const planDef = PLANS[plan] || PLANS.starter;
  const quota = user.monthly_quota > 0 ? user.monthly_quota : planDef.quota;
  const used = getMonthlyUsage(user.id);
  return {
    plan,
    planLabel: planDef.label,
    quota,
    used,
    remaining: quota > 0 ? Math.max(0, quota - used) : (plan === 'starter' ? null : 0),
    isPayg: plan === 'starter' && quota === 0,
    atLimit: quota > 0 && used >= quota,
  };
}

async function triggerPipedream(project, user, files) {
  try {
    const fileUrls = files.map(f => ({
      url: `${PORTAL_BASE_URL}/api/files/download/${f.filename}`,
      name: f.original_name,
      fieldName: 'file'
    }));
    const payload = {
      source: 'portal',
      projectId: project.id,
      fullName: user.full_name,
      clientEmail: user.email,
      email: user.email,
      projectDetails: project.description || project.title,
      projectType: project.project_type,
      address: project.location || '',
      location: project.location || '',
      company: user.company || '',
      drawings_urls: fileUrls.map(f => f.url),
      file_urls: fileUrls,
      fileCount: files.length,
      plan: user.plan || 'starter',
      submittedAt: new Date().toISOString(),
    };
    console.log(`[Pipedream] Triggering pipeline for project: ${project.title} (${files.length} files)`);
    
    startPipelineRun({
      project_id: project.id,
      project_title: project.title,
      client_name: user.full_name,
      client_email: user.email,
    });

    const resp = await fetch(PIPEDREAM_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.error(`[Pipedream] Webhook returned ${resp.status}`);
      return false;
    }
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
    // --- One account per company domain (skip free email providers) ---
const emailDomain = email.toLowerCase().split('@')[1];
const freeProviders = [
  'gmail.com','googlemail.com','outlook.com','hotmail.com','hotmail.co.uk',
  'live.com','live.co.uk','yahoo.com','yahoo.co.uk','icloud.com','me.com',
  'aol.com','protonmail.com','proton.me','btinternet.com','sky.com',
  'virginmedia.com','talktalk.net','mail.com','zoho.com','gmx.com',
];
if (!freeProviders.includes(emailDomain)) {
  const domainUser = db.prepare(
    "SELECT id, full_name, email FROM users WHERE LOWER(email) LIKE ? LIMIT 1"
  ).get(`%@${emailDomain}`);
  if (domainUser) {
    // Notify admin about the blocked attempt
    notifyAdmin({
      type: 'blocked_signup',
      title: `Blocked signup: ${fullName}`,
      detail: `${email.toLowerCase()} — domain already registered by ${domainUser.full_name} (${domainUser.email})`,
      icon: 'user-blocked',
    });
    return res.status(409).json({
      error: 'An account already exists for your organisation. Please contact your colleague or reach out to us for access.'
    });
  }
}
    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);
    const role = email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'client';
    db.prepare('INSERT INTO users (id, email, password_hash, full_name, company, phone, role, plan, monthly_quota) VALUES (?, ?, ?, ?, ?, ?, ?, \'starter\', 2)').run(id, email.toLowerCase(), passwordHash, fullName, company || null, phone || null, role);
    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    const token = generateToken(newUser);
    const planInfo = getUserPlanInfo(newUser);

    // ─── LOG: New signup ───
    logActivity({
      event_type: 'signup',
      title: fullName + ' signed up',
      detail: company ? company + ' — ' + email.toLowerCase() : email.toLowerCase(),
      user_id: id,
      user_name: fullName,
      user_email: email.toLowerCase(),
    });

    // ─── NOTIFY ADMIN: New signup (skip if admin is registering themselves) ───
    if (role !== 'admin') {
      notifyAdmin({
        type: 'new_signup',
        title: `New signup: ${fullName}`,
        detail: [email.toLowerCase(), company, phone].filter(Boolean).join(' · '),
        icon: 'user-plus',
      });
      sendAdminSignupEmail({ fullName, email: email.toLowerCase(), company, phone });
    }

    res.status(201).json({
      token,
      user: { id: newUser.id, email: newUser.email, fullName: newUser.full_name, company: newUser.company, phone: newUser.phone, role: newUser.role, plan: planInfo.plan, planLabel: planInfo.planLabel, quota: planInfo.quota, used: planInfo.used, remaining: planInfo.remaining, isPayg: planInfo.isPayg, atLimit: planInfo.atLimit }
    });
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
    const token = generateToken(user);
    const planInfo = getUserPlanInfo(user);

    // ─── LOG: Login ───
    logActivity({
      event_type: 'login',
      title: (user.full_name || email) + ' logged in',
      user_id: user.id,
      user_name: user.full_name,
      user_email: user.email,
    });

   res.json({
      token,
      user: { id: user.id, email: user.email, fullName: user.full_name, company: user.company, phone: user.phone, role: user.role, plan: planInfo.plan, planLabel: planInfo.planLabel, quota: planInfo.quota, used: planInfo.used, remaining: planInfo.remaining, isPayg: planInfo.isPayg, atLimit: planInfo.atLimit, forcePasswordChange: user.force_password_change === 1 }
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
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// --- Magic Link Login ---
router.get('/auth/magic', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token is required' });
    try {
      db.prepare('SELECT 1 FROM magic_links LIMIT 1').get();
    } catch (e) {
      return res.status(400).json({ error: 'Invalid or expired magic link' });
    }
    const link = db.prepare('SELECT * FROM magic_links WHERE token = ? AND used = 0').get(token);
    if (!link) return res.status(400).json({ error: 'Invalid or expired magic link' });
    const now = new Date().toISOString();
    if (now > link.expires_at) return res.status(400).json({ error: 'Magic link has expired' });
    db.prepare('UPDATE magic_links SET used = 1 WHERE id = ?').run(link.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(link.user_id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const authToken = generateToken(user);
    const planInfo = getUserPlanInfo(user);

    // ─── LOG: Magic link login ───
    logActivity({
      event_type: 'login',
      title: (user.full_name || user.email) + ' logged in via magic link',
      user_id: user.id,
      user_name: user.full_name,
      user_email: user.email,
    });

    res.json({
      token: authToken,
      user: { id: user.id, email: user.email, fullName: user.full_name, company: user.company, phone: user.phone, role: user.role, plan: planInfo.plan, planLabel: planInfo.planLabel, quota: planInfo.quota, used: planInfo.used, remaining: planInfo.remaining, isPayg: planInfo.isPayg, atLimit: planInfo.atLimit }
    });
  } catch (err) {
    console.error('Magic link login error:', err);
    res.status(500).json({ error: 'Failed to process magic link' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS API (Admin only)
// ═══════════════════════════════════════════════════════════════════════════════

// Get all notifications (admin only)
router.get('/notifications', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const notifications = db.prepare(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50'
    ).all();
    const unreadCount = db.prepare(
      'SELECT COUNT(*) as count FROM notifications WHERE read = 0'
    ).get().count;
    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.json({ notifications: [], unreadCount: 0 });
  }
});

// Mark one notification as read
router.put('/notifications/:id/read', authMiddleware, adminMiddleware, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// Mark all notifications as read
router.put('/notifications/read-all', authMiddleware, adminMiddleware, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
    res.json({ success: true });
  } catch (err) {
    console.error('Mark all read error:', err);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// USAGE
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/usage', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const planInfo = getUserPlanInfo(user);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const monthProjects = db.prepare('SELECT id, title, project_type, status, created_at FROM projects WHERE user_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at DESC').all(req.user.id, monthStart, monthEnd);
  res.json({ ...planInfo, monthProjects, monthName: now.toLocaleString('en-GB', { month: 'long', year: 'numeric' }) });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json({ users: users.map(u => {
    const planInfo = getUserPlanInfo(u);
    return { id: u.id, email: u.email, full_name: u.full_name, fullName: u.full_name, company: u.company, phone: u.phone, role: u.role, plan: u.plan || 'starter', planLabel: planInfo.planLabel, quota: planInfo.quota, used: planInfo.used, remaining: planInfo.remaining, atLimit: planInfo.atLimit, suspended: u.suspended || 0, suspended_reason: u.suspended_reason, bonus_messages: u.bonus_messages || 0, bonus_docs: u.bonus_docs || 0, created_at: u.created_at, project_count: 0 };
  }) });
});

router.post('/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { email, fullName, company, phone, role, password } = req.body;
    if (!email || !fullName) return res.status(400).json({ error: 'Email and full name are required' });
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'A user with this email already exists' });
    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password || 'Welcome123!', 12);
    db.prepare('INSERT INTO users (id, email, password_hash, full_name, company, phone, role, plan, monthly_quota) VALUES (?, ?, ?, ?, ?, ?, ?, \'starter\', 2)').run(id, email.toLowerCase(), passwordHash, fullName, company || null, phone || null, role || 'client');
    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);

    // ─── LOG: Admin added a user ───
    logActivity({
      event_type: 'signup',
      title: fullName + ' added by admin',
      detail: company ? company + ' — ' + email.toLowerCase() : email.toLowerCase(),
      user_id: id,
      user_name: fullName,
      user_email: email.toLowerCase(),
    });

    res.status(201).json({ id: newUser.id, email: newUser.email, fullName: newUser.full_name, company: newUser.company, phone: newUser.phone, role: newUser.role, createdAt: newUser.created_at });
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
    db.prepare('DELETE FROM files WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)').run(req.params.id);
    db.prepare('DELETE FROM projects WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

router.put('/admin/users/:id/plan', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { plan, monthlyQuota } = req.body;
    if (!plan || !PLANS[plan]) return res.status(400).json({ error: 'Invalid plan. Must be: starter, professional, premium, or custom' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const quota = monthlyQuota !== undefined ? monthlyQuota : PLANS[plan].quota;
    db.prepare('UPDATE users SET plan = ?, monthly_quota = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(plan, quota, req.params.id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    const planInfo = getUserPlanInfo(updated);

    // ─── LOG: Plan changed ───
    logActivity({
      event_type: 'plan_changed',
      title: (user.full_name || user.email) + ' plan changed to ' + PLANS[plan].label,
      detail: 'Quota: ' + quota + '/month',
      user_id: user.id,
      user_name: user.full_name,
      user_email: user.email,
    });

    res.json({ id: updated.id, email: updated.email, fullName: updated.full_name, plan: planInfo.plan, planLabel: planInfo.planLabel, quota: planInfo.quota, used: planInfo.used, remaining: planInfo.remaining });
  } catch (err) {
    console.error('Update plan error:', err);
    res.status(500).json({ error: 'Failed to update plan' });
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

router.put('/admin/users/:id/password', authMiddleware, adminMiddleware, async (req, res) => {   try {     const { password } = req.body;     if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });     const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);     if (!user) return res.status(404).json({ error: 'User not found' });     const passwordHash = await bcrypt.hash(password, 12);     db.prepare('UPDATE users SET password_hash = ?, force_password_change = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, req.params.id);     res.json({ success: true });   } catch (err) {     console.error('Reset password error:', err);     res.status(500).json({ error: 'Failed to reset password' });   } });
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const passwordHash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, req.params.id);
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
    db.exec('DROP TABLE IF EXISTS magic_links; CREATE TABLE magic_links (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    db.prepare('INSERT INTO magic_links (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)').run(uuidv4(), user.id, token, expiresAt);
    const portalUrl = process.env.PORTAL_URL || 'https://aiqs-portal.onrender.com';
    const magicUrl = `${portalUrl}/magic?token=${token}`;
    console.log(`Magic link for ${user.email}: ${magicUrl}`);

    const firstName = (user.full_name || 'there').split(' ')[0];
    const emailSent = await sendEmail({
      to: user.email,
      subject: 'Your AI QS Portal Login Link',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px;">
          <div style="text-align: center; margin-bottom: 32px;">
            <div style="font-size: 28px; font-weight: 800; color: #0F172A;">AI <span style="color: #F59E0B;">QS</span></div>
            <div style="font-size: 10px; letter-spacing: 3px; color: #94A3B8; text-transform: uppercase; margin-top: 2px;">Quantity Surveying</div>
          </div>
          <h2 style="font-size: 20px; color: #0F172A; margin: 0 0 12px;">Hi ${firstName},</h2>
          <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 24px;">
            You've been invited to access the AI QS Portal. Click the button below to log in instantly — no password needed.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${magicUrl}" style="display: inline-block; padding: 14px 36px; background: #F59E0B; color: #0F172A; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 10px;">
              Log In to AI QS Portal
            </a>
          </div>
          <p style="font-size: 13px; color: #94A3B8; line-height: 1.5;">
            This link expires in 24 hours and can only be used once. If you didn't request this, you can safely ignore this email.
          </p>
          <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 28px 0 16px;" />
          <p style="font-size: 11px; color: #CBD5E1; text-align: center;">
            AI QS — Automated Quantity Surveying<br />
            <a href="https://theaiqs.co.uk" style="color: #94A3B8;">theaiqs.co.uk</a> · <a href="https://wa.me/447534808399" style="color: #94A3B8;">WhatsApp</a>
          </p>
        </div>
      `,
    });

    res.json({
      success: true,
      email: user.email,
      magicUrl: magicUrl,
      emailSent: emailSent,
      message: emailSent
        ? `Magic link emailed to ${user.email}`
        : `Magic link generated for ${user.full_name || user.email} (email not configured — link returned).`,
    });
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
      for (const file of req.files) {
        insertFile.run(uuidv4(), projectId, file.filename, file.originalname, path.extname(file.originalname).toLowerCase(), file.size);
      }
    }
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    const files = db.prepare('SELECT * FROM files WHERE project_id = ?').all(projectId);
    if (!isPayg && files.length > 0) triggerPipedream(project, user, files);
    const updatedPlanInfo = getUserPlanInfo(user);

    // ─── LOG: Project submitted ───
    logActivity({
      event_type: 'project_created',
      title: (user.full_name || user.email) + ' submitted a project',
      detail: title + (location ? ' — ' + location : '') + ' (' + (files.length || 0) + ' files)',
      user_id: user.id,
      user_name: user.full_name,
      user_email: user.email,
    });

    // ─── NOTIFY ADMIN: New project submitted ───
    notifyAdmin({
      type: 'new_project',
      title: `New project: ${title}`,
      detail: (user.full_name || user.email) + (location ? ' — ' + location : '') + ' (' + (files.length || 0) + ' files)',
      icon: 'folder-plus',
    });

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
