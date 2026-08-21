// Trade day rates — server/tradeRates.js
//
// Onboarding asks one pricing question that actually matters to a builder:
// "what does each trade cost per day round your way?". The answers land in
// client_rate_library (category 'labour', unit £/day) — the same table the
// My Rates page, the chat prompt and the pricer already read — so a rate
// entered at onboarding behaves exactly like one added on the My Rates page.

const { v4: uuidv4 } = require('uuid');

// Typical UK figures, shown prefilled and fully editable on the onboarding
// screen. Keep in step with DEFAULT_TRADE_DAY_RATES in OnboardingPage.js.
const DEFAULT_TRADE_DAY_RATES = {
  'Labourer': 160,
  'General builder': 280,
  'Bricklayer': 300,
  'Carpenter / joiner': 280,
  'Electrician': 360,
  'Plumber / heating': 340,
  'Plasterer': 280,
  'Roofer': 300,
};

const CATEGORY = 'labour';
const MAX_TRADES = 40;
const MAX_NAME_LEN = 60;

// Same slug rule as the My Rates manual-add and Excel import paths, so
// "Carpenter / joiner" from onboarding and from an import collapse to one row.
function slugKey(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Upsert a {tradeName: £/day} map into the user's rate library.
// Returns { saved } — the number of rows inserted or updated.
function saveTradeRates(db, { userId, rates }) {
  if (!userId || !rates || typeof rates !== 'object' || Array.isArray(rates)) return { saved: 0 };

  const sel = db.prepare(
    'SELECT id FROM client_rate_library WHERE user_id = ? AND category = ? AND item_key = ? AND is_active = 1'
  );
  const upd = db.prepare(
    'UPDATE client_rate_library SET value = ?, display_name = ?, unit = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  );
  const ins = db.prepare(
    'INSERT INTO client_rate_library (id, user_id, category, item_key, display_name, value, unit, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, 0.9)'
  );

  let saved = 0;
  for (const [rawName, rawValue] of Object.entries(rates).slice(0, MAX_TRADES)) {
    const name = String(rawName).trim().slice(0, MAX_NAME_LEN);
    const value = parseFloat(rawValue);
    if (!name || !Number.isFinite(value) || value <= 0 || value >= 10000) continue;
    const itemKey = slugKey(name) + '_day';
    if (itemKey === '_day') continue;

    const displayName = name + ' (Day Rate)';
    const existing = sel.get(userId, CATEGORY, itemKey);
    if (existing) {
      upd.run(value, displayName, '£/day', existing.id);
    } else {
      ins.run('rl_' + uuidv4().slice(0, 8), userId, CATEGORY, itemKey, displayName, value, '£/day');
    }
    saved++;
  }
  return { saved };
}

module.exports = { DEFAULT_TRADE_DAY_RATES, saveTradeRates, slugKey, CATEGORY };
