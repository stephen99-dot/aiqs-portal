// Unit tests for the BOQ → rate-library extraction (rateExtract.js): context
// prefixing for level rows and short extra-over lines, in-BOQ deduplication,
// variant handling when the same line carries different rates, and category
// inference. Shapes mirror parseBOQ() output for a drylining tender.

const test = require('node:test');
const assert = require('node:assert');

const { extractRateCandidates, inferCategory, itemKey, shortSectionTitle } = require('./rateExtract');

function section(title, items) {
  return { number: '1', title, items, subtotal: { labour: 0, materials: 0, total: 0 } };
}

test('level rows are prefixed with the section name and deduplicated per rate', () => {
  const parsed = {
    sections: [
      section('PT-01 Non fire rated standard apartment partition; 101mm overall; 1 layer 12.5mm', [
        { itemRef: '69G', description: 'Level 00; 2980mm high', unit: 'm', qty: 73, rate: 139.88, labour: 5207.91, materials: 5003.42, total: 10211.33 },
        { itemRef: '69H', description: 'Level 01; 2750mm high', unit: 'm', qty: 104, rate: 129.09, labour: 6846.84, materials: 6578, total: 13424.84 },
      ]),
    ],
  };
  const out = extractRateCandidates(parsed);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].display_name, 'PT-01 Non fire rated standard apartment partition — Level 00; 2980mm high');
  assert.strictEqual(out[0].value, 139.88);
  assert.strictEqual(out[0].unit, 'm');
  // Same level under a different section stays a distinct candidate — that is
  // the whole point of the prefix (PT-01 Level 01 ≠ PT-02 Level 01).
  assert.notStrictEqual(out[0].item_key, out[1].item_key);
});

test('repeated extra-over lines with the same rate collapse to one candidate', () => {
  const eo = (qty) => ({ itemRef: '', description: 'Angle to partition', unit: 'nr', qty, rate: 15.36, labour: 0, materials: 0, total: qty * 15.36 });
  const parsed = {
    sections: [
      section('Extra over for', [eo(90)]),
      section('Extra over for', [eo(130)]),
      section('Extra over for', [eo(28)]),
    ],
  };
  const out = extractRateCandidates(parsed);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].display_name, 'Extra over for — Angle to partition');
  assert.strictEqual(out[0].occurrences, 3);
  assert.strictEqual(out[0].qty_total, 248);
  assert.strictEqual(out[0].variant_rates, null);
});

test('same line at different rates keeps the highest-quantity rate and reports variants', () => {
  const parsed = {
    sections: [
      section('Extra over for', [
        { description: 'Forming single door opes', unit: 'nr', qty: 12, rate: 57.4, labour: 0, materials: 0, total: 688.8 },
        { description: 'Forming single door opes', unit: 'nr', qty: 64, rate: 104.2, labour: 0, materials: 0, total: 6668.8 },
      ]),
    ],
  };
  const out = extractRateCandidates(parsed);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].value, 104.2); // qty 64 beats qty 12
  assert.deepStrictEqual(out[0].variant_rates, [104.2, 57.4]);
});

test('rows without a positive rate (headers, summary echoes) are dropped', () => {
  const parsed = {
    sections: [
      section('SUMMARY', [
        { description: 'Section 1 — (22) Internal walls: stud partitions', unit: '', qty: 0, rate: 0, labour: 0, materials: 0, total: 317324.06 },
      ]),
      section('Wall linings', [
        { description: 'LT-01; 12.5mm plasterboard with 4mm skim finish on 35 x 50mm timber battens; tape and fill joints', unit: 'm2', qty: 287, rate: 27.44, labour: 4689.58, materials: 3185.7, total: 7875.28 },
      ]),
    ],
  };
  const out = extractRateCandidates(parsed);
  assert.strictEqual(out.length, 1);
  // Long, self-describing lines keep their own name — no section prefix.
  assert.match(out[0].display_name, /^LT-01; 12\.5mm plasterboard/);
});

test('rate falls back to total/qty when the rate column is empty', () => {
  const parsed = {
    sections: [
      section('Suspended ceilings', [
        { description: 'Access panels to ceiling; 450 x 450mm; including all fixings', unit: 'nr', qty: 55, rate: 0, labour: 1149.5, materials: 2530, total: 3679.5 },
      ]),
    ],
  };
  const out = extractRateCandidates(parsed);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].value, 66.9);
});

test('category inference maps drylining trades sensibly', () => {
  assert.strictEqual(inferCategory('SECTION 1 — (22) INTERNAL WALLS: STUD PARTITIONS', 'Level 00'), 'partitions');
  assert.strictEqual(inferCategory('CL-01 Timber or aluminium sub frame; 12.5mm plasterboard; 3mm skim coat', 'Level 00; depth of suspension'), 'plastering');
  assert.strictEqual(inferCategory('Groundworks', 'Trench excavation'), 'groundworks');
  assert.strictEqual(inferCategory('Something unrecognisable', 'Mystery line'), 'general');
});

test('itemKey matches the slug rule used by the existing my-rates imports', () => {
  assert.strictEqual(itemKey('Angle to partition'), 'angle_to_partition');
  assert.strictEqual(itemKey('  PT-01 — Level 00; 2980mm high  '), 'pt_01_level_00_2980mm_high');
});

test('shortSectionTitle trims at the first semicolon and caps length', () => {
  assert.strictEqual(
    shortSectionTitle('PW-02 Compartment / party wall with sacrificial liner one side; two layers 15mm Soundbloc'),
    'PW-02 Compartment / party wall with sacrificial liner one side'
  );
  const long = 'X'.repeat(120);
  assert.ok(shortSectionTitle(long).length <= 80);
});
