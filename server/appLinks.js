// Apple App Site Association (AASA) — the file iOS reads from the portal's
// domain to decide that links like https://<portal>/magic?token=… belong to
// the AI QS app and should open inside it (universal links) rather than in
// Safari. It also lets iOS Password AutoFill offer the website's saved
// password inside the app (webcredentials).
//
// Served at /.well-known/apple-app-site-association (and the legacy root
// path) as application/json, no redirect, no auth. Apple's CDN fetches it
// once per app install/update, so changes take up to 24h to reach devices.
//
// Configuration (both optional until the app ships):
//   APPLE_TEAM_ID   — the 10-character Team ID from developer.apple.com
//   IOS_BUNDLE_ID   — defaults to uk.co.theaiqs.portal (must match
//                     capacitor.config.json / the Xcode target)
//
// With no APPLE_TEAM_ID the route answers 404, which iOS treats as "no app" —
// safe to deploy before the app exists.
const express = require('express');

const DEFAULT_BUNDLE_ID = 'uk.co.theaiqs.portal';

// Paths the app knows how to open. Everything under /api is explicitly
// excluded so a tapped download link never tries to open the app.
const APP_PATHS = [
  { '/': '/api/*', exclude: true, comment: 'API responses stay in the browser' },
  { '/': '/magic', comment: 'magic sign-in link' },
  { '/': '/team-invite', comment: 'authorised-email invite' },
  { '/': '/auth/google/success', comment: 'Google sign-in return' },
  { '/': '/payment-success', comment: 'Stripe return' },
  { '/': '/v/*', comment: 'variation approval' },
  { '/': '/q/*', comment: 'quote acceptance' },
  { '/': '/i/*', comment: 'invoice' },
  { '/': '/project/*', comment: 'project pages' },
  { '/': '/dashboard' },
  { '/': '/submit-drawings' },
  { '/': '/chat' },
];

function buildAASA({ teamId, bundleId } = {}) {
  const team = String(teamId || '').trim();
  const bundle = String(bundleId || DEFAULT_BUNDLE_ID).trim();
  if (!/^[A-Z0-9]{10}$/i.test(team)) return null;
  const appID = `${team}.${bundle}`;
  return {
    applinks: {
      details: [{ appIDs: [appID], components: APP_PATHS }],
    },
    webcredentials: { apps: [appID] },
  };
}

// Android's equivalent: /.well-known/assetlinks.json says which signed app
// may open this site's links. Needs the SHA-256 fingerprint(s) of the app's
// signing certificate — for a Play Store app that is the "App signing key
// certificate" on Play Console → Setup → App signing (add the upload key's
// too, comma-separated, to test builds installed straight from Android Studio).
//
//   ANDROID_CERT_SHA256   e.g. "AB:CD:…:EF" or several, comma-separated
//   ANDROID_PACKAGE       defaults to uk.co.theaiqs.portal
function buildAssetLinks({ fingerprints, packageName } = {}) {
  const prints = String(fingerprints || '').split(',')
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  if (!prints.length) return null;
  return [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: String(packageName || DEFAULT_BUNDLE_ID).trim(), sha256_cert_fingerprints: prints },
  }];
}

const router = express.Router();
router.get('/.well-known/assetlinks.json', (req, res) => {
  const body = buildAssetLinks({ fingerprints: process.env.ANDROID_CERT_SHA256, packageName: process.env.ANDROID_PACKAGE });
  if (!body) return res.status(404).json({ error: 'App links are not configured (ANDROID_CERT_SHA256)' });
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/json').send(JSON.stringify(body));
});
router.get(['/.well-known/apple-app-site-association', '/apple-app-site-association'], (req, res) => {
  const body = buildAASA({ teamId: process.env.APPLE_TEAM_ID, bundleId: process.env.IOS_BUNDLE_ID });
  if (!body) return res.status(404).json({ error: 'Universal links are not configured (APPLE_TEAM_ID)' });
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/json').send(JSON.stringify(body));
});

module.exports = { router, buildAASA, buildAssetLinks, APP_PATHS, DEFAULT_BUNDLE_ID };
