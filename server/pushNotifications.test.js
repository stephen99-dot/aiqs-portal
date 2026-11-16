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

// ── Android (Firebase Cloud Messaging) ─────────────────────────────────────
const FCM_TOKEN = 'dQw4w9WgXcQ:APA91b' + 'A1b2C3d4E5_-'.repeat(12);

test('Android tokens are accepted as Android, and never case-folded into a different token', { skip }, () => {
  assert.ok(push.isValidToken(FCM_TOKEN, 'android'));
  assert.ok(!push.isValidToken(FCM_TOKEN, 'ios'), 'an FCM token is not an APNs token');
  assert.ok(!push.isValidToken('short', 'android'));
  assert.ok(!push.isValidToken('a'.repeat(64) + ' <script>', 'android'));
});

test('the Firebase service-account file is read from the environment', { skip }, () => {
  assert.deepStrictEqual(push.readFcmConfig({}).missing, ['FCM_SERVICE_ACCOUNT']);
  assert.ok(!push.readFcmConfig({ FCM_SERVICE_ACCOUNT: '{not json' }).configured);
  assert.ok(!push.readFcmConfig({ FCM_SERVICE_ACCOUNT: '{"project_id":"p"}' }).configured);
  const file = JSON.stringify({ project_id: 'aiqs-1', client_email: 'x@aiqs-1.iam.gserviceaccount.com', private_key: PEM.replace(/\n/g, '\\n') });
  const cfg = push.readFcmConfig({ FCM_SERVICE_ACCOUNT: file });
  assert.ok(cfg.configured);
  assert.strictEqual(cfg.projectId, 'aiqs-1');
  assert.ok(cfg.key.includes('\n'), 'escaped newlines in the key are restored');
  assert.ok(push.readFcmConfig({ FCM_SERVICE_ACCOUNT: Buffer.from(file).toString('base64') }).configured);
});

test('the Android message carries the alert, the channel and an in-app path', { skip }, () => {
  const m = push.buildFcmMessage(FCM_TOKEN, { title: 'Your job is ready', body: 'Foyle Road', path: '/project/abc' }).message;
  assert.strictEqual(m.token, FCM_TOKEN);
  assert.deepStrictEqual(m.notification, { title: 'Your job is ready', body: 'Foyle Road' });
  assert.strictEqual(m.android.notification.channel_id, 'jobs');
  assert.deepStrictEqual(m.data, { path: '/project/abc' });
  assert.strictEqual(push.buildFcmMessage(FCM_TOKEN, { title: 't', body: 'b', path: 'https://evil.example' }).message.data, undefined);
});

test('Google\'s answers are read correctly', { skip }, () => {
  assert.strictEqual(push.classifyFcmResponse(200, ''), 'ok');
  assert.strictEqual(push.classifyFcmResponse(404, 'UNREGISTERED'), 'drop');
  assert.strictEqual(push.classifyFcmResponse(400, 'INVALID_ARGUMENT'), 'drop');
  assert.strictEqual(push.classifyFcmResponse(403, 'SENDER_ID_MISMATCH'), 'drop');
  assert.strictEqual(push.classifyFcmResponse(401, 'UNAUTHENTICATED'), 'fail');
  assert.strictEqual(push.classifyFcmResponse(503, 'UNAVAILABLE'), 'fail');
});

test('an Android send signs in to Google, posts to the project, and reports the outcome', { skip }, async () => {
  const { generateKeyPairSync } = require('crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cfg = { projectId: 'aiqs-1', clientEmail: 'unit-' + Date.now() + '@aiqs-1.iam.gserviceaccount.com', key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const calls = [];
  const fakeFetch = (answer) => async (url, opts) => {
    calls.push({ url, opts });
    if (/oauth2/.test(url)) return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.test' }) };
    return answer;
  };
  const ok = await push.deliverFcm({ token: FCM_TOKEN }, { title: 't', body: 'b', path: '/project/1' }, cfg, fakeFetch({ status: 200, json: async () => ({}) }));
  assert.deepStrictEqual(ok, { outcome: 'ok' });
  assert.match(calls[0].opts.body, /grant_type=.*jwt-bearer.*assertion=/);
  assert.strictEqual(calls[1].url, 'https://fcm.googleapis.com/v1/projects/aiqs-1/messages:send');
  assert.strictEqual(calls[1].opts.headers.authorization, 'Bearer ya29.test');
  assert.strictEqual(JSON.parse(calls[1].opts.body).message.token, FCM_TOKEN);

  const gone = await push.deliverFcm({ token: FCM_TOKEN }, { title: 't', body: 'b' }, cfg, fakeFetch({
    status: 404, json: async () => ({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }),
  }));
  assert.deepStrictEqual(gone, { outcome: 'drop', reason: 'UNREGISTERED' });
});
