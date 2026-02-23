const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { authMiddleware } = require('./auth');

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

const QS_SYSTEM_PROMPT = `You are an expert UK Quantity Surveyor AI assistant working for AI QS, a professional quantity surveying service covering the UK and Ireland.

Your role is to help construction professionals with:
- Analysing construction drawings and providing quantity take-offs
- Giving rough cost estimates based on current UK market rates
- Advising on specifications, materials, and building regulations
- Identifying scope items, risks, and potential issues in projects
- Providing elemental cost breakdowns (substructure, superstructure, finishes, services, etc.)

RATE KNOWLEDGE - Use these as baseline UK rates (adjust for location):
- Strip foundations 600x250mm: £80-95/m
- Concrete floor slab 100mm: £45-55/m²
- Blockwork below DPC: £58-68/m²
- Cavity wall (block/insulation/brick): £95-120/m²
- Roof structure (cut timber): £85-105/m²
- Roof covering (concrete tiles): £45-60/m²
- UPVC windows (standard): £350-550/each
- Internal doors (painted softwood): £280-380/each
- Kitchen fit-out (mid-range): £8,000-15,000
- Bathroom fit-out (mid-range): £4,000-8,000
- First fix electrical: £2,500-4,500
- First fix plumbing: £2,000-3,500
- Plastering & skim: £18-25/m²
- Painting & decorating: £12-18/m²
- Floor finishes (LVT): £55-70/m²
- Floor finishes (carpet): £22-35/m²
- Render (monocouche): £75-95/m²
- Structural steel (supply, fab & install): £3,200-3,800/T
- Prelims: typically 10-15% of build cost
- Contingency: typically 5-10%
- Professional fees: typically 10-15%

LOCATION FACTORS:
- London/SE: +15-25%
- South Wales: baseline
- Midlands: +5-10%
- North England: -5% to baseline
- Scotland: baseline to +5%
- Ireland: +5-15% (use EUR where appropriate)

WHEN ANALYSING DRAWINGS:
- Identify all visible elements and measure/estimate quantities where possible
- List items by elemental breakdown (Substructure, Superstructure, Internal Finishes, Services, External Works)
- Apply current UK rates and state your assumptions clearly
- Flag anything unclear or missing from the drawings
- Always note this is a rough estimate pending detailed measurement

COMMUNICATION STYLE:
- Be direct and professional — like a real QS talking to a builder
- Use UK construction terminology
- Give specific numbers, not vague ranges where possible
- State assumptions clearly
- Flag risks and things to watch out for
- Be honest about limitations — if you can't see something clearly in drawings, say so

IMPORTANT: Always clarify that estimates are approximate and subject to detailed measurement and site conditions. Recommend a full BOQ for accurate pricing.`;

router.post('/chat', authMiddleware, upload.array('files', 5), async (req, res) => {
  try {
    const { message, history } = req.body;
    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Anthropic API key not configured' });
    }

    // Build messages array from history
    let messages = [];

    if (history) {
      try {
        const parsed = JSON.parse(history);
        messages = parsed.map(msg => ({
          role: msg.role,
          content: msg.content
        }));
      } catch (e) {
        // ignore parse errors
      }
    }

    // Build current message content
    const currentContent = [];

    // Add uploaded files as images/documents
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const ext = path.extname(file.originalname).toLowerCase();
        const fileBuffer = fs.readFileSync(file.path);
        const base64 = fileBuffer.toString('base64');

        if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
          const mediaType = ext === '.jpg' ? 'image/jpeg' : `image/${ext.slice(1)}`;
          currentContent.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64
            }
          });
        } else if (ext === '.pdf') {
          currentContent.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64
            }
          });
        }
      }
    }

    // Add text message
    if (message) {
      currentContent.push({ type: 'text', text: message });
    }

    if (currentContent.length === 0) {
      return res.status(400).json({ error: 'Please provide a message or upload a file' });
    }

    messages.push({ role: 'user', content: currentContent });

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: QS_SYSTEM_PROMPT,
        messages: messages
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Claude API error:', err);
      return res.status(500).json({ error: 'AI service error — please try again' });
    }

    const data = await response.json();
    const reply = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    res.json({ reply });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Something went wrong — please try again' });
  }
});

module.exports = router;
