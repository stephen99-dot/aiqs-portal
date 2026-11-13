// Keeps the app's screens in step with the website without a new App Store
// build. The portal offers the web build it is serving as a zip
// (server/appBundle.js); this downloads it in the background and queues it,
// and the app switches to it the next time it is reopened. Nothing is shown
// to the user and nothing reloads under them.
//
// Uses @capgo/capacitor-updater in manual mode, against our own server only.
// If a downloaded bundle fails to start, the plugin rolls back to the last
// one that did (confirmReady() is the "it started" signal).
//
// On the web, and in an app build without the plugin, everything here is a
// no-op.
import { App as CapApp } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { isNative, hasPlugin, platform } from './platform';
import { apiUrl } from '../utils/api';

const PLUGIN = 'CapacitorUpdater';
const CHECK_EVERY_MS = 30 * 60 * 1000;
let lastCheck = 0;
let checking = false;

const available = () => isNative() && hasPlugin(PLUGIN);

// The identity of a web build: a hash of its asset-manifest.json.
// MUST stay identical to bundleVersion() in server/appBundle.js (cyrb53).
export function bundleVersion(manifestText) {
  const str = String(manifestText || '');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

// Tell the plugin this bundle started. Without it a freshly applied bundle is
// treated as broken and rolled back, so call it as early as possible.
export function confirmReady() {
  if (!available()) return;
  CapacitorUpdater.notifyAppReady().catch(() => {});
}

// What is this app running right now? Read from the running bundle itself.
async function runningVersion() {
  const res = await fetch('/asset-manifest.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('no manifest');
  return bundleVersion(await res.text());
}

// Ask the portal whether its build differs from ours; if so fetch it and
// queue it for the next reopen. Safe to call often — it throttles itself.
export async function checkForNewBundle({ force = false } = {}) {
  if (!available() || checking) return;
  const now = Date.now();
  if (!force && now - lastCheck < CHECK_EVERY_MS) return;
  checking = true;
  lastCheck = now;
  try {
    const [current, info] = await Promise.all([runningVersion(), CapApp.getInfo()]);
    const qs = `platform=${encodeURIComponent(platform())}&build=${encodeURIComponent(info.build || '')}&current=${encodeURIComponent(current)}`;
    const res = await fetch(apiUrl('/app/bundle?' + qs), { cache: 'no-store' });
    if (!res.ok) return;
    const offer = await res.json();
    if (!offer || !offer.available || !offer.url || !offer.version) return;

    // Already fetched on an earlier run (the app has not been reopened
    // since)? Queue that copy rather than downloading it again.
    let bundle = null;
    try {
      const { bundles } = await CapacitorUpdater.list();
      bundle = (bundles || []).find((b) => b.version === offer.version && b.status !== 'error') || null;
    } catch (e) { /* fall through to download */ }
    if (!bundle) {
      bundle = await CapacitorUpdater.download({ url: offer.url, version: offer.version, checksum: offer.checksum });
    }
    if (bundle && bundle.id) await CapacitorUpdater.next({ id: bundle.id });
  } catch (e) {
    // Offline, mid-deploy, or a bad download: try again at the next check.
  } finally {
    checking = false;
  }
}
