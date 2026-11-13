// Push notifications: the parts that can be checked without Apple — key
// handling, the payload, and what happens to a device after each answer.
const test = require('node:test');
const assert = require('node:assert');

let push;
let DEPS_OK = true;
try {
  try { require('./database'); } catch (e) {
    const stub = { exec() {}, prepare: () => ({ run() {}, get() {}, all() { return []; } }) };
    require.cache[require.resolve('./database')] = { id: require.resolve('./database'), filename: require.resolve('./database'), loaded: true, exports: stub };
  }
  push = require('./pushNotifications');
} catch (e) { DEPS_OK = false; }
const skip = !DEPS_OK && 'deps not installed';

const PEM = '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg\nabcdefgh\n-----END PRIVATE KEY-----';

test('device tokens: 64+ hex characters only', { skip }, () => {
  assert.ok(push.isValidToken('a'.repeat(64)));
  assert.ok(push.isValidToken('0123456789ABCDEF'.repeat(5)));
  assert.ok(!push.isValidToken('a'.repeat(63)));
  assert.ok(!push.isValidToken('z'.repeat(64)));
  assert.ok(!push.isValidToken(null));
});

test('the .p8 key survives being pasted into an environment variable', { skip }, () => {
  const want = PEM + '\n';
  assert.strictEqual(push.normaliseKey(PEM), want);
  assert.strictEqual(push.normaliseKey(PEM.replace(/\n/g, '\\n')), want);
  assert.strictEqual(push.normaliseKey(Buffer.from(PEM).toString('base64')), want);
  assert.strictEqual(push.normaliseKey('  ' + PEM + '  \n'), want);
  assert.strictEqual(push.normaliseKey(''), '');
});

test('config reports exactly what is missing', { skip }, () => {
  assert.deepStrictEqual(push.readConfig({}).missing, ['APNS_KEY', 'APNS_KEY_ID', 'APPLE_TEAM_ID']);
  const cfg = push.readConfig({ APNS_KEY: PEM, APNS_KEY_ID: 'ABC1234567', APPLE_TEAM_ID: 'TEAM123456' });
  assert.ok(cfg.configured);
  assert.strictEqual(cfg.bundleId, 'uk.co.theaiqs.portal');
});

test('payload carries the alert and an in-app path, and nothing unsafe', { skip }, () => {
  const p = push.buildPayload({ title: 'Your job is ready', body: 'Foyle Road', path: '/project/abc' });
  assert.deepStrictEqual(p.aps.alert, { title: 'Your job is ready', body: 'Foyle Road' });
  assert.strictEqual(p.path, '/project/abc');
  assert.strictEqual(push.buildPayload({ title: 't', body: 'b', path: 'https://evil.example' }).path, undefined);
  assert.strictEqual(push.buildPayload({ title: 't', body: 'b', path: '//evil.example' }).path, undefined);
});

test('Apple\'s answers are read correctly', { skip }, () => {
  assert.strictEqual(push.classifyResponse(200, ''), 'ok');
  assert.strictEqual(push.classifyResponse(400, 'BadDeviceToken'), 'other_env');
  assert.strictEqual(push.classifyResponse(410, 'Unregistered'), 'drop');
  assert.strictEqual(push.classifyResponse(400, 'DeviceTokenNotForTopic'), 'drop');
  assert.strictEqual(push.classifyResponse(403, 'InvalidProviderToken'), 'fail');
  assert.strictEqual(push.classifyResponse(0, 'timeout'), 'fail');
});

test('a TestFlight token is sent to production; an Xcode token falls back to the sandbox and is remembered', { skip }, async () => {
  const calls = [];
  const prodOk = async (host) => { calls.push(host); return { status: 200, reason: '' }; };
  assert.deepStrictEqual(await push.deliver({ token: 't', sandbox: null }, {}, {}, prodOk), { outcome: 'ok', sandbox: 0 });
  assert.deepStrictEqual(calls, [push.HOSTS.production]);

  calls.length = 0;
  const sandboxOnly = async (host) => {
    calls.push(host);
    return host === push.HOSTS.sandbox ? { status: 200, reason: '' } : { status: 400, reason: 'BadDeviceToken' };
  };
  assert.deepStrictEqual(await push.deliver({ token: 't', sandbox: null }, {}, {}, sandboxOnly), { outcome: 'ok', sandbox: 1 });
  assert.deepStrictEqual(calls, [push.HOSTS.production, push.HOSTS.sandbox]);

  calls.length = 0;
  await push.deliver({ token: 't', sandbox: 1 }, {}, {}, sandboxOnly);
  assert.deepStrictEqual(calls, [push.HOSTS.sandbox], 'a known sandbox token goes straight there');
});

test('a dead token is dropped; a server-side fault keeps it', { skip }, async () => {
  const gone = async () => ({ status: 410, reason: 'Unregistered' });
  assert.strictEqual((await push.deliver({ token: 't' }, {}, {}, gone)).outcome, 'drop');
  const badBoth = async () => ({ status: 400, reason: 'BadDeviceToken' });
  assert.strictEqual((await push.deliver({ token: 't' }, {}, {}, badBoth)).outcome, 'drop');
  const badKey = async () => ({ status: 403, reason: 'InvalidProviderToken' });
  assert.deepStrictEqual(await push.deliver({ token: 't' }, {}, {}, badKey), { outcome: 'fail', reason: 'InvalidProviderToken' });
});
