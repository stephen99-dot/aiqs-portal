// Web bundle updates for the iOS app.
//
// The app ships with a copy of the React build inside it. Without this, every
// screen change — a moved button, a new note — needs a Mac build and an App
// Store review before app users see it. Here the portal offers the build it
// is already serving to the website as a zip; the app (src/native/liveUpdate.js,
// via @capgo/capacitor-updater in manual mode) downloads it in the background
// and switches to it the next time it is reopened.
//
// Only HTML, CSS and JavaScript travel this way. Anything native — a new
// plugin, a permission, the icon — still needs a build from the Mac.
//
// Which installed apps get it is an explicit list, by native build number:
//
//   APP_LIVE_UPDATE_BUILDS   e.g. "2" or "2,3" (Render → Environment)
//
// Unset, nothing is offered to anyone. A build is added to the list only
// once Apple has approved it, so the copy a reviewer is testing always runs
// exactly the screens that were submitted. Leaving a build off the list is
// also how to keep an old shell away from screens that need a newer one.
//
// No third-party service is involved: the zip comes from this server, and the
// plugin's own cloud endpoints are switched off in capacitor.config.json.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const BUILD_DIR = path.join(__dirname, '..', 'build');

// The identity of a web build: a hash of CRA's asset-manifest.json, which
// names every hashed file in the build. The app computes the same hash from
// the manifest of the bundle it is running, so "is this what I already
// have?" needs no version numbers kept in step by hand.
//
// MUST stay identical to bundleVersion() in src/native/liveUpdate.js.
// (cyrb53 — a small non-cryptographic hash; this is an identity, not a
// security check. The download itself is verified by SHA-256 below.)
function bundleVersion(manifestText) {
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

// "2", "2,3", "2-5" → does it include this build number?
function buildAllowed(list, build) {
  const n = parseInt(build, 10);
  if (!Number.isFinite(n) || n <= 0) return false;
  for (const part of String(list || '').split(',')) {
    const p = part.trim();
    if (!p) continue;
    const range = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) { if (n >= +range[1] && n <= +range[2]) return true; continue; }
    if (/^\d+$/.test(p) && +p === n) return true;
  }
  return false;
}

// Files that have no business on the phone: source maps (several MB the app
// never reads) and anything hidden (the unpacker rejects dotfiles).
function shouldShip(relPath) {
  const parts = relPath.split('/');
  if (parts.some((p) => p.startsWith('.'))) return false;
  if (/\.map$/i.test(relPath)) return false;
  if (/\.LICENSE\.txt$/i.test(relPath)) return false;
  return true;
}

function listFiles(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

// Zip a build directory → { version, checksum, zip } or null when there is
// no usable build (development, or a deploy that has not built yet).
function packBundle(buildDir = BUILD_DIR) {
  const manifestPath = path.join(buildDir, 'asset-manifest.json');
  const indexPath = path.join(buildDir, 'index.html');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(indexPath)) return null;
  const version = bundleVersion(fs.readFileSync(manifestPath, 'utf8'));
  const zip = new AdmZip();
  // Sorted, with a fixed timestamp, so the same build always zips to the
  // same bytes and the checksum does not change across restarts.
  const stamp = new Date('2024-01-01T00:00:00Z');
  for (const rel of listFiles(buildDir).sort()) {
    if (!shouldShip(rel)) continue;
    zip.addFile(rel, fs.readFileSync(path.join(buildDir, rel)));
    const entry = zip.getEntry(rel);
    if (entry) entry.header.time = stamp;
  }
  const buf = zip.toBuffer();
  return { version, checksum: crypto.createHash('sha256').update(buf).digest('hex'), zip: buf };
}

// Built once per process: a deploy restarts the server, which is exactly
// when the build changes.
let cached;
function currentBundle() {
  if (cached === undefined) {
    try { cached = packBundle(); } catch (e) { console.error('[AppBundle] could not pack the build:', e.message); cached = null; }
    if (cached) console.log('[AppBundle] build ' + cached.version + ' ready (' + Math.round(cached.zip.length / 1024) + ' KB)');
  }
  return cached;
}

// The answer to "is there something newer than what I am running?"
function decide({ bundle, allowList, build, current, origin }) {
  if (!bundle) return { available: false, reason: 'no_build' };
  if (!buildAllowed(allowList, build)) return { available: false, reason: 'build_not_enabled' };
  if (current && current === bundle.version) return { available: false, reason: 'up_to_date', version: bundle.version };
  return {
    available: true,
    version: bundle.version,
    checksum: bundle.checksum,
    url: origin + '/api/app/bundle/' + bundle.version + '.zip',
  };
}

const router = express.Router();

router.get('/app/bundle', (req, res) => {
  // Behind Render's proxy req.protocol is http; the app only accepts https.
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = /^(localhost|127\.0\.0\.1)(:|$)/.test(host || '') ? req.protocol : 'https';
  res.set('Cache-Control', 'no-store');
  res.json(decide({
    bundle: currentBundle(),
    allowList: process.env.APP_LIVE_UPDATE_BUILDS,
    build: req.query.build,
    current: String(req.query.current || ''),
    origin: proto + '://' + host,
  }));
});

router.get('/app/bundle/:file', (req, res) => {
  const bundle = currentBundle();
  if (!bundle || req.params.file !== bundle.version + '.zip') return res.status(404).json({ error: 'No such bundle' });
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.type('application/zip').send(bundle.zip);
});

module.exports = { router, bundleVersion, buildAllowed, shouldShip, packBundle, decide };
