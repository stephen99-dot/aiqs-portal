// ═══════════════════════════════════════════════════════════════════════════════
// SPEECH TO TEXT — server/stt.js
//
// One function in front of the speech-to-text provider. OpenAI's transcription
// API (gpt-4o-mini-transcribe, falling back to whisper-1) or Deepgram's nova-3
// — whichever key is set, or STT_PROVIDER to choose when both are. Plain
// multipart fetch, no SDK.
//
// The audio buffer is sent, transcribed and dropped. It is never written to
// disk, logged or kept — the only thing that survives the call is the text.
//
//   OPENAI_API_KEY      enables the OpenAI path
//   DEEPGRAM_API_KEY    enables the Deepgram path
//   STT_PROVIDER        'openai' | 'deepgram' (optional; default = whichever key exists, OpenAI first)
// ═══════════════════════════════════════════════════════════════════════════════

// Trade vocabulary the recogniser would otherwise mangle. Passed as a prompt
// (OpenAI) or keyterms (Deepgram) so "DPC" is not "deep sea".
const TRADE_TERMS = [
  'blockwork', 'brickwork', 'DPC', 'DPM', 'lintel', 'RSJ', 'skim', 'plasterboard', 'dot and dab', 'first fix', 'second fix',
  'screed', 'soffit', 'fascia', 'UPVC', 'bifolds', 'Velux', 'stud wall', 'snagging', 'retention', 'variation', 'take-off',
  'BOQ', 'bill of quantities', 'Travis Perkins', 'Jewson', 'Selco', 'Wickes', 'Screwfix', 'Toolstation',
  'cavity wall', 'strip foundation', 'beam and block', 'joist', 'rafter', 'purlin', 'noggin', 'batten', 'OSB', 'ply', 'C24', 'C16',
  'render', 'pointing', 'repointing', 'flaunching', 'coping', 'weep vent', 'cavity tray', 'insulation', 'PIR', 'Celotex', 'Kingspan',
  'MDF', 'skirting', 'architrave', 'coving', 'patio', 'slabs', 'MOT type 1', 'quote', 'estimate', 'day rate', 'ex VAT', 'inc VAT', 'MAX',
];
const PROMPT = 'UK builder describing a building job to their estimating assistant. Terms: ' + TRADE_TERMS.join(', ') + '.';

function provider() {
  const want = String(process.env.STT_PROVIDER || '').toLowerCase();
  if (want === 'deepgram' && process.env.DEEPGRAM_API_KEY) return 'deepgram';
  if (want === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.DEEPGRAM_API_KEY) return 'deepgram';
  return null;
}
function isConfigured() { return !!provider(); }

class SttError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function extFor(mime) {
  if (/mp4|m4a|aac/.test(mime)) return 'm4a';
  if (/ogg/.test(mime)) return 'ogg';
  if (/wav/.test(mime)) return 'wav';
  if (/mpeg|mp3/.test(mime)) return 'mp3';
  return 'webm';
}

async function openaiTranscribe(buffer, mime, model) {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mime || 'audio/webm' }), 'speech.' + extFor(mime || ''));
  fd.append('model', model);
  fd.append('language', 'en');
  fd.append('prompt', PROMPT);
  fd.append('response_format', 'json');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY }, body: fd,
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new SttError(r.status, 'OpenAI ' + r.status + ': ' + detail.replace(/\s+/g, ' ').slice(0, 160));
  }
  const j = await r.json();
  return String((j && j.text) || '').trim();
}

async function deepgramTranscribe(buffer, mime) {
  const params = new URLSearchParams({ model: 'nova-3', language: 'en-GB', smart_format: 'true', punctuate: 'true' });
  for (const t of TRADE_TERMS.slice(0, 50)) params.append('keyterm', t);
  const r = await fetch('https://api.deepgram.com/v1/listen?' + params.toString(), {
    method: 'POST', headers: { Authorization: 'Token ' + process.env.DEEPGRAM_API_KEY, 'Content-Type': mime || 'audio/webm' }, body: buffer,
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new SttError(r.status, 'Deepgram ' + r.status + ': ' + detail.replace(/\s+/g, ' ').slice(0, 160));
  }
  const j = await r.json();
  const alt = j && j.results && j.results.channels && j.results.channels[0] && j.results.channels[0].alternatives && j.results.channels[0].alternatives[0];
  return String((alt && alt.transcript) || '').trim();
}

// transcribe(buffer, mime) → { text, provider }   (throws SttError)
async function transcribe(buffer, mime) {
  const p = provider();
  if (!p) throw new SttError(503, 'dictation_unavailable');
  if (p === 'deepgram') return { text: await deepgramTranscribe(buffer, mime), provider: 'deepgram' };
  try {
    return { text: await openaiTranscribe(buffer, mime, 'gpt-4o-mini-transcribe'), provider: 'openai' };
  } catch (e) {
    // The newer model may not be enabled on the account — whisper-1 always is.
    if (e instanceof SttError && (e.status === 404 || e.status === 400)) return { text: await openaiTranscribe(buffer, mime, 'whisper-1'), provider: 'openai' };
    throw e;
  }
}

module.exports = { transcribe, isConfigured, provider, SttError, TRADE_TERMS };
