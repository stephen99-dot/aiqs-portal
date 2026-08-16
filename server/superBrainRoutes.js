// Super Brain routes — admin dashboard feed plus the app-to-app knowledge
// exchange. Mounted under /api by index.js.
//
// The exchange is pull-based: each app fetches the other's /super-brain/export.
// The export endpoint accepts either a signed-in admin or the shared
// SUPER_BRAIN_KEY header, so the sibling app can pull without a user token.
// Everything else is admin-only.
//
// Env:
//   SUPER_BRAIN_KEY      — shared secret, same value on both apps
//   SUPER_BRAIN_PEER_URL — base URL of the sibling app (e.g. https://app.aitradespilot.com)

const express = require('express');
const crypto = require('crypto');
const { authMiddleware, adminMiddleware } = require('./auth');
const db = require('./database');
const superBrain = require('./superBrain');

const router = express.Router();

superBrain.ensureSchema(db);

function keyMatches(given) {
  const key = process.env.SUPER_BRAIN_KEY;
  if (!key || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(key));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Peer apps authenticate with the shared key; humans with an admin session.
function allowPeerOrAdmin(req, res, next) {
  if (keyMatches(req.get('x-brain-key'))) {
    req.brainPeer = req.get('x-brain-app') || 'peer';
    return next();
  }
  return authMiddleware(req, res, () => adminMiddleware(req, res, next));
}

router.get('/super-brain/snapshot', authMiddleware, adminMiddleware, (req, res) => {
  try {
    res.json(superBrain.snapshot(db));
  } catch (e) {
    console.error('[SuperBrain] snapshot error:', e.message);
    res.status(500).json({ error: 'Failed to build brain snapshot' });
  }
});

router.get('/super-brain/export', allowPeerOrAdmin, (req, res) => {
  try {
    const pack = superBrain.exportPack(db);
    if (req.brainPeer) superBrain.logServed(db, { peerApp: req.brainPeer });
    res.json(pack);
  } catch (e) {
    console.error('[SuperBrain] export error:', e.message);
    res.status(500).json({ error: 'Failed to export knowledge pack' });
  }
});

// Manual import — paste or upload a pack from the other app.
router.post('/super-brain/import', authMiddleware, adminMiddleware, (req, res) => {
  try {
    const result = superBrain.importPack(db, req.body, { via: 'manual' });
    res.json(result);
  } catch (e) {
    console.error('[SuperBrain] import error:', e.message);
    res.status(400).json({ error: e.message || 'Failed to import knowledge pack' });
  }
});

// One-click sync — pull the sibling app's pack and import it.
router.post('/super-brain/sync', authMiddleware, adminMiddleware, async (req, res) => {
  const peerUrl = (process.env.SUPER_BRAIN_PEER_URL || '').replace(/\/+$/, '');
  if (!peerUrl) return res.status(400).json({ error: 'SUPER_BRAIN_PEER_URL is not configured' });
  if (!process.env.SUPER_BRAIN_KEY) return res.status(400).json({ error: 'SUPER_BRAIN_KEY is not configured' });
  try {
    const resp = await fetch(peerUrl + '/api/super-brain/export', {
      headers: {
        'x-brain-key': process.env.SUPER_BRAIN_KEY,
        'x-brain-app': superBrain.APP_ID,
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Peer responded ${resp.status}${body ? ': ' + body.slice(0, 200) : ''}`);
    }
    const pack = await resp.json();
    const result = superBrain.importPack(db, pack, { via: 'pull' });
    res.json({ ...result, peer: pack.sourceLabel || pack.source });
  } catch (e) {
    console.error('[SuperBrain] sync error:', e.message);
    res.status(502).json({ error: 'Sync failed: ' + e.message });
  }
});

module.exports = router;
