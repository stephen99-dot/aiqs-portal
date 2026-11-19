// ═══════════════════════════════════════════════════════════════════════════════
// FINISHED-ROOM RENDERS — server/imageRender.js
//
// A survey photo plus the scope of work → the same photo with the work done:
// new tiles, a new bath, the walls painted. OpenAI's image model edits the
// picture in place (POST /v1/images/edits), keeping the camera angle and the
// room's shape, changing only what the scope describes. It is an illustration
// for the customer, not a drawing: the report says so.
//
//   OPENAI_API_KEY          enables it (the same key as dictation)
//   OPENAI_IMAGE_MODEL      default gpt-image-1
//   OPENAI_IMAGE_QUALITY    low | medium | high — default medium (a few pence)
//
// The photo bytes go to OpenAI and come straight back as the edited image;
// nothing is kept there, and nothing identifying the builder is sent.
// ═══════════════════════════════════════════════════════════════════════════════

const MODEL = () => process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const QUALITY = () => (['low', 'medium', 'high'].includes(process.env.OPENAI_IMAGE_QUALITY) ? process.env.OPENAI_IMAGE_QUALITY : 'medium');
const TIMEOUT_MS = 150000;
// What a render costs, for the usage log (USD, 1024-ish output).
const COST_USD = { low: 0.02, medium: 0.07, high: 0.19 };

class RenderError extends Error {
  constructor(message, status) { super(message); this.name = 'RenderError'; this.status = status || 502; }
}

function isConfigured() { return !!process.env.OPENAI_API_KEY; }

// The instruction the model paints from. The scope is the builder's own words;
// the rest keeps the picture honest.
function promptFor({ scope, extra, roomName, finishes }) {
  const lines = [
    'This is a photograph taken during a site survey of ' + (roomName ? 'the ' + roomName.toLowerCase() : 'a room') + ' in a UK home. Edit the photograph to show the room after the following work has been done:',
    String(scope || '').trim(),
  ];
  if (extra && String(extra).trim()) lines.push('Also: ' + String(extra).trim());
  if (finishes && finishes.length) lines.push('Finishes to use: ' + finishes.join('; ') + '.');
  lines.push('Keep the camera angle, the walls, the window and door positions and the proportions of the room exactly as in the photograph. Change only what the work describes; leave everything else as it is. Photorealistic, the same natural lighting as the photo, tidy and finished, no people, no text, no labels.');
  return lines.join('\n');
}

// Output size follows the photo's shape.
function sizeFor(width, height) {
  if (!width || !height) return 'auto';
  const r = width / height;
  if (r > 1.2) return '1536x1024';
  if (r < 0.83) return '1024x1536';
  return '1024x1024';
}

async function call(form, signal) {
  const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY }, body: form, signal });
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  return { status: r.status, body };
}

// renderRoom({ buffer, mime, width, height, prompt }) → { buffer (PNG), model, quality, cost_usd }
async function renderRoom({ buffer, mime, width, height, prompt }) {
  if (!isConfigured()) throw new RenderError('Finished-room renders are not switched on for this portal (no OPENAI_API_KEY).', 503);
  if (!buffer || !buffer.length) throw new RenderError('No photo to work from.', 400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const build = (withFidelity) => {
      const form = new FormData();
      form.append('model', MODEL());
      form.append('prompt', prompt);
      form.append('n', '1');
      form.append('size', sizeFor(width, height));
      form.append('quality', QUALITY());
      if (withFidelity) form.append('input_fidelity', 'high');
      form.append('image', new Blob([buffer], { type: mime || 'image/jpeg' }), /png/.test(mime || '') ? 'room.png' : 'room.jpg');
      return form;
    };
    let out = await call(build(true), controller.signal);
    // Older API versions do not know input_fidelity; the render still works without it.
    if (out.status === 400 && out.body && out.body.error && /input_fidelity/i.test(String(out.body.error.message || ''))) out = await call(build(false), controller.signal);
    if (out.status === 401 || out.status === 403) throw new RenderError('The OpenAI key on this server was refused.', 503);
    if (out.status === 429) throw new RenderError('The image service is busy — try again in a minute.', 429);
    if (out.status >= 400 || !out.body) {
      const msg = out.body && out.body.error && out.body.error.message ? String(out.body.error.message).slice(0, 200) : 'status ' + out.status;
      if (/safety|content policy|moderation/i.test(msg)) throw new RenderError('The image service would not edit that photo. Try another photo of the room.', 422);
      throw new RenderError('Could not render the room just now (' + msg + ').', 502);
    }
    const first = out.body.data && out.body.data[0];
    if (!first || !first.b64_json) throw new RenderError('The image service sent nothing back.', 502);
    return { buffer: Buffer.from(first.b64_json, 'base64'), model: MODEL(), quality: QUALITY(), cost_usd: COST_USD[QUALITY()] || 0.07 };
  } catch (err) {
    if (err instanceof RenderError) throw err;
    if (err && err.name === 'AbortError') throw new RenderError('The render took too long — try again.', 504);
    throw new RenderError('Could not reach the image service.', 502);
  } finally { clearTimeout(timer); }
}

module.exports = { isConfigured, renderRoom, promptFor, sizeFor, RenderError, COST_USD };
