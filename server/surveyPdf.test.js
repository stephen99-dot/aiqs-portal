// The survey report's pages: the plans come first, the rooms run on down the
// page, the footer stays on its own page, and no page is spent on nothing.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { PassThrough } = require('stream');
const G = require('./surveyGeometry');
const { streamSurveyPdf } = require('./surveyPdf');

function room(name, extra = {}) {
  const r = { id: name, name, room_type: 'Room', floor_level: 'Ground', shape: 'rect', dims_source: 'stated', length_m: 4.5, width_m: 3.1, height_m: 2.4, openings: JSON.stringify([{ kind: 'door', count: 1, width_m: 0.84, height_m: 1.98, wall: 'C' }, { kind: 'window', count: 1, width_m: 1.5, height_m: 1.2, wall: 'A' }]), features: '[]', notes: '[]', ...extra };
  return { room: r, quantities: G.quantities(r), photos: [] };
}

function render(survey, rooms) {
  return new Promise((resolve, reject) => {
    const res = new PassThrough();
    res.setHeader = () => {};
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
    streamSurveyPdf(res, { survey, rooms, branding: { primary_colour: '#1B2A4A', company_name: 'Sam Builds Ltd' }, userInfo: { full_name: 'Sam' } });
  });
}

// The page count from the page tree, and every string drawn on any page:
// pdfkit deflates each page's content and writes text as hex glyph codes,
// which for Helvetica are the characters themselves.
function inspect(buf) {
  const s = buf.toString('latin1');
  const counts = [...s.matchAll(/\/Count (\d+)/g)].map((m) => +m[1]);
  let text = '';
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body;
    try { body = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch (e) { continue; }
    text += (body.match(/<([0-9a-fA-F]+)>/g) || []).map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1')).join('') + '\n';
  }
  return { pages: Math.max(0, ...counts), text };
}

test('a one-room survey is a single page: the room, its plan and its quantities, with the footer on it', async () => {
  const pdf = await render({ title: 'Room 1 survey', address: '7 Beck Road', customer_name: 'Stephen', created_at: '2026-11-20 10:00:00' }, [room('Room 1')]);
  const { pages, text } = inspect(pdf);
  assert.equal(pages, 1);
  assert.ok(text.includes('Page 1 of 1'));
  assert.ok(text.includes('Quantities'));
  assert.ok(!text.includes('Totals across the property'), 'one room has no totals to add up');
  assert.ok(!text.includes('Floor plans'), 'one room is its own plan');
});

test('several rooms open with every plan, then the totals, then the rooms one after another', async () => {
  const rooms = ['Kitchen', 'Bathroom', 'Hallway', 'Office', 'Office 2', 'Lounge'].map((n) => room(n, { ai_summary: 'Measured from the plans; assumes a 2.4 m ceiling throughout.' }));
  rooms[2] = room('Hallway', { dims_source: 'unknown', length_m: null, width_m: null });
  const { pages, text } = inspect(await render({ title: 'Kitchen and bathroom refit', notes: 'Parking on the drive.', created_at: '2026-11-18 10:00:00' }, rooms));
  const at = (s) => text.indexOf(s);
  assert.ok(at('Floor plans') > 0 && at('Floor plans') < at('Totals across the property'), 'plans before totals');
  assert.ok(at('Totals across the property') < at('Quantities'), 'the summary before the first room');
  assert.ok(pages >= 3 && pages <= 5, 'six rooms, each with openings and a note, take two to a page after the plans — not a page each: ' + pages);
  for (let i = 1; i <= pages; i++) assert.ok(text.includes('Page ' + i + ' of ' + pages), 'footer on page ' + i);
  assert.equal((text.match(/Check critical dimensions on site/g) || []).length, pages, 'the disclaimer once on every page');
});
