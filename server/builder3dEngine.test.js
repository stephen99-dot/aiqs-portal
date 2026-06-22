'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normaliseInputs, computeQuantities, priceModel } = require('./builder3dEngine');

// A stub rate library: every code returns £10 labour + £10 materials (£20
// total) so line totals are easy to predict in assertions.
function flatLookup() {
  return { description: 'stub', unit: 'm2', labour_rate: 10, material_rate: 10, total_rate: 20 };
}

test('normaliseInputs clamps wild values and defaults bad enums', () => {
  const m = normaliseInputs({ length: 9999, width: -5, storeys: 99, roofPitch: 1000, wallType: 'nope', roofCovering: 'bogus' });
  assert.equal(m.length, 60, 'length clamps to 60');
  assert.equal(m.width, 2, 'width clamps to min 2');
  assert.equal(m.storeys, 4, 'storeys clamps to 4');
  assert.equal(m.roofPitch, 60, 'pitch clamps to 60');
  assert.equal(m.wallType, 'cavity', 'bad wall type falls back to cavity');
  assert.equal(m.roofCovering, 'concrete_tile', 'bad covering falls back to concrete tile');
});

test('computeQuantities derives sane geometry for a 10x6 single storey', () => {
  const m = normaliseInputs({ length: 10, width: 6, wallHeight: 2.5, storeys: 1, roofPitch: 30, windows: 8, doors: 2 });
  const q = computeQuantities(m);
  assert.equal(q.perimeter, 32, 'perimeter = 2*(10+6)');
  assert.equal(q.footprint, 60, 'footprint = 10*6');
  assert.equal(q.wallGross, 80, 'gross wall = 32 * 2.5 * 1');
  // openings = 8*1.6 + 2*1.9 = 12.8 + 3.8 = 16.6
  assert.equal(q.wallNet, 63.4, 'net wall = gross - openings');
  // roof slope = 60 / cos(30°) ≈ 69.28
  assert.ok(Math.abs(q.roofSlopeArea - 69.28) < 0.1, 'roof slope area uses pitch');
  assert.equal(q.ridgeLength, 10, 'ridge runs along the long side');
});

test('priceModel totals: cost -> +OH&P -> +VAT', () => {
  const out = priceModel(
    { length: 10, width: 6, wallHeight: 2.5, storeys: 1, roofPitch: 30, windows: 8, doors: 2, ohpPct: 15, vatPct: 20 },
    flatLookup
  );
  const { cost, profit, subtotal, vat, total } = out.totals;
  assert.ok(cost > 0, 'cost is positive');
  assert.equal(profit, Math.round(cost * 0.15 * 100) / 100, 'profit = 15% of cost');
  assert.equal(subtotal, Math.round((cost + profit) * 100) / 100, 'subtotal = cost + profit');
  assert.equal(vat, Math.round(subtotal * 0.20 * 100) / 100, 'VAT = 20% of subtotal');
  assert.equal(total, Math.round((subtotal + vat) * 100) / 100, 'total = subtotal + VAT');
});

test('priceModel groups lines and reports missing rate codes', () => {
  // Lookup that only knows about wall + window codes — everything else missing.
  const partial = (code) => (['BW-013', 'CJ-022'].includes(code) ? flatLookup() : null);
  const out = priceModel({ length: 8, width: 6, windows: 4, doors: 0 }, partial);
  assert.ok(out.missing.length > 0, 'reports the codes it could not price');
  assert.ok(out.groups.every((g) => g.items.length > 0), 'no empty groups returned');
  const allLines = out.groups.flatMap((g) => g.items);
  assert.ok(allLines.every((l) => l.total >= 0), 'no negative line totals');
});

test('priceModel skips zero-quantity elements (no doors -> no door line)', () => {
  const out = priceModel({ length: 8, width: 6, windows: 4, doors: 0 }, flatLookup);
  const allLines = out.groups.flatMap((g) => g.items);
  assert.ok(!allLines.some((l) => l.code === 'CJ-019'), 'door line omitted when doors = 0');
  assert.ok(allLines.some((l) => l.code === 'CJ-022'), 'window line present when windows > 0');
});
