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
//   OPENAI_IMAGE_MODEL      pins a model; unset = gpt-image-2.6-flare, or the newest the key has
//   OPENAI_IMAGE_QUALITY    low | medium | high — default high (roughly 15p a render)
//
// The photo bytes go to OpenAI and come straight back as the edited image;
// nothing is kept there, and nothing identifying the builder is sent.
// ═══════════════════════════════════════════════════════════════════════════════

// OpenAI retires image models every few months (gpt-image-1 went in October
// 2026). The default is the current one; if it is ever refused, the server
// asks OpenAI which image models the key can use and takes the newest, so a
// retirement never leaves the button dead. OPENAI_IMAGE_MODEL pins one.
const DEFAULT_MODEL = 'gpt-image-2.6-sunburst';   // the higher-quality one; -flare is the quick, cheaper sibling
let discoveredModel = null;
const MODEL = () => process.env.OPENAI_IMAGE_MODEL || discoveredModel || DEFAULT_MODEL;
const QUALITY = () => (['low', 'medium', 'high'].includes(process.env.OPENAI_IMAGE_QUALITY) ? process.env.OPENAI_IMAGE_QUALITY : 'high');
const TIMEOUT_MS = 150000;
// What a render costs, for the usage log (USD, 1024-ish output).
const COST_USD = { low: 0.02, medium: 0.07, high: 0.19 };

class RenderError extends Error {
  constructor(message, status) { super(message); this.name = 'RenderError'; this.status = status || 502; }
}

function isConfigured() { return !!process.env.OPENAI_API_KEY; }

// The newest image model this key can use, from OpenAI's own list: ids that
// start gpt-image-, not the mini ones, highest version then newest first.
async function discoverModel(signal) {
  const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY }, signal });
  if (!r.ok) throw new RenderError('Could not list the image models on this key (status ' + r.status + ').', 502);
  const body = await r.json();
  const version = (id) => { const m = /^gpt-image-(\d+(?:\.\d+)?)/.exec(id); return m ? parseFloat(m[1]) : 0; };
  const candidates = ((body && body.data) || [])
    .filter((m) => m && typeof m.id === 'string' && /^gpt-image-/.test(m.id) && !/mini/.test(m.id))
    // Highest version first; at the same version the quality tier (sunburst) over the quick one (flare).
    .sort((a, b) => (version(b.id) - version(a.id)) || ((/sunburst/.test(b.id) ? 1 : 0) - (/sunburst/.test(a.id) ? 1 : 0)) || ((b.created || 0) - (a.created || 0)) || a.id.localeCompare(b.id));
  if (!candidates.length) throw new RenderError('This OpenAI key has no image model available.', 503);
  discoveredModel = candidates[0].id;
  console.log('[imageRender] using image model ' + discoveredModel);
  return discoveredModel;
}

// The instruction the model paints from. The scope is the builder's own words;
// the rest keeps the picture honest.
// The brief the model paints from. Written like a brief to a visualiser:
// what the room is and what is there now (so it knows what to take out),
// the work in the builder's own words, then everything that must not change.
//   current: { finishes: [{ part, type, condition }], hazards: [], condition: '' }
function promptFor({ scope, extra, roomName, current }) {
  const room = roomName ? String(roomName).toLowerCase().replace(/^the\s+/, '') : 'room';
  const cur = current || {};
  const now = [];
  for (const f of cur.finishes || []) if (f && f.type) now.push(f.part + ': ' + f.type + (f.condition ? ' (' + f.condition + ' condition)' : ''));
  const lines = [
    'A photorealistic visualisation for a UK builder\'s customer. The attached photograph was taken during a site survey of the ' + room + ' of a UK home, as it is today. Produce the same photograph showing the ' + room + ' after the work below has been completed to a high standard by professional tradespeople.',
    '',
    'THE WORK TO SHOW DONE:',
    String(scope || '').trim(),
  ];
  if (extra && String(extra).trim()) lines.push('Specific choices for this picture: ' + String(extra).trim() + '.');
  if (now.length || (cur.hazards || []).length || cur.condition) {
    lines.push('', 'THE ROOM NOW (what the work replaces or puts right):');
    if (now.length) lines.push('Existing finishes — ' + now.join('; ') + '.');
    if ((cur.hazards || []).length) lines.push('Defects seen — ' + cur.hazards.join('; ') + ' — these are gone once the work is done.');
    if (cur.condition) lines.push('Condition notes: ' + String(cur.condition).slice(0, 300));
  }
  lines.push(
    '',
    'WHAT MUST STAY EXACTLY AS IN THE PHOTOGRAPH: the camera position, lens and angle; the walls, ceiling line, floor plane and room proportions; the positions and sizes of the windows, doors and any built-in features; the daylight direction and overall exposure. Anything the work does not mention stays as it is.',
    'HOW IT SHOULD LOOK: a finished, clean, newly completed room — plumb, level, neat joints and sealant, fresh paint, no dust sheets, tools, rubble or clutter. Correct for a UK home: UK-style sockets, switches, radiators and fittings. Materials to look real, with the same lighting, shadows and reflections as the photo; no stylised or showroom look, no wide-angle distortion, no added people, pets, text, labels or watermarks. If the work describes removing something, show the space it leaves made good.'
  );
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
    // The request as a set of fields, so a field the API no longer knows can
    // be dropped and the call tried again rather than failing the render.
    const params = { model: MODEL(), prompt, n: '1', size: sizeFor(width, height), quality: QUALITY(), input_fidelity: 'high' };
    const build = () => {
      const form = new FormData();
      for (const [k, v] of Object.entries(params)) if (v != null) form.append(k, String(v));
      form.append('image', new Blob([buffer], { type: mime || 'image/jpeg' }), /png/.test(mime || '') ? 'room.png' : 'room.jpg');
      return form;
    };
    let out = await call(build(), controller.signal);
    let modelLookedUp = false;
    for (let attempt = 0; attempt < 4 && out.status === 400 && out.body && out.body.error; attempt++) {
      const msg = String(out.body.error.message || '');
      if (!modelLookedUp && !process.env.OPENAI_IMAGE_MODEL && /model/i.test(msg) && /(does not exist|not found|deprecated|no longer|unsupported|invalid)/i.test(msg)) {
        // The model has been retired: ask which ones this key has and use the newest.
        modelLookedUp = true;
        params.model = await discoverModel(controller.signal);
      } else {
        // A parameter this version of the API does not take: send without it.
        const dropped = ['input_fidelity', 'quality', 'size', 'n'].find((k) => params[k] != null && new RegExp('\\b' + k + '\\b', 'i').test(msg));
        if (!dropped) break;
        delete params[dropped];
      }
      out = await call(build(), controller.signal);
    }
    if (out.status === 401 || out.status === 403) throw new RenderError('The OpenAI key on this server was refused.', 503);
    if (out.status === 429) throw new RenderError('The image service is busy — try again in a minute.', 429);
    if (out.status >= 400 || !out.body) {
      const msg = out.body && out.body.error && out.body.error.message ? String(out.body.error.message).slice(0, 200) : 'status ' + out.status;
      if (/safety|content policy|moderation/i.test(msg)) throw new RenderError('The image service would not edit that photo. Try another photo of the room.', 422);
      throw new RenderError('Could not render the room just now (' + msg + ').', 502);
    }
    const first = out.body.data && out.body.data[0];
    if (!first || !first.b64_json) throw new RenderError('The image service sent nothing back.', 502);
    return { buffer: Buffer.from(first.b64_json, 'base64'), model: params.model, quality: params.quality || 'default', cost_usd: COST_USD[params.quality] || 0.07 };
  } catch (err) {
    if (err instanceof RenderError) throw err;
    if (err && err.name === 'AbortError') throw new RenderError('The render took too long — try again.', 504);
    throw new RenderError('Could not reach the image service.', 502);
  } finally { clearTimeout(timer); }
}

module.exports = { isConfigured, renderRoom, promptFor, sizeFor, discoverModel, RenderError, COST_USD, DEFAULT_MODEL, _reset: () => { discoveredModel = null; } };
