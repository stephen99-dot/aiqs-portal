const jwt = require('jsonwebtoken');
const db = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

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

// Temporary password lock — applies to everyone, including admins. Set
// ESTIMATOR_PASSWORD in the environment to turn it on; if it's not set,
// the estimator is locked entirely (fail safe).
function requireEstimatorPassword(req, res, next) {
  const expected = process.env.ESTIMATOR_PASSWORD;
  if (!expected) {
    return res.status(503).json({
      error: 'Estimator is temporarily locked. Set ESTIMATOR_PASSWORD on the server to enable it.',
      code: 'ESTIMATOR_LOCKED',
    });
  }
  const provided = req.headers['x-estimator-key']
    || (req.query && req.query.estimator_key)
    || '';
  if (!provided || !safeEqual(String(provided), String(expected))) {
    return res.status(403).json({
      error: 'Estimator password required.',
      code: 'ESTIMATOR_PASSWORD_REQUIRED',
    });
  }
  next();
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

module.exports = { generateToken, authMiddleware, adminMiddleware, requireEstimator, requireEstimatorPassword };
