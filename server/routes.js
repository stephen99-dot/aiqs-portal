const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { generateToken, authMiddleware, adminMiddleware } = require('./auth');

const router = express.Router();

// Admin email -- ONLY this email gets admin role on registration
const ADMIN_EMAIL = 'hello@crmwizardai.com';

// Pipedream webhook URL
const PIPEDREAM_WEBHOOK = process.env.PIPEDREAM_WEBHOOK_URL || 'https://eojsrx5dgazyle8.m.pipedream.net';

// Portal base URL for file serving
const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL || 'https://aiqs-portal.onrender.com';

// Plan definitions
const PLANS = {
  starter:      { label: 'Starter (PAYG)', quota: 0, price: 99 },
  professional: { label: 'Professional',   quota: 10, price: 347 },
  premium:      { label: 'Premium',        quota: 20, price: 447 },
  custom:       { label: 'Custom',         quota: 999, price: 0 },
};

// File upload config -- use persistent disk if available
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

// --- HELPER: Get user's monthly usage ---
function getMonthlyUsage(userId) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const result = db.prepare(`
    SELECT COUNT(*) as count FROM projects
    WHERE user_id = ? AND created_at >= ? AND created_at < ?
  `).get(userId, monthStart, monthEnd);

  return result.count;
}

// --- HELPER: Get user's plan info with usage ---
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
    isPayg: plan === 'starter',
    atLimit: quota > 0 && used >= quota,
  };
}

// --- HELPER: Trigger Pipedream BOQ pipeline ---
async function triggerPipedream(project, user, files) {
  try {
    // Build file URLs that Pipedream can download from
    const fileUrls = files.map(f => ({
      url: `${PORTAL_BASE_URL}/api/files/download/${f.filename}`,
      name: f.original_name,
      fieldName: 'file'
    }));

    const payload = {
      // Source identifier
      source: 'portal',
      projectId: project.id,

      // Fields the normalize step / Generate_Boq reads
      fullName: user.full_name,
      clientEmail: user.email,
      email: user.email,
      projectDetails: project.description || project.title,
      projectType: project.project_type,
      address: project.location || '',
      location: project.location || '',
      company: user.company || '',

      // File data for upload_files_to_drive step
      drawings_urls: fileUrls.map(f => f.url),
      file_urls: fileUrls,
      fileCount: files.length,

      // Metadata
      plan: user.plan || 'starter',
      submittedAt: new Date().toISOString(),
    };

    console.log(`[Pipedream] Triggering pipeline for project: ${project.title} (${files.length} files)`);

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

    // Update project status to in_progress
    db.prepare('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('in_progress', project.id);

    return true;
  } catch (err) {
    console.error('[Pipedream] Failed to trigger pipeline:', err.message);
    return false;
  }
}

// --- FILE DOWNLOAD ROUTE (public - used by Pipedream to fetch files) ---
router.get('/files/download/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Determine content type
  const ext = path.extname(req.params.filename).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.dwg': 'application/octet-stream',
    '.dxf': 'application/octet-stream',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.zip': 'application/zip',
  };

  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  res.sendFile(filePath);
});

// --- AUTH ROUTES ---

router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, fullName, company, phone } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Email, password and full name are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);
    const role = email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'client';

    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, company, phone, role, plan, monthly_quota)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'starter', 0)
    `).run(id, email.toLowerCase(), passwordHash, fullName, company || null, phone || null, role);

    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    const token = generateToken(newUser);
    const planInfo = getUserPlanInfo(newUser);

    res.status(201).json({
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.full_name,
        company: newUser.company,
        phone: newUser.phone,
        role: newUser.role,
        plan: planInfo.plan,
        planLabel: planInfo.planLabel,
        quota: planInfo.quota,
        used: planInfo.used,
        remaining: planInfo.remaining,
        isPayg: planInfo.isPayg,
        atLimit: planInfo.atLimit,
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user);
    const planInfo = getUserPlanInfo(user);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        company: user.company,
        phone: user.phone,
        role: user.role,
        plan: planInfo.plan,
        planLabel: planInfo.planLabel,
        quota: planInfo.quota,
        used: planInfo.used,
        remaining: planInfo.remaining,
        isPayg: planInfo.isPayg,
        atLimit: planInfo.atLimit,
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const planInfo = getUserPlanInfo(user);

  res.json({
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    company: user.company,
    phone: user.phone,
    role: user.role,
    plan: planInfo.plan,
    planLabel: planInfo.planLabel,
    quota: planInfo.quota,
    used: planInfo.used,
    remaining: planInfo.remaining,
    isPayg: planInfo.isPayg,
    atLimit: planInfo.atLimit,
  });
});

// --- USAGE ENDPOINT ---

router.get('/usage', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const planInfo = getUserPlanInfo(user);

  // Get this month's projects for the usage list
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const monthProjects = db.prepare(`
    SELECT id, title, project_type, status, created_at FROM projects
    WHERE user_id = ? AND created_at >= ? AND created_at < ?
    ORDER BY created_at DESC
  `).all(req.user.id, monthStart, monthEnd);

  res.json({
    ...planInfo,
    monthProjects,
    monthName: now.toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
  });
});

// --- ADMIN ROUTES ---

router.get('/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  res.json(users.map(u => {
    const planInfo = getUserPlanInfo(u);
    return {
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      company: u.company,
      phone: u.phone,
      role: u.role,
      plan: planInfo.plan,
      planLabel: planInfo.planLabel,
      quota: planInfo.quota,
      used: planInfo.used,
      remaining: planInfo.remaining,
      atLimit: planInfo.atLimit,
      createdAt: u.created_at,
    };
  }));
});

// Admin: Update a user's plan
router.put('/admin/users/:id/plan', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const { plan, monthlyQuota } = req.body;

    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan. Must be: starter, professional, premium, or custom' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Use provided quota or default from plan
    const quota = monthlyQuota !== undefined ? monthlyQuota : PLANS[plan].quota;

    db.prepare('UPDATE users SET plan = ?, monthly_quota = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(plan, quota, req.params.id);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    const planInfo = getUserPlanInfo(updated);

    res.json({
      id: updated.id,
      email: updated.email,
      fullName: updated.full_name,
      plan: planInfo.plan,
      planLabel: planInfo.planLabel,
      quota: planInfo.quota,
      used: planInfo.used,
      remaining: planInfo.remaining,
    });
  } catch (err) {
    console.error('Update plan error:', err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

router.get('/admin/projects', authMiddleware, adminMiddleware, (req, res) => {
  const projects = db.prepare(`
    SELECT p.*, u.full_name as client_name, u.email as client_email, COUNT(f.id) as file_count
    FROM projects p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN files f ON f.project_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all();
  res.json(projects.map(p => ({
    id: p.id,
    title: p.title,
    projectType: p.project_type,
    description: p.description,
    location: p.location,
    status: p.status,
    clientName: p.client_name,
    clientEmail: p.client_email,
    fileCount: p.file_count,
    createdAt: p.created_at
  })));
});

// --- PROJECT ROUTES ---

router.get('/projects', authMiddleware, (req, res) => {
  const projects = db.prepare(`
    SELECT p.*, COUNT(f.id) as file_count
    FROM projects p
    LEFT JOIN files f ON f.project_id = p.id
    WHERE p.user_id = ?
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all(req.user.id);

  res.json(projects.map(p => ({
    ...p,
    fullName: undefined,
    fileCount: p.file_count
  })));
});

router.get('/projects/:id', authMiddleware, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);

  if (!project) return res.status(404).json({ error: 'Project not found' });

  const files = db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC')
    .all(project.id);

  res.json({ ...project, files });
});

router.post('/projects', authMiddleware, upload.array('drawings', 10), (req, res) => {
  try {
    const { title, projectType, description, location } = req.body;

    if (!title || !projectType) {
      return res.status(400).json({ error: 'Project title and type are required' });
    }

    // --- USAGE LIMIT CHECK ---
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const planInfo = getUserPlanInfo(user);

    if (planInfo.atLimit) {
      return res.status(403).json({
        error: 'Monthly project limit reached',
        code: 'LIMIT_REACHED',
        usage: planInfo,
      });
    }

    // Determine if this is a PAYG submission
    const isPayg = req.body.payg === 'true' || planInfo.isPayg;
    const initialStatus = isPayg ? 'awaiting_payment' : 'submitted';

    const projectId = uuidv4();

    db.prepare(`
      INSERT INTO projects (id, user_id, title, project_type, description, location, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(projectId, req.user.id, title, projectType, description || null, location || null, initialStatus);

    if (req.files && req.files.length > 0) {
      const insertFile = db.prepare(`
        INSERT INTO files (id, project_id, filename, original_name, file_type, file_size)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const file of req.files) {
        insertFile.run(
          uuidv4(),
          projectId,
          file.filename,
          file.originalname,
          path.extname(file.originalname).toLowerCase(),
          file.size
        );
      }
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    const files = db.prepare('SELECT * FROM files WHERE project_id = ?').all(projectId);

    // Trigger Pipedream pipeline for subscription users (not PAYG - they trigger after payment)
    if (!isPayg && files.length > 0) {
      triggerPipedream(project, user, files);
    }

    // Return updated usage info with the project
    const updatedPlanInfo = getUserPlanInfo(user);

    res.status(201).json({ ...project, files, usage: updatedPlanInfo });
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

router.post('/projects/:id/files', authMiddleware, upload.array('drawings', 10), (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);

  if (!project) return res.status(404).json({ error: 'Project not found' });

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const insertFile = db.prepare(`
    INSERT INTO files (id, project_id, filename, original_name, file_type, file_size)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const newFiles = [];
  for (const file of req.files) {
    const fileId = uuidv4();
    insertFile.run(fileId, project.id, file.filename, file.originalname,
      path.extname(file.originalname).toLowerCase(), file.size);
    newFiles.push({ id: fileId, filename: file.filename, originalName: file.originalname });
  }

  res.status(201).json({ files: newFiles });
});

// --- ACTIVATE PROJECT (after PAYG payment) ---
router.post('/projects/:id/activate', authMiddleware, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.status !== 'awaiting_payment') {
      // Already activated or in another state — just return it
      return res.json(project);
    }

    // Mark as submitted (paid)
    db.prepare('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('submitted', project.id);

    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
    const files = db.prepare('SELECT * FROM files WHERE project_id = ?').all(project.id);

    // Trigger Pipedream pipeline now that payment is confirmed
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (files.length > 0) {
      triggerPipedream(updated, user, files);
    }

    res.json({ ...updated, files });
  } catch (err) {
    console.error('Activate project error:', err);
    res.status(500).json({ error: 'Failed to activate project' });
  }
});

module.exports = router;
