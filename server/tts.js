// ═══════════════════════════════════════════════════════════════════════════════
// TEXT TO SPEECH — server/tts.js
//
// The one place that talks to ElevenLabs' text-to-speech: send the text, get an
// mp3 buffer back. `null` means "not configured — use the browser's voice" (the
// route answers 204 for that). Voice from env:
//   ELEVENLABS_API_KEY            account key (unset = TTS off)
//   ELEVENLABS_MAX_VOICE_ID       MAX's voice (default: a warm British male)
//   ELEVENLABS_TTS_MODEL          default eleven_turbo_v2_5
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_VOICE = 'onwK4e9ZLuTAKqWW03F9'; // "Daniel" — warm, British, unhurried

function isConfigured() { return !!process.env.ELEVENLABS_API_KEY; }
function voiceId() { return process.env.ELEVENLABS_MAX_VOICE_ID || DEFAULT_VOICE; }

const clampSpeed = (v) => Math.round(Math.max(0.7, Math.min(1.2, v)) * 100) / 100;

class TtsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// A one-line human reason from an ElevenLabs error body.
function reason(status, detail) {
  try {
    const j = JSON.parse(detail);
    const d = j && j.detail;
    if (d && typeof d === 'object' && d.message) return String(d.message).slice(0, 160);
    if (typeof d === 'string') return d.slice(0, 160);
  } catch (e) { /* not JSON */ }
  if (status === 401) return 'the API key was rejected';
  if (status === 403) return 'the API key lacks Text to Speech permission';
  if (status === 404) return 'that voice id is not in the account';
  if (status === 429) return 'rate limited or out of credits';
  return String(detail || 'no detail').replace(/\s+/g, ' ').slice(0, 160);
}

// synthesize(text, { speed }) → Buffer (mp3)
//   null  → ElevenLabs not configured (caller answers 204 → browser voice)
//   throws TtsError on an upstream failure, with a plain reason.
async function synthesize(text, { speed = 1.0 } = {}) {
  if (!isConfigured()) return null;
  const clean = String(text || '').slice(0, 2000).trim();
  if (!clean) throw new TtsError(400, 'Nothing to say');
  let r;
  try {
    r = await fetch(
      'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId()) + '?output_format=mp3_44100_64',
      {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: clean,
          model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true, speed: clampSpeed(Number(speed) || 1) },
        }),
      },
    );
  } catch (err) {
    throw new TtsError(502, 'ElevenLabs unreachable: ' + err.message);
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    console.error('[tts] ElevenLabs ' + r.status + ': ' + detail.slice(0, 200));
    throw new TtsError(502, 'ElevenLabs ' + r.status + ': ' + reason(r.status, detail));
  }
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { synthesize, isConfigured, voiceId, TtsError, DEFAULT_VOICE };
