// Where to go after signing in or registering.
//
// The website sends people to the portal with a destination — "Start with
// MAX" lands on /register?next=/upgrade?plan=max — and a protected page that
// needs a sign-in sends them to /login?next=<that page>. The destination is
// kept in sessionStorage across the login or register and the onboarding
// steps, then used once. Only a path on this site is accepted, never a full
// address, so a link cannot bounce someone off to another site.

const KEY = 'aiqs_next';

export function safePath(v) {
  const s = String(v || '').trim();
  if (!s.startsWith('/') || s.startsWith('//') || /[\s<>]/.test(s)) return null;
  return s;
}

// The ?next= on the current address, if it is a path on this site.
export function nextFromUrl() {
  try { return safePath(new URLSearchParams(window.location.search).get('next')); } catch (e) { return null; }
}

export function rememberNext(path) {
  const p = safePath(path);
  try { if (p) sessionStorage.setItem(KEY, p); } catch (e) { /* storage blocked */ }
  return p;
}

// Use the remembered destination, once.
export function takeNext(fallback) {
  let p = null;
  try { p = safePath(sessionStorage.getItem(KEY)); sessionStorage.removeItem(KEY); } catch (e) { p = null; }
  return p || fallback;
}
