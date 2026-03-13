// ═══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT ROUTES (Admin Only)
// server/userRoutes.js
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

// ─── Middleware: Require Admin Role ──────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ─── GET /api/admin/users — List all users ──────────────────────────────────
router.get('/users', requireAdmin, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT 
        u.id, u.email, u.full_name, u.company, u.phone, u.role, u.created_at, u.updated_at,
        COUNT(p.id) as project_count
      FROM users u
      LEFT JOIN projects p ON p.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `).all();

    res.json({ users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── POST /api/admin/users — Create a new user ─────────────────────────────
router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { email, password, fullName, company, phone, role } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }

    // Check if email already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Validate role
    const validRoles = ['admin', 'client'];
    const userRole = validRoles.includes(role) ? role : 'client';

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);

    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, company, phone, role)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, email.toLowerCase(), passwordHash, fullName, company || null, phone || null, userRole);

    const user = db.prepare('SELECT id, email, full_name, company, phone, role, created_at FROM users WHERE id = ?').get(id);

    res.status(201).json({ user });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// ─── PUT /api/admin/users/:id — Update a user ──────────────────────────────
router.put('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, company, phone, role, password } = req.body;

    // Check user exists
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent demoting yourself
    if (id === req.user.id && role && role !== 'admin') {
      return res.status(400).json({ error: 'Cannot remove your own admin access' });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];

    if (fullName) { updates.push('full_name = ?'); values.push(fullName); }
    if (company !== undefined) { updates.push('company = ?'); values.push(company || null); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone || null); }
    if (role && ['admin', 'client'].includes(role)) { updates.push('role = ?'); values.push(role); }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      updates.push('password_hash = ?');
      values.push(hash);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    if (updates.length > 1) {
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const user = db.prepare('SELECT id, email, full_name, company, phone, role, created_at, updated_at FROM users WHERE id = ?').get(id);

    res.json({ user });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ─── DELETE /api/admin/users/:id — Delete a user ────────────────────────────
router.delete('/users/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check user exists
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user's files first (foreign key constraint)
    db.prepare(`
      DELETE FROM files WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)
    `).run(id);

    // Delete user's projects
    db.prepare('DELETE FROM projects WHERE user_id = ?').run(id);

    // Delete the user
    db.prepare('DELETE FROM users WHERE id = ?').run(id);

    res.json({ message: 'User deleted successfully', deletedId: id });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ─── PUT /api/admin/users/:id/role — Quick role change ─────────────────────
router.put('/users/:id/role', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['admin', 'client'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or client' });
    }

    // Prevent demoting yourself
    if (id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'Cannot remove your own admin access' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(role, id);

    res.json({ message: `User role updated to ${role}` });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// ─── POST /api/admin/users/:id/message — Send a message to a user ───────────
router.post('/users/:id/message', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const { v4: uuidv4 } = require('uuid');
    const msgId = uuidv4();
    db.prepare('INSERT INTO user_messages (id, user_id, message) VALUES (?, ?, ?)').run(msgId, id, message.trim());
    res.json({ id: msgId, message: message.trim() });
  } catch (err) {
    console.error('Send user message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ─── GET /api/admin/users/:id/messages — Get all messages for a user ────────
router.get('/users/:id/messages', requireAdmin, (req, res) => {
  try {
    const messages = db.prepare('SELECT * FROM user_messages WHERE user_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ─── DELETE /api/admin/users/:id/messages/:msgId — Delete a message ─────────
router.delete('/users/:id/messages/:msgId', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM user_messages WHERE id = ? AND user_id = ?').run(req.params.msgId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

module.exports = router;
