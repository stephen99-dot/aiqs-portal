const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./database');

// Never sign production tokens with a publicly-known secret. If JWT_SECRET is
// unset in production we fall back to a strong random per-boot secret (and warn
// loudly) — sessions reset on restart, but tokens can't be forged. In dev a
// stable secret keeps you logged in across restarts.
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    console.error('[auth] WARNING: JWT_SECRET is not set. Using a random secret for this process — set JWT_SECRET in the environment so sessions persist across restarts.');
  } else {
    JWT_SECRET = 'dev-secret-change-in-production';
  }
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role || 'client' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  var token = null;
  if (req.headers.authorization) token = req.headers.authorization.replace('Bearer ', '');
  else if (req.cookies && req.cookies.token) token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    var decoded = jwt.verify(token, JWT_SECRET);
    var freshUser = db.prepare(
      'SELECT id, email, role, plan, suspended, suspended_reason, bonus_messages, bonus_docs, monthly_quota, monthly_boq_quota, full_name, company, has_estimator FROM users WHERE id = ?'
    ).get(decoded.id);
    if (!freshUser) return res.status(401).json({ error: 'User not found' });
    req.user = freshUser;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Estimator add-on gate. Admins always pass through so they can test the flow.
function requireEstimator(req, res, next) {
  if (req.user.role === 'admin') return next();
  if (!req.user.has_estimator) {
    return res.status(403).json({
      error: 'Estimator add-on not enabled on this account. Contact support to enable it.',
      code: 'ESTIMATOR_DISABLED',
    });
  }
  next();
}

// Office in a Box is now a paid product gated by has_estimator (see
// requireEstimator). The old beta password lock is retired: this middleware is
// kept as a no-op so the routes that reference it keep working, but it no longer
// asks for ESTIMATOR_PASSWORD or blocks anyone.
function requireEstimatorPassword(req, res, next) {
  next();
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

module.exports = { generateToken, authMiddleware, adminMiddleware, requireEstimator, requireEstimatorPassword };
