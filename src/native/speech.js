// Dictation inside the app with the iPhone's own speech recogniser. The
// native half is ios/App/App/SpeechPlugin.swift (Apple's Speech framework),
// so talking to MAX and dictating site notes need no speech-to-text key on
// the server. On the web `nativeSpeechStatus` is simply "not available" and
// useMaxVoice uses the server or the browser's recogniser instead.
import { registerPlugin } from '@capacitor/core';
import { isNative, hasPlugin } from './platform';

const Speech = registerPlugin('Speech');

export async function nativeSpeechStatus() {
  if (!isNative() || !hasPlugin('Speech')) return { available: false };
  try {
    const r = await Speech.available();
    return { available: !!(r && r.available) };
  } catch (e) { return { available: false }; }
}

// Both prompts (speech recognition, microphone). True when allowed.
export async function requestSpeechPermission() {
  const r = await Speech.requestPermissions();
  return !!(r && r.speechRecognition === 'granted');
}

// Start listening. `onPartial(text, final)` fires as the words land,
// `onStopped()` once when the recogniser has finished (after stop, silence,
// or an error). Returns a function that stops listening.
export async function startNativeListening({ language = 'en-GB', onPartial, onStopped } = {}) {
  const handles = [];
  let done = false;
  const finish = () => { if (done) return; done = true; handles.forEach((h) => { try { h.remove(); } catch (e) { /* fine */ } }); if (onStopped) onStopped(); };
  handles.push(await Speech.addListener('partialResults', (d) => { const text = d && Array.isArray(d.matches) ? String(d.matches[0] || '') : ''; if (onPartial) onPartial(text, !!(d && d.final)); }));
  handles.push(await Speech.addListener('listeningState', (d) => { if (d && d.status === 'stopped') finish(); }));
  try {
    await Speech.start({ language, partialResults: true });
  } catch (e) { finish(); throw e; }
  return async () => { try { await Speech.stop(); } catch (e) { /* already stopped */ } };
}
