// boqTrades.js — trade packages for a PARSED bill (the Builder Pack's data
// source, i.e. parseBOQ output or the page's edited sections), as opposed to
// the pricer's own lines, which are tagged at pricing time.
//
// The classification is the pricer's keyword ladder (tradeForItem) fed with
// the line description and its section title — a parsed bill has no item key —
// so a section on the Builder Pack lands in the same trade the live BOQ would
// give it. Pure functions; the routes and the export call them.

const { tradeForItem, TRADES, normaliseTradeMarkup } = require('./deterministicPricer');

const TRADE_RANK = {};
TRADES.forEach((t, i) => { TRADE_RANK[t] = i; });

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function round2(n) { return Math.round((num(n) + Number.EPSILON) * 100) / 100; }

// A line's money: labour + materials, or the composite total when there is no
// split (the same rule the Builder Pack page and assistant use).
function lineValue(it) {
  const l = num(it && it.labour), m = num(it && it.materials);
  if (l !== 0 || m !== 0) return l + m;
  return num(it && it.total);
}

function tradeForLine(item, sectionTitle) {
  return tradeForItem({ key: '', description: item && item.description, section: sectionTitle, unit: item && item.unit });
}

/**
 * Tag every line with its trade and name each section's dominant trade.
 *
 * Returns { sections: [{ number, title, provisional, trade, trades: [{ trade, value, share_pct }] }],
 *           by_trade: [{ trade, item_count, labour, materials, total, share_pct, sections: [number] }] }
 * and, as a convenience, sets `trade` on each item object passed in (a copy is
 * not made — callers that hand the sections to the client want the tag on the
 * line).
 */
function classifySections(sections) {
  const out = [];
  const acc = {};
  let grand = 0;
  for (const sec of (sections || [])) {
    const title = String(sec.title || sec.name || '');
    const mix = {};
    let secTotal = 0;
    for (const it of (sec.items || [])) {
      if (!it) continue;
      // A provisional-sums section is carried at face value, exclusive of
      // OH&P, whatever the sums are for — so it is never split into trades.
      const trade = sec.provisional ? 'Fees & Provisional Sums'
        : (it.trade && TRADES.includes(it.trade) ? it.trade : tradeForLine(it, title));
      it.trade = trade;
      const v = lineValue(it);
      secTotal += v;
      mix[trade] = (mix[trade] || 0) + v;
      const t = acc[trade] || (acc[trade] = { trade, item_count: 0, labour: 0, materials: 0, total: 0, sections: new Set() });
      t.item_count++;
      t.labour += num(it.labour);
      t.materials += num(it.materials);
      t.total += v;
      if (sec.number != null && sec.number !== '') t.sections.add(String(sec.number));
    }
    grand += secTotal;
    const trades = Object.entries(mix)
      .sort((a, b) => b[1] - a[1] || (TRADE_RANK[a[0]] - TRADE_RANK[b[0]]))
      .map(([trade, value]) => ({ trade, value: round2(value), share_pct: secTotal > 0 ? Math.round((value / secTotal) * 1000) / 10 : 0 }));
    // Dominant trade by value; a section with no priced lines falls back to
    // what its title says.
    const dominant = sec.provisional ? 'Fees & Provisional Sums'
      : (trades.length ? trades[0].trade : tradeForItem({ key: '', description: '', section: title }));
    out.push({ number: sec.number, title, provisional: !!sec.provisional, trade: dominant, trades });
  }
  const byTrade = Object.values(acc)
    .sort((a, b) => (TRADE_RANK[a.trade] ?? 999) - (TRADE_RANK[b.trade] ?? 999))
    .map((t) => ({
      trade: t.trade,
      item_count: t.item_count,
      labour: round2(t.labour),
      materials: round2(t.materials),
      total: round2(t.total),
      share_pct: grand > 0 ? Math.round((t.total / grand) * 1000) / 10 : 0,
      sections: Array.from(t.sections),
    }));
  return { sections: out, by_trade: byTrade };
}

/**
 * Map a builder's markup-by-trade ({ 'Electrical': 10, … }) onto the Builder
 * Pack's per-SECTION uplift override ({ [sectionNumber]: pct }): a section
 * takes the figure of its dominant trade when that trade has one. Provisional
 * sections are never uplifted, so they are skipped. Returns only the sections
 * that get a figure.
 */
function sectionOverridesFromTradeMarkup(sections, tradeMarkup) {
  const map = normaliseTradeMarkup(tradeMarkup);
  const out = {};
  if (!Object.keys(map).length) return out;
  const { sections: classified } = classifySections(sections);
  for (const s of classified) {
    if (s.provisional || s.number == null || s.number === '') continue;
    if (Object.prototype.hasOwnProperty.call(map, s.trade)) out[String(s.number)] = map[s.trade];
  }
  return out;
}

module.exports = { classifySections, sectionOverridesFromTradeMarkup, lineValue, tradeForLine, TRADES };
