// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK ROUTES — server/webhookRoutes.js
// Handles incoming Pipedream webhooks for auto-account creation
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

// ─── Webhook secret for Pipedream verification ──────────────────────────────
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'aiqs-webhook-secret-change-me';
const PORTAL_URL = process.env.PORTAL_URL || 'https://aiqs-portal.onrender.com';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'hello@crmwizardai.com';

// ─── Generate a readable password ───────────────────────────────────────────
function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// ─── Generate magic link token ──────────────────────────────────────────────
function generateMagicToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Send welcome email via SendGrid ────────────────────────────────────────
async function sendWelcomeEmail({ email, fullName, password, magicLink, projectTitle }) {
  if (!SENDGRID_API_KEY) {
    console.log('⚠️  No SENDGRID_API_KEY set — skipping email. Would have sent to:', email);
    console.log('   Magic link:', magicLink);
    console.log('   Password:', password);
    return;
  }

  const htmlContent = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #0A0F1C; color: #E8EDF5; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #0A1628 0%, #132044 100%); padding: 40px 32px 32px; text-align: center;">
        <div style="display: inline-flex; align-items: center; gap: 10px; margin-bottom: 20px;">
          <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #2563EB, #60A5FA); border-radius: 10px; display: flex; align-items: center; justify-content: center;">
            <span style="color: white; font-weight: 800; font-size: 18px;">QS</span>
          </div>
          <span style="font-size: 22px; font-weight: 700; color: #E8EDF5;">CRM Wizard AI</span>
        </div>
        <h1 style="margin: 0; font-size: 26px; font-weight: 800; color: #FFFFFF;">Your BOQ is Ready! 🎉</h1>
      </div>
      
      <div style="padding: 32px;">
        <p style="font-size: 16px; color: #94A3B8; line-height: 1.6; margin: 0 0 20px;">
          Hi ${fullName || 'there'},
        </p>
        <p style="font-size: 16px; color: #94A3B8; line-height: 1.6; margin: 0 0 24px;">
          Great news — your Bill of Quantities for <strong style="color: #E8EDF5;">${projectTitle}</strong> has been processed and is ready to view in your portal.
        </p>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${magicLink}" style="display: inline-block; padding: 14px 36px; background: #2563EB; color: #FFFFFF; text-decoration: none; border-radius: 10px; font-size: 16px; font-weight: 700; box-shadow: 0 4px 16px rgba(37,99,235,0.4);">
            View Your BOQ →
          </a>
        </div>

        <div style="background: #111827; border: 1px solid #1C2A44; border-radius: 10px; padding: 20px; margin: 24px 0;">
          <p style="margin: 0 0 12px; font-size: 13px; font-weight: 600; color: #5A6E87; text-transform: uppercase; letter-spacing: 0.05em;">Your Login Details</p>
          <p style="margin: 0 0 8px; font-size: 15px; color: #E8EDF5;">
            <strong>Email:</strong> ${email}
          </p>
          <p style="margin: 0 0 8px; font-size: 15px; color: #E8EDF5;">
            <strong>Password:</strong> ${password}
          </p>
          <p style="margin: 0; font-size: 12px; color: #5A6E87;">
            You can change your password after logging in.
          </p>
        </div>

        <div style="background: rgba(37,99,235,0.08); border: 1px solid rgba(37,99,235,0.2); border-radius: 10px; padding: 18px; margin: 24px 0;">
          <p style="margin: 0; font-size: 14px; color: #60A5FA; font-weight: 600;">
            🎁 You have 1 free project credit!
          </p>
          <p style="margin: 6px 0 0; font-size: 13px; color: #94A3B8;">
            Upload your next project directly through the portal — it's on us.
          </p>
        </div>

        <p style="font-size: 14px; color: #5A6E87; line-height: 1.6; margin: 24px 0 0;">
          Portal: <a href="${PORTAL_URL}" style="color: #2563EB; text-decoration: none;">${PORTAL_URL}</a>
        </p>
        
        <p style="font-size: 14px; color: #5A6E87; line-height: 1.6; margin: 8px 0 0;">
          Questions? WhatsApp us anytime — the link is in your dashboard.
        </p>
      </div>

      <div style="padding: 20px 32px; border-top: 1px solid #1C2A44; text-align: center;">
        <p style="margin: 0; font-size: 12px; color: #3B4D66;">
          CRM Wizard AI — AI-Powered Quantity Surveying
        </p>
      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email, name: fullName }] }],
        from: { email: FROM_EMAIL, name: 'CRM Wizard AI' },
        subject: `Your BOQ for ${projectTitle} is Ready — View Now`,
        content: [{ type: 'text/html', value: htmlContent }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('SendGrid error:', err);
    } else {
      console.log('✅ Welcome email sent to:', email);
    }
  } catch (err) {
    console.error('Email send error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/webhook/new-project
// Called by Pipedream after processing a BOQ from an emailed-in project
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/webhook/new-project', async (req, res) => {
  try {
    // Verify webhook secret
    const secret = req.headers['x-webhook-secret'] || req.body.webhook_secret;
    if (secret !== WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const {
      sender_email,
      sender_name,
      company,
      project_title,
      project_type,
      project_description,
      project_location,
      boq_data,       // optional: the processed BOQ JSON
      files,          // optional: array of { filename, url, type }
    } = req.body;

    if (!sender_email) {
      return res.status(400).json({ error: 'sender_email is required' });
    }

    const email = sender_email.toLowerCase().trim();
    const fullName = sender_name || email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // ─── Find or create user ────────────────────────────────────────
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    let isNewUser = false;
    let plainPassword = null;

    if (!user) {
      // New user — auto-create account
      isNewUser = true;
      plainPassword = generatePassword(10);
      const passwordHash = await bcrypt.hash(plainPassword, 12);
      const userId = uuidv4();

      db.prepare(`
        INSERT INTO users (id, email, password_hash, full_name, company, phone, role, free_credits, total_projects)
        VALUES (?, ?, ?, ?, ?, NULL, 'client', 1, 0)
      `).run(userId, email, passwordHash, fullName, company || null);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      console.log('✅ Auto-created user:', email, '| Password:', plainPassword);
    }

    // ─── Create the project ─────────────────────────────────────────
    const projectId = uuidv4();
    const title = project_title || 'Email Submission — ' + new Date().toLocaleDateString('en-GB');

    db.prepare(`
      INSERT INTO projects (id, user_id, title, project_type, description, location, status, source)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', 'email')
    `).run(
      projectId, user.id, title,
      project_type || 'general',
      project_description || 'Submitted via email to hello@crmwizardai.com',
      project_location || null
    );

    // Store BOQ data if provided
    if (boq_data) {
      db.prepare(`
        INSERT OR REPLACE INTO project_data (project_id, data_type, data)
        VALUES (?, 'boq', ?)
      `).run(projectId, typeof boq_data === 'string' ? boq_data : JSON.stringify(boq_data));
    }

    // Update user's total project count
    db.prepare('UPDATE users SET total_projects = total_projects + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    // ─── Generate magic link ────────────────────────────────────────
    const magicToken = generateMagicToken();
    const magicExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    db.prepare(`
      INSERT INTO magic_links (token, user_id, project_id, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(magicToken, user.id, projectId, magicExpiry);

    const magicLink = `${PORTAL_URL}/magic/${magicToken}`;

    // ─── Send welcome email ─────────────────────────────────────────
    if (isNewUser && plainPassword) {
      await sendWelcomeEmail({
        email,
        fullName,
        password: plainPassword,
        magicLink,
        projectTitle: title,
      });
    } else {
      // Existing user — send a simpler "new project ready" email
      await sendWelcomeEmail({
        email,
        fullName: user.full_name,
        password: '(use your existing password)',
        magicLink,
        projectTitle: title,
      });
    }

    res.status(201).json({
      success: true,
      isNewUser,
      userId: user.id,
      projectId,
      magicLink,
      message: isNewUser
        ? `New user created and welcome email sent to ${email}`
        : `Project added for existing user ${email}`,
    });

  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed', details: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/magic/:token — Magic link login
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/magic/:token', (req, res) => {
  try {
    const { token } = req.params;

    const link = db.prepare(`
      SELECT ml.*, u.email, u.full_name, u.role, u.suspended, u.suspended_reason
      FROM magic_links ml
      JOIN users u ON u.id = ml.user_id
      WHERE ml.token = ? AND ml.expires_at > datetime('now') AND ml.used = 0
    `).get(token);

    if (!link) {
      return res.status(404).json({ error: 'Invalid or expired magic link' });
    }

    if (link.suspended) {
      return res.status(403).json({ error: 'Your account has been suspended. Contact support for assistance.', suspended: true, reason: link.suspended_reason || null });
    }

    // Mark as used
    db.prepare('UPDATE magic_links SET used = 1, used_at = CURRENT_TIMESTAMP WHERE token = ?').run(token);

    // Generate JWT for the user
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'aiqs-secret-key-change-in-production';

    const authToken = jwt.sign(
      { id: link.user_id, email: link.email, role: link.role || 'client' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token: authToken,
      projectId: link.project_id,
      user: {
        id: link.user_id,
        email: link.email,
        fullName: link.full_name,
        role: link.role || 'client',
      },
    });
  } catch (err) {
    console.error('Magic link error:', err);
    res.status(500).json({ error: 'Failed to process magic link' });
  }
});

module.exports = router;
