const express = require('express');
const { authMiddleware } = require('./auth');
const db = require('./database');
const router = express.Router();

router.get('/projects', authMiddleware, function(req, res) {
  try {
    var isAdmin = req.user.role === 'admin';
    var projects = isAdmin
      ? db.prepare('SELECT cp.*, u.full_name, u.email, u.company FROM chat_projects cp LEFT JOIN users u ON cp.user_id = u.id ORDER BY cp.created_at DESC').all()
      : db.prepare('SELECT * FROM chat_projects WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json({ projects: projects });
  } catch(e) { console.error('[Projects]', e); res.status(500).json({ error: 'Failed to load projects' }); }
});

router.get('/projects/:id', authMiddleware, function(req, res) {
  try {
    var project = db.prepare('SELECT * FROM chat_projects WHERE id = ? AND (user_id = ? OR ? = 1)').get(req.params.id, req.user.id, req.user.role === 'admin' ? 1 : 0);
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json({ project: project });
  } catch(e) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/usage', authMiddleware, function(req, res) {
  try {
    var isAdmin = req.user.role === 'admin';
    var userId = req.user.id;
    var d = new Date(); d.setDate(1); d.setHours(0,0,0,0);
    var monthStr = d.toISOString();
    var stats = {};

    if (isAdmin) {
      stats.total_messages = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE action='chat_message'").get().c;
      stats.total_docs = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE action='doc_generated'").get().c;
      stats.total_cost = db.prepare("SELECT COALESCE(SUM(cost_estimate),0) as t FROM usage_log").get().t;
      stats.month_messages = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE action='chat_message' AND created_at >= ?").get(monthStr).c;
      stats.month_docs = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE action='doc_generated' AND created_at >= ?").get(monthStr).c;
      stats.month_cost = db.prepare("SELECT COALESCE(SUM(cost_estimate),0) as t FROM usage_log WHERE created_at >= ?").get(monthStr).t;
      stats.by_client = db.prepare("SELECT u.full_name, u.email, u.company, COUNT(CASE WHEN ul.action='chat_message' THEN 1 END) as messages, COUNT(CASE WHEN ul.action='doc_generated' THEN 1 END) as docs, COALESCE(SUM(ul.tokens_in),0) as tokens_in, COALESCE(SUM(ul.tokens_out),0) as tokens_out, COALESCE(SUM(ul.cost_estimate),0) as cost, MAX(ul.created_at) as last_active FROM usage_log ul JOIN users u ON ul.user_id = u.id GROUP BY ul.user_id ORDER BY cost DESC").all();
      stats.rate_training = db.prepare("SELECT u.full_name, u.email, u.company, COUNT(r.id) as total_rates, ROUND(AVG(r.confidence),2) as avg_confidence, SUM(r.times_confirmed) as total_corrections FROM users u LEFT JOIN client_rate_library r ON u.id = r.user_id AND r.is_active = 1 WHERE u.role != 'admin' GROUP BY u.id ORDER BY total_rates DESC").all();
    } else {
      stats.total_messages = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='chat_message'").get(userId).c;
      stats.total_docs = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_generated'").get(userId).c;
      stats.month_messages = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='chat_message' AND created_at>=?").get(userId, monthStr).c;
      stats.month_docs = db.prepare("SELECT COUNT(*) as c FROM usage_log WHERE user_id=? AND action='doc_generated' AND created_at>=?").get(userId, monthStr).c;
      stats.total_rates = db.prepare("SELECT COUNT(*) as c FROM client_rate_library WHERE user_id=? AND is_active=1").get(userId).c;
      stats.avg_confidence = db.prepare("SELECT ROUND(AVG(confidence),2) as c FROM client_rate_library WHERE user_id=? AND is_active=1").get(userId).c || 0;
    }
    stats.recent = isAdmin
      ? db.prepare("SELECT ul.*, u.full_name, u.email FROM usage_log ul JOIN users u ON ul.user_id=u.id ORDER BY ul.created_at DESC LIMIT 50").all()
      : db.prepare("SELECT * FROM usage_log WHERE user_id=? ORDER BY created_at DESC LIMIT 30").all(userId);
    res.json(stats);
  } catch(e) { console.error('[Usage]', e); res.status(500).json({ error: 'Failed to load usage' }); }
});

// Admin: suspend/unsuspend account
router.post('/admin/suspend/:userId', authMiddleware, function(req, res) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var reason = req.body.reason || null;
  var result = db.prepare('UPDATE users SET suspended = 1, suspended_reason = ? WHERE id = ? AND role != ?').run(reason, req.params.userId, 'admin');
  if (result.changes === 0) return res.status(404).json({ error: 'User not found or is admin' });
  console.log('[Admin] Suspended user ' + req.params.userId + ': ' + (reason || 'no reason'));
  res.json({ success: true, message: 'Account suspended' });
});

router.post('/admin/unsuspend/:userId', authMiddleware, function(req, res) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('UPDATE users SET suspended = 0, suspended_reason = NULL WHERE id = ?').run(req.params.userId);
  console.log('[Admin] Unsuspended user ' + req.params.userId);
  res.json({ success: true, message: 'Account reactivated' });
});

// Admin: add bonus messages or doc credits
router.post('/admin/credit/:userId', authMiddleware, function(req, res) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var messages = parseInt(req.body.bonus_messages) || 0;
  var docs = parseInt(req.body.bonus_docs) || 0;
  if (messages === 0 && docs === 0) return res.status(400).json({ error: 'Specify bonus_messages or bonus_docs' });
  var user = db.prepare('SELECT id, email, bonus_messages, bonus_docs FROM users WHERE id = ?').get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  var newMsgs = (user.bonus_messages || 0) + messages;
  var newDocs = (user.bonus_docs || 0) + docs;
  db.prepare('UPDATE users SET bonus_messages = ?, bonus_docs = ? WHERE id = ?').run(newMsgs, newDocs, req.params.userId);
  // Log the credit
  if (messages > 0) db.prepare('INSERT INTO usage_log (id, user_id, action, detail) VALUES (?, ?, ?, ?)').run('ul_' + require('uuid').v4().slice(0, 8), req.params.userId, 'admin_credit', 'Added ' + messages + ' bonus messages by admin');
  if (docs > 0) db.prepare('INSERT INTO usage_log (id, user_id, action, detail) VALUES (?, ?, ?, ?)').run('ul_' + require('uuid').v4().slice(0, 8), req.params.userId, 'admin_credit', 'Added ' + docs + ' bonus doc credits by admin');
  console.log('[Admin] Credited ' + user.email + ': +' + messages + ' msgs, +' + docs + ' docs');
  res.json({ success: true, email: user.email, bonus_messages: newMsgs, bonus_docs: newDocs });
});

// Admin: change user plan
router.post('/admin/change-plan/:userId', authMiddleware, function(req, res) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  var plan = req.body.plan;
  if (!['starter', 'professional', 'premium'].includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
  var result = db.prepare('UPDATE users SET plan = ? WHERE id = ? AND role != ?').run(plan, req.params.userId, 'admin');
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  console.log('[Admin] Changed plan for ' + req.params.userId + ' to ' + plan);
  res.json({ success: true, plan: plan });
});

// Admin: grant a paid doc credit (for Starter users who pay outside Stripe)
router.post('/admin/grant-doc/:userId', authMiddleware, function(req, res) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  db.prepare('INSERT INTO usage_log (id, user_id, action, detail) VALUES (?, ?, ?, ?)').run('ul_' + require('uuid').v4().slice(0, 8), req.params.userId, 'doc_paid', 'Manual credit by admin');
  console.log('[Admin] Granted doc credit to ' + req.params.userId);
  res.json({ success: true, message: 'Document credit granted' });
});

module.exports = router;
