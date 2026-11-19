// The finished-room render survives OpenAI moving the goalposts: a retired
// model name is replaced by the newest image model on the key, and a request
// field the API no longer takes is dropped and the call tried again. The
// network is a scripted fetch; nothing leaves the process.
const test = require('node:test');
const assert = require('node:assert');

process.env.OPENAI_API_KEY = 'test-key';
delete process.env.OPENAI_IMAGE_MODEL;
const IR = require('./imageRender');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const realFetch = global.fetch;
function script(handlers) {
  const calls = [];
  global.fetch = async (url, init) => {
    const u = String(url);
    const sent = {};
    if (init && init.body && typeof init.body.get === 'function') for (const k of ['model', 'prompt', 'size', 'quality', 'input_fidelity', 'n', 'stream', 'partial_images']) if (init.body.has(k)) sent[k] = init.body.get(k);
    calls.push({ url: u, sent });
    const h = handlers.shift();
    const out = typeof h === 'function' ? h(u, sent) : h;
    if (out.sse) return new Response(out.sse, { status: out.status, headers: { 'content-type': 'text/event-stream' } });
    return { ok: out.status < 400, status: out.status, headers: { get: () => 'application/json' }, json: async () => out.body };
  };
  return calls;
}
test.after(() => { global.fetch = realFetch; });

test('a retired model name is swapped for the newest image model on the key, and the render goes through', async () => {
  IR._reset();
  const calls = script([
    { status: 400, body: { error: { message: "The model 'gpt-image-2.6-flare' does not exist." } } },
    { status: 200, body: { data: [{ id: 'gpt-image-1', created: 1700000000 }, { id: 'gpt-image-2.5-sunburst', created: 1750000000 }, { id: 'gpt-image-2.6-sunburst', created: 1760000000 }, { id: 'gpt-image-2.6-mini', created: 1770000000 }, { id: 'gpt-4.1', created: 1780000000 }] } },
    (u, sent) => ({ status: 200, body: { data: [{ b64_json: PNG.toString('base64') }] } }),
  ]);
  const out = await IR.renderRoom({ buffer: Buffer.from('jpegbytes'), mime: 'image/jpeg', width: 1200, height: 900, prompt: 'new tiles' });
  assert.equal(calls.length, 3);
  assert.ok(/images\/edits/.test(calls[0].url) && calls[0].sent.model === IR.DEFAULT_MODEL);
  assert.ok(/v1\/models$/.test(calls[1].url), 'asks OpenAI which models the key has');
  assert.equal(calls[2].sent.model, 'gpt-image-2.6-sunburst', 'the newest non-mini image model wins');
  assert.equal(calls[2].sent.size, '1536x1024', 'landscape photo → landscape render');
  assert.equal(out.model, 'gpt-image-2.6-sunburst');
  assert.ok(Buffer.isBuffer(out.buffer) && out.buffer.length === PNG.length);
  // The discovered model is remembered for the next render: no second lookup.
  const again = script([(u, sent) => ({ status: 200, body: { data: [{ b64_json: PNG.toString('base64') }] } })]);
  await IR.renderRoom({ buffer: Buffer.from('jpegbytes'), mime: 'image/jpeg', width: 800, height: 1200, prompt: 'paint it' });
  assert.equal(again.length, 1); assert.equal(again[0].sent.model, 'gpt-image-2.6-sunburst'); assert.equal(again[0].sent.size, '1024x1536');
});

test('a request field the API no longer takes is dropped and the call tried again', async () => {
  IR._reset();
  const calls = script([
    { status: 400, body: { error: { message: 'Unknown parameter: input_fidelity.' } } },
    { status: 400, body: { error: { message: "Invalid value for 'quality'." } } },
    (u, sent) => ({ status: 200, body: { data: [{ b64_json: PNG.toString('base64') }] } }),
  ]);
  const out = await IR.renderRoom({ buffer: Buffer.from('jpegbytes'), mime: 'image/jpeg', width: 1000, height: 1000, prompt: 'new bath' });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].sent.input_fidelity, 'high');
  assert.equal(calls[1].sent.input_fidelity, undefined); assert.equal(calls[1].sent.quality, 'high');
  assert.equal(calls[2].sent.quality, undefined);
  assert.equal(out.quality, 'default');
});

test('other failures come back as plain reasons, not retries forever', async () => {
  IR._reset();
  script([{ status: 400, body: { error: { message: 'Your request was rejected as a result of our safety system.' } } }]);
  await assert.rejects(() => IR.renderRoom({ buffer: Buffer.from('x'), mime: 'image/jpeg', prompt: 'p' }), (e) => e.name === 'RenderError' && e.status === 422 && /would not edit/.test(e.message));
  script([{ status: 401, body: { error: { message: 'bad key' } } }]);
  await assert.rejects(() => IR.renderRoom({ buffer: Buffer.from('x'), mime: 'image/jpeg', prompt: 'p' }), (e) => e.status === 503);
  const calls = script([{ status: 400, body: { error: { message: 'Something else entirely.' } } }]);
  await assert.rejects(() => IR.renderRoom({ buffer: Buffer.from('x'), mime: 'image/jpeg', prompt: 'p' }), (e) => e.status === 502 && /Something else/.test(e.message));
  assert.equal(calls.length, 1, 'an unrecognised 400 is not retried');
});

test('with a viewer watching, the picture is asked for as a stream and each rough pass is handed over', async () => {
  IR._reset();
  const b64 = PNG.toString('base64');
  const sse = [
    'event: image_edit.partial_image', 'data: ' + JSON.stringify({ type: 'image_edit.partial_image', b64_json: b64, partial_image_index: 0 }), '',
    'event: image_edit.partial_image', 'data: ' + JSON.stringify({ type: 'image_edit.partial_image', b64_json: b64, partial_image_index: 1 }), '',
    'event: image_edit.completed', 'data: ' + JSON.stringify({ type: 'image_edit.completed', b64_json: b64 }), '',
  ].join('\n');
  const calls = script([{ status: 200, sse }]);
  const passes = [];
  const out = await IR.renderRoom({ buffer: Buffer.from('jpegbytes'), mime: 'image/jpeg', width: 1200, height: 900, prompt: 'new tiles', onPartial: (buf, i) => passes.push([i, buf.length]) });
  assert.equal(calls[0].sent.model, IR.DEFAULT_MODEL);
  assert.deepEqual(passes, [[0, PNG.length], [1, PNG.length]]);
  assert.equal(out.buffer.length, PNG.length);
});

test('an API that cannot stream gets the plain request instead', async () => {
  IR._reset();
  const calls = script([
    { status: 400, body: { error: { message: 'Unknown parameter: stream.' } } },
    (u, sent) => ({ status: 200, body: { data: [{ b64_json: PNG.toString('base64') }] } }),
  ]);
  const out = await IR.renderRoom({ buffer: Buffer.from('jpegbytes'), mime: 'image/jpeg', width: 1000, height: 1000, prompt: 'new bath', onPartial: () => {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].sent.model, IR.DEFAULT_MODEL);
  assert.ok(out.buffer.length === PNG.length);
});
