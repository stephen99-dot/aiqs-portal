// The Apple App Site Association file that turns portal links into app links.
const test = require('node:test');
const assert = require('node:assert');
const { buildAASA, DEFAULT_BUNDLE_ID } = require('./appLinks');

test('no Team ID means no file (iOS then treats the domain as having no app)', () => {
  assert.strictEqual(buildAASA({}), null);
  assert.strictEqual(buildAASA({ teamId: 'short' }), null);
});

test('a Team ID produces applinks + webcredentials for the bundle id', () => {
  const aasa = buildAASA({ teamId: 'ABCDE12345' });
  assert.deepStrictEqual(aasa.applinks.details[0].appIDs, ['ABCDE12345.' + DEFAULT_BUNDLE_ID]);
  assert.deepStrictEqual(aasa.webcredentials.apps, ['ABCDE12345.' + DEFAULT_BUNDLE_ID]);
  const paths = aasa.applinks.details[0].components;
  assert.ok(paths.some((c) => c['/'] === '/magic'), 'magic links open in the app');
  assert.ok(paths.some((c) => c['/'] === '/v/*'), 'variation approvals open in the app');
  assert.ok(paths[0]['/'] === '/api/*' && paths[0].exclude === true, 'API paths are excluded first');
});

test('a custom bundle id is honoured', () => {
  const aasa = buildAASA({ teamId: 'ABCDE12345', bundleId: 'com.example.app' });
  assert.deepStrictEqual(aasa.applinks.details[0].appIDs, ['ABCDE12345.com.example.app']);
});

// Android App Links
const { buildAssetLinks } = require('./appLinks');
const FP = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase().padStart(2, '0')).join(':');

test('assetlinks.json names the package and its signing fingerprints', () => {
  const body = buildAssetLinks({ fingerprints: FP.toLowerCase() + ' , ' + FP });
  assert.strictEqual(body[0].target.package_name, 'uk.co.theaiqs.portal');
  assert.deepStrictEqual(body[0].target.sha256_cert_fingerprints, [FP, FP]);
  assert.deepStrictEqual(body[0].relation, ['delegate_permission/common.handle_all_urls']);
});

test('no valid fingerprint means no assetlinks.json', () => {
  assert.strictEqual(buildAssetLinks({}), null);
  assert.strictEqual(buildAssetLinks({ fingerprints: 'not-a-fingerprint' }), null);
});
