const express = require('express');
const router = express.Router();

const limiter = {};
function checkRate(ip) {
  const now = Date.now();
  if (!limiter[ip]) limiter[ip] = [];
  limiter[ip] = limiter[ip].filter(t => now - t < 3600000);
  if (limiter[ip].length >= 20) return false;
  limiter[ip].push(now);
  return true;
}

const SYSTEM_PROMPT = `You are a UK/Ireland construction quantity surveying assistant helping clients describe their project scope for a Bill of Quantities request.

The user has given a brief description and may have also attached a construction drawing (plan, elevation, or spec sheet). If a drawing is attached, reference what you can see — room layouts, dimensions, structural elements, annotations — to produce a more accurate scope description.

Expand the brief into a clear, well-structured project description that a quantity surveyor would find useful. Include relevant details like:
- Approximate dimensions (from the drawing if visible, or from the brief)
- Construction type and method
- Key elements (foundations, structure, roof, finishes, M&E if applicable)
- Location context for regional pricing
- Any reasonable assumptions based on common UK/Irish construction practice
- If a drawing is attached, note key features you can identify (e.g. "The ground floor plan shows a single-storey rear extension approximately 5m x 4m with bi-fold doors to the rear elevation")

Keep it concise but thorough — around 100-200 words. Write in plain English, not bullet points.
Do NOT add pricing or cost information.
Do NOT wrap in quotes.
Just output the enhanced description text directly.`;

// POST /api/enhance-brief
router.post('/enhance-brief', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    if (!checkRate(ip)) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    const { brief, project_type, drawing_base64, drawing_type, drawing_name } = req.body;

    if (!brief || brief.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a brief description (at least 10 characters).' });
    }

    // Build the user message content
    const userContent = [];

    // If a drawing was sent, include it for Claude vision
    if (drawing_base64 && drawing_type) {
      if (drawing_type === 'application/pdf') {
        userContent.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: drawing_base64
          }
        });
      } else {
        const validImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        if (validImageTypes.includes(drawing_type)) {
          userContent.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: drawing_type,
              data: drawing_base64
            }
          });
        }
      }
      console.log('[Enhance Brief] Drawing attached:', drawing_name, '(' + drawing_type + ')');
    }

    // Add the text prompt
    userContent.push({
      type: 'text',
      text: 'Project type: ' + (project_type || 'Construction project') + '\n\nClient\'s brief description:\n' + brief.trim() + (drawing_base64 ? '\n\nI have also attached a drawing — please reference what you can see in it to improve the project description.' : '')
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: userContent
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Enhance Brief] API error:', response.status, errText);
      throw new Error('API error ' + response.status);
    }

    const data = await response.json();
    const enhanced = data.content
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
