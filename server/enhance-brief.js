const express = require('express');
const router = express.Router();
const { callModel, MODELS } = require('./anthropicClient');

// ─── Rate limiting (preserved from original) ────────────────────────────────
const limiter = {};
function checkRate(ip) {
  const now = Date.now();
  if (!limiter[ip]) limiter[ip] = [];
  limiter[ip] = limiter[ip].filter(t => now - t < 3600000);
  if (limiter[ip].length >= 20) return false;
  limiter[ip].push(now);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TWO MODES: POLISH (grammar only) and EXPAND (structure into QS brief)
//  Both have hard anti-hallucination rules.
// ═══════════════════════════════════════════════════════════════════════════

const POLISH_SYSTEM_PROMPT = `You are a copy editor for a UK construction project brief. Your ONLY job is to improve the grammar, punctuation, capitalisation, and sentence structure of the user's text.

HARD RULES (do not break these):
1. Do NOT add any information the user did not write.
2. Do NOT invent dimensions, materials, locations, specifications, finishes, quantities, or scope items.
3. Do NOT remove any information the user wrote.
4. Do NOT expand the text — keep it roughly the same length.
5. Use UK English spelling.
6. Return ONLY the polished text. No preamble, no explanation, no quotes, no markdown headings.

Example:
Input: "ext 5x4 flat roof bristol, bifolds, 2 bed ensuite"
Output: "Extension, 5m x 4m, flat roof, Bristol. Bi-folds, 2 bed, ensuite."

If the user's text is already well-written, return it unchanged.`;

const EXPAND_SYSTEM_PROMPT = `You are a UK Quantity Surveyor helping a client structure their project brief for a BOQ estimation team. You will organise what the user wrote into a clear brief — without inventing any details.

HARD RULES — violating these will produce an inaccurate BOQ:
1. You MUST NOT invent dimensions, materials, finishes, quantities, specifications, or locations the user did not state.
2. You MUST NOT assume scope not mentioned by the user (e.g. if they said "extension" do not assume bi-folds, underfloor heating, or a specific roof type).
3. For every piece of information a QS would need that is NOT stated by the user, add it to a "Missing Information" list as a question — do NOT fabricate it.
4. Organise what they DID say under these headings, in this order:
   Scope Summary: [1-2 sentences, user's own facts only]
   Known Specifications: [bullet list of what they actually stated — dimensions, materials, rooms, locations]
   Missing Information: [bullet list of questions the QS needs answered before pricing]
5. If a drawing is attached, examine it. List anything visible on the drawing that the user did NOT mention under an extra heading:
   Observed on Drawings (please confirm): [bullet list — items, dimensions, addresses, drawing refs visible in the title block]
   Do NOT merge these into the main scope — they need the client to confirm.
6. Use UK construction terminology.
7. Return ONLY the structured brief. No preamble, no explanation, no markdown code fences.

Keep it concise. If the user wrote very little, the output should also be short, with most items under Missing Information. Do not pad with generic Building Regs / NHBC statements — the QS already knows those apply.`;

// ─── POST /api/enhance-brief ────────────────────────────────────────────────
router.post('/enhance-brief', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    if (!checkRate(ip)) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    const {
      mode = 'expand',
      brief,
      user_text,
      project_type,
      drawing_base64,
      drawing_type,
      drawing_name
    } = req.body;

    // Accept either `brief` or `user_text` (frontend sends both)
    const userInput = (brief || user_text || '').trim();

    if (!userInput || userInput.length < 10) {
      return res.status(400).json({ error: 'Please provide a brief description (at least 10 characters).' });
    }

    const isPolish = mode === 'polish';
    const systemPrompt = isPolish ? POLISH_SYSTEM_PROMPT : EXPAND_SYSTEM_PROMPT;

    console.log('[Enhance Brief] Mode:', mode, '| Input length:', userInput.length);

    // Build the user message content
    const userContent = [];

    // Drawings are only useful for EXPAND mode (polish is grammar-only)
    if (!isPolish && drawing_base64 && drawing_type) {
      if (drawing_type === 'application/pdf') {
        userContent.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: drawing_base64
          }
        });
        console.log('[Enhance Brief] PDF attached:', drawing_name);
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
          console.log('[Enhance Brief] Image attached:', drawing_name, '(' + drawing_type + ')');
        }
      }
    }

    // Build the text prompt per mode
    let userText;
    if (isPolish) {
      userText = 'Polish this project description (grammar, punctuation, structure only — do not add or remove information):\n\n' + userInput;
    } else {
      userText = 'Project type: ' + (project_type || '(not specified)')
        + '\n\nClient\'s brief (in their own words):\n"""\n' + userInput + '\n"""';
      if (drawing_base64) {
        userText += '\n\nA drawing (' + (drawing_name || 'attached') + ') is provided above. Cross-reference it per the rules — items on the drawing but not in the client\'s text go under "Observed on Drawings (please confirm)".';
      }
    }

    userContent.push({ type: 'text', text: userText });

    // ─── Call Claude ────────────────────────────────────────────────────────
    const result = await callModel({
      model: MODELS.STANDARD,
      maxTokens: isPolish ? 600 : 1200,
      temperature: 0.2,              // LOW — suppresses creative invention
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      action: 'enhance_brief',
    });

    if (!result.ok) {
      const errMsg = result.error?.error?.message || result.error?.message || result.status;
      console.error('[Enhance Brief] API error:', errMsg);
      throw new Error('API error ' + result.status);
    }

    const enhanced = (result.text || '').trim();

    if (!enhanced) {
      return res.status(502).json({ error: 'AI returned an empty response. Please try again.' });
    }

    res.json({ enhanced, mode });

  } catch (err) {
    console.error('[Enhance Brief] Error:', err.message);
    res.status(500).json({ error: 'Failed to enhance brief. Please try again.' });
  }
});

module.exports = router;
