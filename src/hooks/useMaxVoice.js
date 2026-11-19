import { useState, useRef, useCallback, useEffect } from 'react';
import { API_BASE, getToken } from '../utils/api';
import { isNative } from '../native/platform';
import { nativeSpeechStatus, requestSpeechPermission, startNativeListening } from '../native/speech';

// ═══ useMaxVoice — the microphone ════════════════════════════════════════════
// Speech in only: MAX does not talk back. Three ways to hear, tried in order:
//
//   native   inside the iOS app, the iPhone's own speech recogniser through
//            the app's Speech plugin (src/native/speech.js). Free, no key,
//            words land as they are said.
//   server   MediaRecorder audio posted to POST /api/transcribe (OpenAI or
//            Deepgram, when the server has a key).
//   web      a desktop browser's own Web Speech API. WKWebView exposes one
//            that never actually works, so it is never used inside the app.
//
// Interaction: tap to talk, tap to stop, auto-stop after a short silence; the
// live transcript and the input level are exposed so a page can show words as
// they land and a waveform that moves with the voice.
//
// Privacy: audio never leaves memory on either side — it is turned into text
// and dropped; only the text goes into the thread.

const SILENCE_MS = 1800;        // quiet this long after speech ends the recording
const MAX_RECORD_MS = 60000;    // a forgotten mic never runs forever
const SPEECH_LEVEL = 0.035;     // RMS above this counts as talking
const NOT_ON = 'Voice isn\'t available in this version of the app yet — update the app, or type for now.';

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

export default function useMaxVoice({ onFinal, onInterim, onError } = {}) {
  const [mode, setMode] = useState(null);       // 'native' | 'server' | 'web' | 'none' | null (checking)
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0);

  const recRef = useRef(null);        // MediaRecorder
  const streamRef = useRef(null);     // MediaStream
  const webRecRef = useRef(null);     // SpeechRecognition
  const nativeStopRef = useRef(null); // () => stop the iPhone recogniser
  const nativeTimerRef = useRef(null);
  const ctxRef = useRef(null);        // AudioContext for levels
  const rafRef = useRef(0);
  const onFinalRef = useRef(onFinal); onFinalRef.current = onFinal;
  const onInterimRef = useRef(onInterim); onInterimRef.current = onInterim;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;

  const native = isNative();
  const webSupported = !native && typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const canRecord = typeof window !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof MediaRecorder !== 'undefined';

  useEffect(() => {
    let gone = false;
    (async () => {
      if (native) {
        const s = await nativeSpeechStatus();
        if (gone) return;
        if (s.available) { setMode('native'); return; }
      }
      const server = canRecord && await serverSttAvailable();
      if (gone) return;
      setMode(server ? 'server' : (webSupported ? 'web' : 'none'));
    })();
    return () => { gone = true; };
  }, [native, canRecord, webSupported]);

  // Warm the audio path on a user gesture so the level meter can run.
  const unlock = useCallback(() => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !ctxRef.current) ctxRef.current = new AC();
      if (ctxRef.current && ctxRef.current.state === 'suspended') ctxRef.current.resume().catch(() => {});
    } catch (e) { /* fine */ }
  }, []);

  // ── Listening: the iPhone's own recogniser ────────────────────────────────
  const startNative = useCallback(async () => {
    const allowed = await requestSpeechPermission();
    if (!allowed) { if (onErrorRef.current) onErrorRef.current('Allow the microphone and speech recognition for AI QS in the iPhone Settings, then try again.'); return; }
    let latest = '';
    let hard = null;
    const clearTimers = () => { clearTimeout(nativeTimerRef.current); nativeTimerRef.current = null; clearTimeout(hard); };
    const stop = await startNativeListening({
      language: 'en-GB',
      onPartial: (text) => {
        latest = text;
        setInterim(text); if (onInterimRef.current) onInterimRef.current(text);
        setLevel(0.5);
        // Nothing new for a while after some words → done.
        clearTimeout(nativeTimerRef.current);
        if (text.trim()) nativeTimerRef.current = setTimeout(() => { if (nativeStopRef.current) nativeStopRef.current(); }, SILENCE_MS);
      },
      onStopped: () => {
        clearTimers();
        nativeStopRef.current = null;
        setListening(false); setLevel(0);
        setInterim(''); if (onInterimRef.current) onInterimRef.current('');
        const said = latest.replace(/\s+/g, ' ').trim();
        if (said && onFinalRef.current) onFinalRef.current(said);
        else if (!said && onErrorRef.current) onErrorRef.current('I didn\'t catch that — try again.');
      },
    });
    nativeStopRef.current = stop;
    hard = setTimeout(() => { if (nativeStopRef.current) nativeStopRef.current(); }, MAX_RECORD_MS);
    setListening(true);
    setInterim('');
  }, []);

  // ── Listening: server STT via MediaRecorder ───────────────────────────────
  const teardownRecording = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (streamRef.current) { try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch (e) { /* ignore */ } streamRef.current = null; }
    recRef.current = null;
    setLevel(0);
  }, []);

  const stopListening = useCallback(() => {
    if (nativeStopRef.current) { nativeStopRef.current(); }
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
      if (r.status === 503) {
        serverSttKnown = false;
        setMode(webSupported ? 'web' : 'none');
        if (onErrorRef.current) onErrorRef.current(webSupported ? 'Server dictation is not set up — using the browser\'s voice recognition instead.' : NOT_ON);
        return;
      }
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

  // ── Listening: Web Speech fallback (desktop browsers, push-to-talk) ───────
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

  // Tap to talk.
  const startListening = useCallback(async () => {
    unlock();
    if (mode === 'native') {
      try { await startNative(); }
      catch (e) {
        const msg = e && e.message ? String(e.message) : '';
        if (onErrorRef.current) onErrorRef.current(/Settings|allowed/i.test(msg) ? msg : (msg || 'Could not start the microphone.'));
        setListening(false);
      }
      return;
    }
    if (mode === 'server') {
      try { await startServerListening(); return; }
      catch (e) {
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) { if (onErrorRef.current) onErrorRef.current(native ? 'Microphone blocked — allow it for AI QS in the iPhone Settings and try again.' : 'Microphone blocked — allow the mic for this site and try again.'); return; }
        // Recording failed for another reason: try the browser recogniser.
        if (webSupported) { startWebListening(); return; }
        if (onErrorRef.current) onErrorRef.current('Could not start the microphone.');
        return;
      }
    }
    if (mode === 'web' || webSupported) { startWebListening(); return; }
    if (onErrorRef.current) onErrorRef.current(mode === null ? 'One moment — checking the microphone…' : native ? NOT_ON : 'Voice isn\'t available in this browser — type to MAX instead.');
  }, [mode, native, webSupported, unlock, startNative, startServerListening, startWebListening]);

  const toggleListening = useCallback(() => { if (listening) stopListening(); else startListening(); }, [listening, startListening, stopListening]);

  useEffect(() => () => { stopListening(); teardownRecording(); clearTimeout(nativeTimerRef.current); }, [stopListening, teardownRecording]);

  return {
    // Inside the app the mic is always shown: a tap either records, or says
    // plainly what is missing. In a browser it is hidden when nothing can hear.
    supported: mode !== 'none' || native, mode, checking: mode === null,
    listening, transcribing, interim, level,
    startListening, stopListening, toggleListening, unlock,
  };
}
