// ═══ How-to videos — the catalogue, what's been watched, next steps ═══════════
// One fetch, cached for the session and shared by the videos page, the
// dashboard card and every "Watch how" button. Ticking a video off updates
// the cache and tells every listener (LEARN_EVENT).

import { apiFetch, API_ORIGIN } from './api';

export const LEARN_EVENT = 'aiqs:learn';
const PACKAGE_LABEL = { all: '', max: 'MAX', visualiser: 'MAX + Visualiser' };

let cache = null;
let inflight = null;

export function packageLabel(v) { return PACKAGE_LABEL[v && v.package] || ''; }

// The video files are served by the server (not the app bundle), so inside
// the iOS app they come from the portal's origin.
export function videoUrl(p) { return API_ORIGIN + p; }

export function loadLearn(force) {
  if (cache && !force) return Promise.resolve(cache);
  if (inflight && !force) return inflight;
  inflight = apiFetch('/learn').then((r) => { cache = r; inflight = null; return r; }).catch((e) => { inflight = null; throw e; });
  return inflight;
}

export function invalidateLearn() { cache = null; }

function announce() { try { window.dispatchEvent(new CustomEvent(LEARN_EVENT)); } catch (e) { /* no window */ } }

export async function setWatched(key, watched) {
  const r = await apiFetch('/learn/' + encodeURIComponent(key) + '/watched', { method: 'POST', body: JSON.stringify({ watched: !!watched }) });
  if (cache) {
    cache = { ...cache, videos: cache.videos.map((v) => (v.key === key ? { ...v, watched_at: r.watched_at || null } : v)), progress: r.progress || cache.progress };
  }
  announce();
  return r;
}

// The one-time pointer to the videos has been shown on this account.
export async function markIntroSeen() {
  if (cache) cache = { ...cache, intro_seen: true };
  try { await apiFetch('/learn/intro/seen', { method: 'POST', body: '{}' }); } catch (e) { /* it shows again next time, no worse */ }
}

// The first video not yet watched, in catalogue order.
export function nextVideo(data) {
  return data && data.videos ? data.videos.find((v) => !v.watched_at) || null : null;
}
