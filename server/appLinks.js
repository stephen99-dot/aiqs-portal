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
  { '/': '/delete-account', exclude: true, comment: 'plain web page, stays in the browser' },
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

/**
 * Android's equivalent: Digital Asset Links. Needs the app's package name and
 * the SHA-256 fingerprint of the signing certificate — for an app on Google
 * Play that is the *app signing* key fingerprint shown in Play Console →
 * Test and release → App integrity (not the upload key). Several
 * fingerprints may be given, comma-separated (e.g. Play's key plus a debug
 * key for testing).
 */
function buildAssetLinks({ packageName, sha256 } = {}) {
  const pkg = String(packageName || DEFAULT_BUNDLE_ID).trim();
  const prints = String(sha256 || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  if (!prints.length) return null;
  return [{
    relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints },
  }];
}

const router = express.Router();
router.get('/.well-known/assetlinks.json', (req, res) => {
  const body = buildAssetLinks({ packageName: process.env.ANDROID_PACKAGE, sha256: process.env.ANDROID_SHA256_CERT });
  if (!body) return res.status(404).json({ error: 'Android app links are not configured (ANDROID_SHA256_CERT)' });
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
