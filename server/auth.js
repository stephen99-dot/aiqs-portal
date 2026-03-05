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
      'SELECT id, email, role, plan, suspended, suspended_reason, bonus_messages, bonus_docs, monthly_quota, full_name, company FROM users WHERE id = ?'
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

module.exports = { generateToken, authMiddleware, adminMiddleware };
