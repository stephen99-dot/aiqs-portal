// The Apple App Site Association file that turns portal links into app links.
const test = require('node:test');
const assert = require('node:assert');
const { buildAASA, buildAssetLinks, DEFAULT_BUNDLE_ID } = require('./appLinks');

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

test('Android asset links need a well-formed SHA-256 fingerprint', () => {
  assert.strictEqual(buildAssetLinks({}), null);
  assert.strictEqual(buildAssetLinks({ sha256: 'not-a-fingerprint' }), null);
  const fp = Array(32).fill('AB').join(':');
  const links = buildAssetLinks({ sha256: fp.toLowerCase() + ', junk' });
  assert.strictEqual(links.length, 1);
  assert.strictEqual(links[0].target.package_name, DEFAULT_BUNDLE_ID);
  assert.deepStrictEqual(links[0].target.sha256_cert_fingerprints, [fp]);
  assert.ok(links[0].relation.includes('delegate_permission/common.handle_all_urls'));
});

test('a custom bundle id is honoured', () => {
  const aasa = buildAASA({ teamId: 'ABCDE12345', bundleId: 'com.example.app' });
  assert.deepStrictEqual(aasa.applinks.details[0].appIDs, ['ABCDE12345.com.example.app']);
});
