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

const SYSTEM_PROMPT = `You are a quantity surveyor's intake assistant for a UK/Ireland BOQ service. Your job is to turn a client's rough brief into a structured, technical project description that goes directly into the BOQ estimation engine. Be specific and factual — no marketing language, no filler.

If a drawing is attached, examine it carefully for:
- The PROJECT ADDRESS (title block, header, notes — look for street names, postcodes, towns)
- Dimensions, room names, annotations, structural specs
- Drawing references, revision numbers, architect details
- Scale, orientation, and any specification notes

OUTPUT FORMAT — follow this structure exactly:

Project Location: [address from drawing or brief, or "Not specified" if unknown]
Drawing Ref: [if visible, otherwise omit this line]

Scope: [1-2 sentences summarising what the project is]

Key Elements:
- [specific element with dimensions/quantities where possible, e.g. "Single-storey rear extension approx 6m x 4m, flat roof"]
- [e.g. "2 nr bedrooms with Jack and Jill bathroom arrangement"]
- [e.g. "New utility room, approx 2.5m x 2m"]
- [e.g. "Structural opening to existing dwelling, steel beam TBC"]
- [e.g. "Full M&E to new areas including UFH and MVHR"]

Construction Assumptions: [1-2 sentences on assumed build method, e.g. "Traditional masonry cavity wall construction assumed. Trench fill foundations to BC approval."]

Keep it under 200 words. Use dimensions where the drawing shows them. Use "TBC" or "to be confirmed from drawings" where you can see something exists but can't read the detail. Do NOT pad with generic statements about Building Regulations compliance or property value — the QS already knows that.`;

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
