'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { findLive, enrich, load } = require('./builder3dLiveRates');

test('the scraped catalogue loads', () => {
  assert.ok(load().length > 50, 'materials-live.json has products');
});

test('findLive matches on the product name, not stray aliases', () => {
  const pb = findLive(['plasterboard standard', 'plasterboard 12.5', 'plasterboard']);
  assert.ok(pb && /plasterboard/i.test(pb.material), 'plasterboard resolves to a plasterboard product');
  assert.ok(pb.price > 0 && pb.supplier, 'has a price and supplier');
  // No bath products in the catalogue -> must return null, not a bathroom tile.
  assert.equal(findLive(['bath']), null, 'no false-positive bath match');
});

test('enrich attaches live prices and flags priceable component lines', () => {
  const groups = [{
    category: 'Services',
    items: [
      { code: 'EL-002', label: 'Consumer unit' },
      { code: 'PH-006', label: 'Radiators' },
      { code: 'ZZ-999', label: 'Unknown' },
    ],
  }];
  const n = enrich(groups);
  assert.ok(n >= 1, 'matched at least one line');
  const cu = groups[0].items.find((i) => i.code === 'EL-002');
  assert.ok(cu.live && cu.live.priceable === true, 'consumer unit gets a priceable live price');
  assert.ok(!groups[0].items.find((i) => i.code === 'ZZ-999').live, 'unmapped code gets nothing');
});
