const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const router = express.Router();

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// Simple rate limiter — 20 requests per IP per hour
const limiter = {};
function checkRate(ip) {
  const now = Date.now();
  if (!limiter[ip]) limiter[ip] = [];
  limiter[ip] = limiter[ip].filter(t => now - t < 3600000);
  if (limiter[ip].length >= 20) return false;
  limiter[ip].push(now);
  return true;
}

// POST /api/enhance-brief
router.post('/enhance-brief', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    if (!checkRate(ip)) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    const { brief, project_type } = req.body;

    if (!brief || brief.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a brief description (at least 10 characters).' });
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: `You are a UK/Ireland construction quantity surveying assistant helping clients describe their project scope for a Bill of Quantities request.

The user has given a brief description. Expand it into a clear, well-structured project description that a quantity surveyor would find useful.

Include relevant details like:
- Approximate dimensions if mentioned
- Construction type and method
- Key elements (foundations, structure, roof, finishes, M&E if applicable)
- Location context for regional pricing
- Any reasonable assumptions based on common UK/Irish construction practice

Keep it concise but thorough — around 80-150 words. Write in plain English, not bullet points.
Do NOT add pricing or cost information.
Do NOT wrap in quotes.
Just output the enhanced description text directly.`,
      messages: [
        {
          role: 'user',
          content: `Project type: ${project_type || 'Construction project'}\n\nClient's brief description:\n${brief.trim()}`
        }
      ]
    });

    const enhanced = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    res.json({ enhanced });

  } catch (err) {
    console.error('[Enhance Brief] Error:', err.message);
    res.status(500).json({ error: 'Failed to enhance brief. Please try again.' });
  }
});

module.exports = router;
