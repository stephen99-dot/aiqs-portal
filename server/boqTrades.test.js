// Trade packages for a PARSED bill (the Builder Pack's data source): every
// line gets a trade from its description and section, each section is named
// by its dominant trade, and a builder's markup-by-trade maps onto the page's
// per-section uplift override.

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifySections, sectionOverridesFromTradeMarkup, lineValue } = require('./boqTrades');

const SECTIONS = () => [
  { number: '1', title: 'Preliminaries', items: [
    { description: 'Site set-up', labour: 1540, materials: 660 },
    { description: 'Independent access scaffold', labour: 11400, materials: 7600 },
  ] },
  { number: '2', title: 'Electrics', items: [
    { description: 'First fix electrics', labour: 900, materials: 600 },
    { description: 'EV charger supply & fit', labour: 0, materials: 0, total: 950 },
  ] },
  { number: '7', title: 'Mechanical', items: [
    { description: 'New combi boiler and radiators', labour: 2000, materials: 3000 },
    { description: 'Extract fans to bathrooms', labour: 200, materials: 300 },
  ] },
  { number: '9', title: 'Provisional Sums', provisional: true, items: [
    { description: 'PS for kitchen units', labour: 0, materials: 0, total: 5000 },
  ] },
];

test('lines are tagged and sections named by their dominant trade', () => {
  const secs = SECTIONS();
  const { sections, by_trade } = classifySections(secs);
  assert.deepEqual(sections.map((s) => s.trade), ['Preliminaries', 'Electrical', 'Plumbing & Heating', 'Fees & Provisional Sums']);
  // The mechanical section is mostly plumbing with an electrical fan line.
  assert.deepEqual(sections[2].trades.map((t) => t.trade), ['Plumbing & Heating', 'Electrical']);
  assert.equal(sections[2].trades[0].share_pct, 90.9);
  // Every input line now carries its trade (the page and export read it back).
  assert.equal(secs[1].items[1].trade, 'Electrical');
  assert.equal(secs[2].items[1].trade, 'Electrical');
  // A provisional section is carried at face value, whatever it is for.
  assert.equal(secs[3].items[0].trade, 'Fees & Provisional Sums');
  // By-trade view reconciles to the bill and lists the sections each draws on.
  const total = by_trade.reduce((a, t) => a + t.total, 0);
  const bill = secs.reduce((a, s) => a + s.items.reduce((x, it) => x + lineValue(it), 0), 0);
  assert.ok(Math.abs(total - bill) < 0.01);
  const elec = by_trade.find((t) => t.trade === 'Electrical');
  assert.equal(elec.item_count, 3);
  assert.deepEqual(elec.sections, ['2', '7']);
  assert.equal(elec.total, 2950);
});

test('markup by trade maps onto the sections that trade dominates, never provisional ones', () => {
  const seed = sectionOverridesFromTradeMarkup(SECTIONS(), { Electrical: 10, 'plumbing & heating': '12.5', 'Fees & Provisional Sums': 5, Roofing: 15, Bogus: 1 });
  assert.deepEqual(seed, { 2: 10, 7: 12.5 });
  assert.deepEqual(sectionOverridesFromTradeMarkup(SECTIONS(), {}), {});
  assert.deepEqual(sectionOverridesFromTradeMarkup(SECTIONS(), null), {});
});

test('composite lines carry their money in total', () => {
  assert.equal(lineValue({ labour: 0, materials: 0, total: 950 }), 950);
  assert.equal(lineValue({ labour: 900, materials: 600, total: 1 }), 1500);
  assert.equal(lineValue({ labour: -100, materials: 0, total: 50 }), -100);
});
