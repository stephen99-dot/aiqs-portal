// Rate extraction from a parsed BOQ (parseBOQ output) into candidates for the
// user's rate library (client_rate_library). Pure functions — no db, no I/O —
// so the whole pipeline is unit-testable. The routes in rateImportRoutes.js
// compare the candidates against what the user already has and apply the ones
// they choose to import.

// Categories mirror the MyRatesPage picker. First matching rule wins, so the
// more specific trades sit above the broader ones (partitions before
// plastering, bathroom before plumbing).
const CATEGORY_RULES = [
  ['partitions', /partition|\bstuds?\b|stud wall|metal stud|timber stud|drylin|dry lining|wall lining|soundbloc|gypframe|gyplyner|door ope/],
  ['structural_steel', /structural steel|steelwork|\bbeam\b|\brsj\b|universal column/],
  ['demolition', /demoli|strip out|take down|removal of|breaking out/],
  ['groundworks', /groundwork|excavat|foundation|drainage|trench|hardcore|soakaway|screed to ground/],
  ['masonry', /brickwork|blockwork|masonry|\bbrick\b|\bblock\b|cavity wall/],
  ['roofing', /roof|slate|tile battens|fascia|soffit|gutter|flashing/],
  ['plastering', /plaster|skim|render|ceiling|coving|cornice|tape and fill|suspended|suspension|acoustic board/],
  ['flooring', /floor finish|floor tile|screed|carpet|vinyl|laminate floor|wood floor/],
  ['electrical', /electric|socket|lighting|consumer unit|rewir|downlight/],
  ['bathroom', /bathroom|shower|sanitaryware|\bwc\b|basin/],
  ['kitchen', /kitchen|worktop/],
  ['plumbing', /plumb|heating|radiator|boiler|pipework|cylinder|svp/],
  ['mechanical', /mechanical|ventilation|ductwork|hvac|extract fan/],
  ['decorating', /decorat|\bpaint|emulsion|wallpaper/],
  ['carpentry', /carpentry|joinery|joist|rafter|skirting|architrave|door|window|staircase/],
  ['preliminaries', /prelim|scaffold|welfare|site setup|skip hire/],
];

function inferCategory(sectionTitle, description) {
  const hay = (String(sectionTitle || '') + ' ' + String(description || '')).toLowerCase();
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(hay)) return cat;
  }
  return 'general';
}

// Same slug the existing /my-rates import and add routes key on, so candidates
// collide with rates the user already holds rather than duplicating them.
function itemKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 100);
}

// A section title trimmed down to a name a library row can carry: the part
// before the first semicolon (BOQ build-up specs run "PT-01 Non fire rated
// standard apartment partition; 101mm overall; 1 layer...").
function shortSectionTitle(title) {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t.split(';')[0].trim();
  if (t.length > 80) t = t.slice(0, 77).trimEnd() + '…';
  return t;
}

// Line descriptions that only make sense inside their section ("Level 00;
// 2980mm high", "Angle to partition") get the section name prefixed, so the
// library rate still names what it prices once it's out of the BOQ.
function needsSectionContext(description) {
  const d = String(description || '').trim();
  return /^level\b/i.test(d) || d.length < 30;
}

/**
 * Extract deduplicated unit-rate candidates from a parseBOQ() result.
 * Returns [{ display_name, unit, category, item_key, value, occurrences,
 *            qty_total, variant_rates|null }]
 * - value is the unit rate (labour + materials per unit), 2 dp
 * - lines with no positive unit rate (headers, summary echoes) are dropped
 * - identical (category, key, unit) lines merge; when they carry different
 *   rates the highest-quantity rate wins and the rest are reported as
 *   variant_rates so the UI can flag the conflict instead of hiding it
 */
function extractRateCandidates(parsed) {
  const byKey = new Map();

  for (const s of ((parsed && parsed.sections) || [])) {
    const secShort = shortSectionTitle(s.title);
    for (const it of (s.items || [])) {
      const desc = String(it.description || '').replace(/\s+/g, ' ').trim();
      if (!desc) continue;

      const qty = Number(it.qty) || 0;
      let rate = Number(it.rate) || 0;
      if (rate <= 0 && qty > 0) {
        const total = Number(it.total) || ((Number(it.labour) || 0) + (Number(it.materials) || 0));
        if (total > 0) rate = total / qty;
      }
      rate = Math.round(rate * 100) / 100;
      if (rate <= 0) continue;

      const unit = String(it.unit || '').trim() || 'unit';
      const useContext = needsSectionContext(desc) && secShort &&
        secShort.toLowerCase() !== desc.toLowerCase();
      const name = useContext ? secShort + ' — ' + desc : desc;
      const category = inferCategory(s.title, desc);
      const key = category + '|' + itemKey(name) + '|' + unit.toLowerCase();

      const cur = byKey.get(key);
      if (cur) {
        cur.occurrences += 1;
        cur.qty_total += qty;
        const variant = cur._variants.find((v) => Math.abs(v.rate - rate) < 0.005);
        if (variant) variant.qty += qty;
        else cur._variants.push({ rate, qty });
      } else {
        byKey.set(key, {
          display_name: name,
          unit,
          category,
          item_key: itemKey(name),
          occurrences: 1,
          qty_total: qty,
          _variants: [{ rate, qty }],
        });
      }
    }
  }

  const out = [];
  for (const c of byKey.values()) {
    c._variants.sort((a, b) => b.qty - a.qty);
    c.value = c._variants[0].rate;
    c.variant_rates = c._variants.length > 1 ? c._variants.map((v) => v.rate) : null;
    delete c._variants;
    out.push(c);
  }
  return out;
}

module.exports = { extractRateCandidates, inferCategory, itemKey, shortSectionTitle, needsSectionContext };
