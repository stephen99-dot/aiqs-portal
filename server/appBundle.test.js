// The web bundle the iOS app updates itself from.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let bundle, AdmZip;
let DEPS_OK = true;
try { bundle = require('./appBundle'); AdmZip = require('adm-zip'); } catch (e) { DEPS_OK = false; }
const skip = !DEPS_OK && 'deps not installed';

function makeBuild(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  const files = {
    'index.html': '<!doctype html><div id="root"></div>',
    'asset-manifest.json': '{"files":{"main.js":"/static/js/main.abc123.js"}}',
    'static/js/main.abc123.js': 'console.log(1)',
    'static/js/main.abc123.js.map': '{"mappings":""}',
    'static/js/main.abc123.js.LICENSE.txt': 'MIT',
    '.DS_Store': 'junk',
    ...extra,
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

test('the bundle version is a stable hash of the asset manifest', { skip }, () => {
  // Known vectors — src/native/liveUpdate.js must produce the same values.
  assert.strictEqual(bundle.bundleVersion(''), bundle.bundleVersion(''));
  assert.strictEqual(bundle.bundleVersion('{"files":{}}'), '0dfdf61f73ce6b');
  assert.strictEqual(bundle.bundleVersion('hello'), '106f3a63cd7226');
  assert.notStrictEqual(bundle.bundleVersion('{"a":1}'), bundle.bundleVersion('{"a":2}'));
  assert.match(bundle.bundleVersion('x'), /^[0-9a-f]{14}$/);
});

test('only listed native builds are offered a bundle', { skip }, () => {
  assert.ok(!bundle.buildAllowed('', 2), 'unset means nobody');
  assert.ok(!bundle.buildAllowed(undefined, 2));
  assert.ok(bundle.buildAllowed('2', '2'));
  assert.ok(!bundle.buildAllowed('2', 3), 'a build still in review is not on the list');
  assert.ok(bundle.buildAllowed('2, 3', 3));
  assert.ok(bundle.buildAllowed('2-5', 4));
  assert.ok(!bundle.buildAllowed('2-5', 6));
  assert.ok(!bundle.buildAllowed('2', 'abc'));
  assert.ok(!bundle.buildAllowed('2', undefined));
});

test('the zip holds the app and leaves out source maps and hidden files', { skip }, () => {
  const dir = makeBuild();
  const b = bundle.packBundle(dir);
  const names = new AdmZip(b.zip).getEntries().map((e) => e.entryName).sort();
  assert.deepStrictEqual(names, ['asset-manifest.json', 'index.html', 'static/js/main.abc123.js']);
  assert.strictEqual(b.checksum, crypto.createHash('sha256').update(b.zip).digest('hex'));
  assert.strictEqual(b.version, bundle.bundleVersion(fs.readFileSync(path.join(dir, 'asset-manifest.json'), 'utf8')));
  // Same build → same bytes, so the checksum survives a restart.
  assert.strictEqual(bundle.packBundle(dir).checksum, b.checksum);
});

test('no build on disk means no bundle', { skip }, () => {
  assert.strictEqual(bundle.packBundle(fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'))), null);
});

test('the update answer', { skip }, () => {
  const b = { version: 'v2', checksum: 'abc', zip: Buffer.alloc(1) };
  const origin = 'https://portal.example';
  assert.deepStrictEqual(bundle.decide({ bundle: null, allowList: '2', build: 2, current: 'v1', origin }), { available: false, reason: 'no_build' });
  assert.strictEqual(bundle.decide({ bundle: b, allowList: '', build: 2, current: 'v1', origin }).reason, 'build_not_enabled');
  assert.strictEqual(bundle.decide({ bundle: b, allowList: '2', build: 2, current: 'v2', origin }).reason, 'up_to_date');
  assert.deepStrictEqual(bundle.decide({ bundle: b, allowList: '2', build: 2, current: 'v1', origin }), {
    available: true, version: 'v2', checksum: 'abc', url: 'https://portal.example/api/app/bundle/v2.zip',
  });
});
