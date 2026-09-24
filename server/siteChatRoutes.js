// ═══════════════════════════════════════════════════════════════════════════════
// SITE CHAT ROUTES — server/siteChatRoutes.js
//
// The endpoint behind the chat widget on theaiqs.co.uk. The marketing site is
// hosted on Hostinger and this API on Render, so it is cross-origin (the global
// cors({ origin: true }) in index.js covers it) and — by design — unauthenticated:
// the whole point is that a stranger can ask a question before signing up.
//
//   POST /api/public/site-chat   { messages: [{ role, content }], market? } -> { reply }
//
// Because it is open and it spends money on every call, it is fenced in:
//   - per-IP rate limit, tighter than the other public routes
//   - the transcript is re-sanitised server-side every turn (siteChat.js)
//   - the cheapest model in the registry, with a small output ceiling
//   - no database writes, no PII stored, nothing logged but a failure reason
// ═══════════════════════════════════════════════════════════════════════════════

const express = require('express');
const { callModel, MODELS } = require('./anthropicClient');
const { SYSTEM_PROMPT, sanitiseHistory, marketNote, FALLBACK_REPLY } = require('./siteChat');
const { rateLimit } = require('./publicRateLimit');

const router = express.Router();

// A real conversation is a handful of messages a minute. 15 leaves room for an
// enthusiastic visitor while making the endpoint useless as free model access.
router.use(rateLimit({ windowMs: 60_000, max: 15 }));

const MAX_REPLY_TOKENS = 600;

router.post('/site-chat', async (req, res) => {
  const messages = sanitiseHistory(req.body && req.body.messages);
  if (!messages.length) {
    return res.status(400).json({ error: 'Ask me a question and I will do my best to answer it.' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[siteChat] ANTHROPIC_API_KEY is not set — serving the fallback reply');
    return res.json({ reply: FALLBACK_REPLY, degraded: true });
  }

  // The shared prompt is cached on its own; the per-visitor country note goes
  // after the cache breakpoint so every visitor still reads the prompt from cache.
  const note = marketNote(req.body && req.body.market);
  const system = note
    ? [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }, { type: 'text', text: note }]
    : SYSTEM_PROMPT;

  try {
    const result = await callModel({
      model: MODELS.FAST,
      system,
      messages,
      maxTokens: MAX_REPLY_TOKENS,
      temperature: 0.4,
      // The system prompt is byte-identical on every call, so it reads from
      // cache instead of being re-billed for each visitor turn.
      cacheSystem: !note,
      action: 'site_chat',
      maxAttempts: 2,
    });

    if (!result.ok || !result.text) {
      console.error('[siteChat] model call failed:', result.status || 'empty reply');
      return res.json({ reply: FALLBACK_REPLY, degraded: true });
    }

    return res.json({ reply: result.text });
  } catch (err) {
    console.error('[siteChat] unexpected error:', err.message);
    return res.json({ reply: FALLBACK_REPLY, degraded: true });
  }
});

module.exports = router;
