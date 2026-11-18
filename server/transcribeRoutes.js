// ═══════════════════════════════════════════════════════════════════════════════
// DICTATION — server/transcribeRoutes.js   (mounted at /api/transcribe)
//
//   GET  /api/transcribe/status   { available, provider, enabled }   is server STT set up?
//   POST /api/transcribe          multipart 'audio' (+ context, seconds)
//                                 → { raw, cleaned, seconds, provider }
//
// MAX's microphone: MediaRecorder audio in, speech-to-text (server/stt.js) out.
// A spoken command to MAX goes through as said; a dictated job description
// (context 'estimate') gets a fast tidy-up pass that normalises measurements.
//
// Privacy: multer keeps the upload in memory; it is transcribed and dropped.
// Nothing audio is written to disk or logged, and the text is never logged
// either. usage_log gets one row with the seconds of speech so dictation
// minutes are queryable — not the words.
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const { authMiddleware } = require('./auth');
const rollout = require('./maxRollout');
const stt = require('./stt');

const router = express.Router();
router.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^audio\//.test(file.mimetype || '') || /^video\/(webm|mp4)$/.test(file.mimetype || '')),
});

router.get('/status', (req, res) => {
  // Not on for this account yet → "unavailable", so the mic falls back to the
  // browser's own Web Speech exactly as it does on a server with no STT key.
  const enabled = rollout.isEnabledFor(req.user);
  res.json({ available: enabled && stt.isConfigured(), provider: enabled ? stt.provider() : null, enabled });
});

const CLEANUP_SYSTEM = 'Turn this spoken, rambling description of a building job into a clear written brief. Keep every fact, measurement and material mentioned — never invent or drop details. Normalise spoken measurements ("five by four metres" → "5m x 4m"). Fix mis-transcribed trade terms (DPC, RSJ, Velux, UPVC, screed, soffit, fascia, blockwork, lintel, skim). British English. Output only the cleaned description.';

async function tidy(raw, userId) {
  try {
    const { callModel, MODELS } = require('./anthropicClient');
    const r = await callModel({ model: MODELS.FAST, system: CLEANUP_SYSTEM, cacheSystem: true, messages: [{ role: 'user', content: raw }], maxTokens: 1000, userId, action: 'max', detail: 'dictation_cleanup' });
    const text = r.ok ? String(r.text || '').trim() : '';
    return text || raw;
  } catch (e) { return raw; }
}

function handleUpload(req, res, next) {
  upload.single('audio')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That recording is too long — keep it under a few minutes.' });
      return res.status(400).json({ error: 'That did not look like an audio recording.' });
    }
    next();
  });
}

router.post('/', rollout.requireMax, handleUpload, async (req, res) => {
  if (!stt.isConfigured()) return res.status(503).json({ error: 'dictation_unavailable', code: 'dictation_unavailable' });
  if (!req.file || !req.file.buffer || req.file.buffer.length < 1000) return res.status(400).json({ error: 'No speech was recorded — try again.' });
  const context = String((req.body && req.body.context) || 'max').slice(0, 30);
  const seconds = Math.max(0, Math.min(600, parseInt((req.body && req.body.seconds) || '0', 10) || 0));
  try {
    const { text, provider } = await stt.transcribe(req.file.buffer, req.file.mimetype);
    req.file.buffer = null; // the audio is gone the moment we have the words
    const raw = String(text || '').trim();
    const cleaned = raw && context === 'estimate' ? await tidy(raw, req.user.id) : raw;
    try {
      db.prepare('INSERT INTO usage_log (id, user_id, action, detail, model_used, tokens_in, tokens_out, cost_estimate) VALUES (?, ?, ?, ?, ?, 0, 0, ?)')
        .run(uuidv4(), req.user.id, 'dictation_stt', JSON.stringify({ seconds, context }), provider, Math.round((seconds / 60) * 0.006 * 10000) / 10000);
    } catch (e) { /* metering only */ }
    res.json({ raw, cleaned, seconds, provider });
  } catch (err) {
    if (err instanceof stt.SttError && err.status === 503) return res.status(503).json({ error: 'dictation_unavailable', code: 'dictation_unavailable' });
    console.error('[transcribe] failed:', err && err.message ? err.message.slice(0, 200) : err);
    res.status(502).json({ error: 'Could not transcribe that just now — try again, or type it.' });
  }
});

module.exports = router;
