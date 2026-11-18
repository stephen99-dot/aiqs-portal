import { useState, useRef, useCallback, useEffect } from 'react';
import { API_BASE, getToken } from '../utils/api';

// ═══ useMaxVoice — MAX's ears and voice ══════════════════════════════════════
// Speech in:  the microphone is recorded with MediaRecorder and sent to
//             POST /api/transcribe (server STT — Whisper or Deepgram — the
//             primary path, and the only reliable one inside the app shell).
//             Where the server has no STT key (503 dictation_unavailable), or
//             the browser cannot record, it falls back to the browser's own Web
//             Speech API. Neither available → `supported` is false and the
//             panel hides the mic.
// Speech out: POST /api/max/tts streams an mp3 of the MAX voice; a 204 means
//             "use the browser voice" and speechSynthesis takes over with the
//             best en-GB voice it has.
// Interaction: tap to talk, tap to stop, auto-stop after a short silence; the
//             live transcript and the input level are exposed so the panel can
//             show words as they land and a waveform that moves with the voice.
//             Barge-in: starting to listen stops MAX speaking at once.
//             Conversation mode (off by default) listens again after each
//             spoken reply. Mute is remembered per device.
// Privacy:    audio never leaves memory on either side — the blob is posted,
//             transcribed and dropped; only the text goes into the thread.

const MUTE_KEY = 'aiqs_max_muted';
const CONVO_KEY = 'aiqs_max_conversation';
const SILENCE_MS = 1800;        // quiet this long after speech ends the recording
const MAX_RECORD_MS = 60000;    // a forgotten mic never runs forever
const SPEECH_LEVEL = 0.035;     // RMS above this counts as talking

function authHeaders() {
  const h = {};
  const t = getToken(); if (t) h.Authorization = 'Bearer ' + t;
  return h;
}

let serverSttKnown = null; // null = not asked yet, true/false once /api/transcribe/status answers
async function serverSttAvailable() {
  if (serverSttKnown !== null) return serverSttKnown;
  try {
    const r = await fetch(API_BASE + '/transcribe/status', { headers: authHeaders() });
    const j = r.ok ? await r.json() : null;
    serverSttKnown = !!(j && j.available);
  } catch (e) { serverSttKnown = false; }
  return serverSttKnown;
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* keep looking */ }
  }
  return '';
}

function voiceScore(v) {
  const name = (v.name || '').toLowerCase();
  let score = 0;
  if (/en-gb/i.test(v.lang)) score += 20; else if (/^en/i.test(v.lang)) score += 5; else return -1;
  if (/siri|daniel|arthur|oliver|ryan|thomas|george|kate|serena|sonia|libby|maisie|google uk/.test(name)) score += 8;
  if (/compact|espeak|fred|zarvox|albert|bad news|bells|boing|bubbles|cellos|deranged|good news|hysterical|junior|organ|trinoids|whisper|wobble/.test(name)) score -= 50;
  if (v.localService === false) score += 3;
  return score;
}
function pickBrowserVoice() {
  if (!window.speechSynthesis) return null;
  const ranked = (window.speechSynthesis.getVoices() || []).map((v) => ({ v, score: voiceScore(v) })).filter((x) => x.score >= 0).sort((a, b) => b.score - a.score);
  return ranked.length ? ranked[0].v : null;
}

export default function useMaxVoice({ onFinal, onInterim, onError } = {}) {
  const [mode, setMode] = useState(null);       // 'server' | 'web' | 'none' | null (checking)
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMutedState] = useState(() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; } });
  const [conversation, setConversationState] = useState(() => { try { return localStorage.getItem(CONVO_KEY) === '1'; } catch (e) { return false; } });

  const recRef = useRef(null);        // MediaRecorder
  const streamRef = useRef(null);     // MediaStream
  const webRecRef = useRef(null);     // SpeechRecognition
  const ctxRef = useRef(null);        // AudioContext for levels / playback unlock
  const rafRef = useRef(0);
  const audioRef = useRef(null);      // <audio> for mp3 playback
  const genRef = useRef(0);           // speech generation; bumping it cancels a reply mid-sentence
  const onFinalRef = useRef(onFinal); onFinalRef.current = onFinal;
  const onInterimRef = useRef(onInterim); onInterimRef.current = onInterim;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const afterSpeakRef = useRef(null); // conversation mode: what to do when MAX stops talking

  const webSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const canRecord = typeof window !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof MediaRecorder !== 'undefined';

  useEffect(() => {
    let gone = false;
    (async () => {
      const server = canRecord && await serverSttAvailable();
      if (gone) return;
      setMode(server ? 'server' : (webSupported ? 'web' : 'none'));
    })();
    return () => { gone = true; };
  }, [canRecord, webSupported]);

  const setMuted = useCallback((on) => {
    setMutedState(!!on);
    try { localStorage.setItem(MUTE_KEY, on ? '1' : '0'); } catch (e) { /* fine */ }
  }, []);
  const setConversation = useCallback((on) => {
    setConversationState(!!on);
    try { localStorage.setItem(CONVO_KEY, on ? '1' : '0'); } catch (e) { /* fine */ }
  }, []);

  // ── Speaking ──────────────────────────────────────────────────────────────
  const stopSpeaking = useCallback(() => {
    genRef.current += 1;
    if (audioRef.current) { try { audioRef.current.pause(); audioRef.current.src = ''; } catch (e) { /* ignore */ } audioRef.current = null; }
    if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    setSpeaking(false);
    afterSpeakRef.current = null;
  }, []);

  const speakBrowser = useCallback((text, gen) => new Promise((resolve) => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return resolve(false);
    const u = new SpeechSynthesisUtterance(text);
    const v = pickBrowserVoice();
    if (v) u.voice = v;
    u.lang = 'en-GB'; u.rate = 1.0; u.pitch = 1.0;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(gen === genRef.current); } };
    u.onend = finish; u.onerror = finish;
    window.speechSynthesis.speak(u);
    setTimeout(finish, Math.min(60000, 4000 + text.length * 90)); // Safari sometimes never fires onend
  }), []);

  // speak(text) → resolves true if it finished, false if cut off or muted.
  const speak = useCallback(async (text, { then } = {}) => {
    const clean = String(text || '').trim();
    if (!clean || muted) return false;
    stopSpeaking();
    const gen = genRef.current;
    setSpeaking(true);
    afterSpeakRef.current = then || null;
    let finished = false;
    try {
      const r = await fetch(API_BASE + '/max/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ text: clean }) });
      if (gen !== genRef.current) return false;
      if (r.status === 200) {
        const url = URL.createObjectURL(await r.blob());
        finished = await new Promise((resolve) => {
          const a = new Audio(url);
          audioRef.current = a;
          a.onended = () => { URL.revokeObjectURL(url); resolve(gen === genRef.current); };
          a.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
          a.play().catch(() => resolve(false));
        });
      } else {
        finished = await speakBrowser(clean, gen);
      }
    } catch (e) {
      finished = await speakBrowser(clean, gen);
    }
    if (gen === genRef.current) {
      setSpeaking(false);
      const after = afterSpeakRef.current; afterSpeakRef.current = null;
      if (finished && typeof after === 'function') after();
    }
    return finished;
  }, [muted, stopSpeaking, speakBrowser]);

  // Warm the audio path on a user gesture so autoplay rules don't mute us.
  const unlock = useCallback(() => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !ctxRef.current) ctxRef.current = new AC();
      if (ctxRef.current && ctxRef.current.state === 'suspended') ctxRef.current.resume().catch(() => {});
      if (window.speechSynthesis) window.speechSynthesis.getVoices();
    } catch (e) { /* fine */ }
  }, []);

  // ── Listening: server STT via MediaRecorder ───────────────────────────────
  const teardownRecording = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (streamRef.current) { try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ } streamRef.current = null; }
    recRef.current = null;
    setLevel(0);
  }, []);

  const stopListening = useCallback(() => {
    if (recRef.current && recRef.current.state !== 'inactive') { try { recRef.current.stop(); } catch (e) { /* ignore */ } }
    if (webRecRef.current) { try { webRecRef.current.stop(); } catch (e) { /* ignore */ } }
    setListening(false);
  }, []);

  const transcribe = useCallback(async (blob, mime, seconds) => {
    setTranscribing(true);
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'speech.' + (/mp4/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm'));
      fd.append('context', 'max');
      fd.append('seconds', String(Math.round(seconds || 0)));
      const r = await fetch(API_BASE + '/transcribe', { method: 'POST', headers: authHeaders(), body: fd });
      if (r.status === 503) { serverSttKnown = false; setMode(webSupported ? 'web' : 'none'); if (onErrorRef.current) onErrorRef.current('Server dictation is not set up — using the browser\'s voice recognition instead.'); return; }
      if (!r.ok) { let msg = 'Could not transcribe that.'; try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) { /* keep */ } if (onErrorRef.current) onErrorRef.current(msg); return; }
      const j = await r.json();
      const text = String((j && (j.cleaned || j.raw)) || '').trim();
      if (text && onFinalRef.current) onFinalRef.current(text);
      else if (!text && onErrorRef.current) onErrorRef.current('I didn\'t catch that — try again.');
    } catch (e) {
      if (onErrorRef.current) onErrorRef.current('Lost the connection while sending your voice — try again.');
    } finally { setTranscribing(false); }
  }, [webSupported]);

  const startServerListening = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    streamRef.current = stream;
    const mime = pickMime();
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recRef.current = rec;
    const chunks = [];
    const startedAt = Date.now();
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const seconds = (Date.now() - startedAt) / 1000;
      const blob = new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' });
      teardownRecording();
      setListening(false);
      setInterim('');
      if (onInterimRef.current) onInterimRef.current('');
      if (blob.size > 2000 && seconds > 0.6) transcribe(blob, rec.mimeType || mime, seconds);
    };
    // Live input level, for the waveform and for the silence timer.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        if (!ctxRef.current) ctxRef.current = new AC();
        if (ctxRef.current.state === 'suspended') await ctxRef.current.resume().catch(() => {});
        const src = ctxRef.current.createMediaStreamSource(stream);
        const analyser = ctxRef.current.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        let spoke = false; let quietSince = 0;
        const hardStop = startedAt + MAX_RECORD_MS;
        const tick = () => {
          if (recRef.current !== rec) return;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length);
          setLevel(Math.min(1, rms * 4));
          const now = Date.now();
          if (rms > SPEECH_LEVEL) { spoke = true; quietSince = 0; if (onInterimRef.current) onInterimRef.current('Listening…'); }
          else if (spoke) { if (!quietSince) quietSince = now; else if (now - quietSince > SILENCE_MS) { try { rec.stop(); } catch (e) { /* ignore */ } return; } }
          if (now > hardStop) { try { rec.stop(); } catch (e) { /* ignore */ } return; }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }
    } catch (e) { /* no levels: the builder taps to stop */ }
    rec.start(250);
    setListening(true);
    setInterim('');
  }, [teardownRecording, transcribe]);

  // ── Listening: Web Speech fallback (push-to-talk) ─────────────────────────
  const startWebListening = useCallback(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) return;
    if (webRecRef.current) { try { webRecRef.current.abort(); } catch (e) { /* ignore */ } }
    const rec = new SpeechRec();
    rec.lang = 'en-GB'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    let finals = []; let silence = null;
    const armSilence = () => { if (silence) clearTimeout(silence); silence = setTimeout(() => { try { rec.stop(); } catch (e) { /* ignore */ } }, SILENCE_MS + 400); };
    const hardStop = setTimeout(() => { try { rec.stop(); } catch (e) { /* ignore */ } }, MAX_RECORD_MS);
    rec.onresult = (e) => {
      finals = []; let live = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) finals.push(e.results[i][0].transcript); else live += e.results[i][0].transcript;
      }
      const shown = (finals.join(' ') + ' ' + live).trim();
      setInterim(shown); if (onInterimRef.current) onInterimRef.current(shown);
      setLevel(live ? 0.6 : 0.2);
      if (finals.length) armSilence();
    };
    rec.onspeechend = () => { if (finals.length) armSilence(); };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') { if (onErrorRef.current) onErrorRef.current('Microphone blocked — allow the mic for this site and try again.'); }
      else if (e.error === 'network') { if (onErrorRef.current) onErrorRef.current('Voice recognition needs a connection in this browser.'); }
      else if (e.error !== 'aborted' && e.error !== 'no-speech' && onErrorRef.current) onErrorRef.current('Mic error: ' + e.error);
    };
    rec.onend = () => {
      if (silence) clearTimeout(silence); clearTimeout(hardStop);
      setListening(false); setLevel(0); webRecRef.current = null;
      const said = finals.join(' ').replace(/\s+/g, ' ').trim();
      setInterim(''); if (onInterimRef.current) onInterimRef.current('');
      if (said && onFinalRef.current) onFinalRef.current(said);
    };
    webRecRef.current = rec;
    setListening(true);
    try { rec.start(); } catch (e) { setListening(false); if (onErrorRef.current) onErrorRef.current('Could not start the microphone.'); }
  }, []);

  // Tap to talk. Starting to listen always cuts MAX off (barge-in).
  const startListening = useCallback(async () => {
    stopSpeaking();
    unlock();
    if (mode === 'server') {
      try { await startServerListening(); return; }
      catch (e) {
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) { if (onErrorRef.current) onErrorRef.current('Microphone blocked — allow the mic for this site and try again.'); return; }
        // Recording failed for another reason: try the browser recogniser.
        if (webSupported) { startWebListening(); return; }
        if (onErrorRef.current) onErrorRef.current('Could not start the microphone.');
        return;
      }
    }
    if (mode === 'web' || webSupported) { startWebListening(); return; }
    if (onErrorRef.current) onErrorRef.current('Voice isn\'t available on this device — type to MAX instead.');
  }, [mode, webSupported, stopSpeaking, unlock, startServerListening, startWebListening]);

  const toggleListening = useCallback(() => { if (listening) stopListening(); else startListening(); }, [listening, startListening, stopListening]);

  useEffect(() => () => { stopListening(); stopSpeaking(); teardownRecording(); }, [stopListening, stopSpeaking, teardownRecording]);

  return {
    supported: mode !== 'none', mode, checking: mode === null,
    listening, transcribing, interim, level, speaking,
    muted, setMuted, conversation, setConversation,
    startListening, stopListening, toggleListening, speak, stopSpeaking, unlock,
  };
}

// A spoken version of a written reply when the server didn't send one: strip
// the markdown, keep the first couple of sentences, say pounds as words.
export function shortenForSpeech(text) {
  let s = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*[#>*-]+\s*/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = s.split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = '';
  for (const sent of sentences) { if ((out + ' ' + sent).length > 260) break; out = (out + ' ' + sent).trim(); if (out.split(/(?<=[.!?])\s+/).length >= 2) break; }
  if (!out) out = s.slice(0, 260);
  if (sentences.length > 2 || /\n\s*[-*]/.test(text || '')) out += ' The details are on screen.';
  return out.replace(/£\s?([\d,]+(?:\.\d{1,2})?)/g, (m, n) => poundsInWords(n)).replace(/(\d+(?:\.\d+)?)\s?%/g, '$1 per cent');
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function words(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' and ' + words(n % 100) : '');
  if (n < 1000000) return words(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? (n % 1000 < 100 ? ' and ' : ' ') + words(n % 1000) : '');
  return words(Math.floor(n / 1000000)) + ' million' + (n % 1000000 ? ' ' + words(n % 1000000) : '');
}
export function poundsInWords(numStr) {
  const n = parseFloat(String(numStr).replace(/,/g, ''));
  if (!Number.isFinite(n)) return '£' + numStr;
  const pounds = Math.floor(n); const pence = Math.round((n - pounds) * 100);
  let out = pounds === 0 ? 'zero pounds' : words(pounds) + (pounds === 1 ? ' pound' : ' pounds');
  if (pence) out += ' ' + words(pence) + (pence === 1 ? ' penny' : ' pence');
  return out;
}
