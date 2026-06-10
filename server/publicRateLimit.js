// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC RATE LIMIT — server/publicRateLimit.js
//
// Tiny in-memory per-IP fixed-window limiter for the UNAUTHENTICATED public
// routes (quote acceptance, variation approval). Its job is to make token
// enumeration impractical and stop form spam — the tokens themselves carry
// ~190 bits of entropy, so this is belt and braces. Single-instance deploy
// (Render, one process) means in-memory state is fine.
// ═══════════════════════════════════════════════════════════════════════════════

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
    || req.ip
    || req.connection?.remoteAddress
    || 'unknown';
}

function rateLimit({ windowMs = 60_000, max = 60 } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of hits) {
      if (bucket.resetAt <= now) hits.delete(ip);
    }
  }, windowMs);
  if (sweeper.unref) sweeper.unref();

  return function rateLimitMiddleware(req, res, next) {
    const ip = clientIp(req);
    const now = Date.now();
    let bucket = hits.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      hits.set(ip, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many requests — please wait a minute and try again.' });
    }
    next();
  };
}

module.exports = { rateLimit, clientIp };
