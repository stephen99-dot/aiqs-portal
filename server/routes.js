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
      INSERT INTO users (id, email, password_hash, full_name, company, phone, role)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, email.toLowerCase(), passwordHash, fullName, company || null, phone || null, role);

    const newUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    const token = generateToken(newUser);

    res.status(201).json({
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.full_name,
        company: newUser.company,
        phone: newUser.phone,
        role: newUser.role
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

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        company: user.company,
        phone: user.phone,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/auth/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, email, full_name, company, phone, role FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    company: user.company,
    phone: user.phone,
    role: user.role
  });
});

// --- ADMIN ROUTES ---

router.get('/admin/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.prepare('SELECT id, email, full_name, company, phone, role, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users.map(u => ({
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    company: u.company,
    phone: u.phone,
    role: u.role,
    createdAt: u.created_at
  })));
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

    const projectId = uuidv4();

    db.prepare(`
      INSERT INTO projects (id, user_id, title, project_type, description, location)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(projectId, req.user.id, title, projectType, description || null, location || null);

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

    res.status(201).json({ ...project, files });
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

module.exports = router;
