// ═══ How-to videos — server/learnRoutes.js   (mounted at /api/learn) ═════════
//
//   GET  /api/learn                 the videos (with when this account watched
//                                   each), the next steps, and the progress
//   POST /api/learn/:key/watched    { watched: true|false } tick one off
//   POST /api/learn/intro/seen      the one-time pointer to the videos has been shown
//
// The video files themselves are static: /videos/<key>.mp4 and .jpg.

const express = require('express');
const { authMiddleware } = require('./auth');
const learn = require('./learn');

const router = express.Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  try {
    res.json({ videos: learn.videosFor(req.user.id), next: learn.nextSteps(req.user), progress: learn.progress(req.user.id), entitlements: learn.entitlementsFor(req.user), intro_seen: learn.introSeen(req.user.id) });
  } catch (err) { console.error('[learn] list error:', err); res.status(500).json({ error: 'Could not load the videos.' }); }
});

router.post('/intro/seen', (req, res) => {
  try { learn.markIntro(req.user.id); res.json({ ok: true, intro_seen: true }); }
  catch (err) { console.error('[learn] intro error:', err); res.status(500).json({ error: 'Could not save that.' }); }
});

router.post('/:key/watched', (req, res) => {
  try {
    const key = String(req.params.key || '').slice(0, 40);
    const watched = !(req.body && req.body.watched === false);
    const at = learn.setWatched(req.user.id, key, watched);
    res.json({ key, watched_at: at, progress: learn.progress(req.user.id) });
  } catch (err) {
    if (err && err.status === 404) return res.status(404).json({ error: err.message });
    console.error('[learn] watched error:', err); res.status(500).json({ error: 'Could not save that.' });
  }
});

module.exports = router;
