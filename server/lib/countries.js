// ═══════════════════════════════════════════════════════════════════════════
// countries.js — one place that says what "the UK way" is and what changes in
// every other country we price for. Currency, VAT, measurement standard,
// building regulations, regions and which rate library the pricer uses.
//
// A user's country is set once (signup, or the prompt shown to existing users)
// and stored on users.country / users.region. Everything that used to assume
// £ and 20% VAT should ask this module instead.
//
// Pure data + helpers, no DB access — safe to require from the pricer.
// ═══════════════════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');

// ── South Africa rate library (generated from the SA-RL workbook by
//    scripts/import-sa-rates.js). Loaded lazily and cached.
let _za = null;
function zaLibrary() {
  if (_za) return _za;
  const file = path.join(__dirname, '..', 'rate-libraries', 'za.json');
  const lib = JSON.parse(fs.readFileSync(file, 'utf8'));
  lib.byCode = Object.fromEntries(lib.rates.map((r) => [r.code, r]));
  let map = {};
  try {
    map = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rate-libraries', 'za-map.json'), 'utf8')).map || {};
  } catch (e) { /* no map yet: every key uses the parity conversion */ }
  lib.ukKeyMap = map;
  _za = lib;
  return lib;
}

const COUNTRIES = {
  GB: {
    code: 'GB',
    name: 'United Kingdom',
    flag: '🇬🇧',
    currency: 'GBP',
    symbol: '£',
    locale: 'en-GB',
    vatRate: 20,
    vatName: 'VAT',
    measurement: 'NRM2 (RICS New Rules of Measurement)',
    regulations: 'Building Regulations (England & Wales), Scottish Building Standards, NI Building Regulations',
    rateLibrary: 'UK',
    constructionTax: 'CIS',
    regions: [],
    supported: true,
  },
  IE: {
    code: 'IE',
    name: 'Ireland',
    flag: '🇮🇪',
    currency: 'EUR',
    symbol: '€',
    locale: 'en-IE',
    vatRate: 13.5,
    vatName: 'VAT',
    measurement: 'ARM4 / NRM2',
    regulations: 'Irish Building Regulations (Technical Guidance Documents A–M)',
    rateLibrary: 'UK',
    constructionTax: 'RCT',
    regions: [],
    supported: true,
  },
  ZA: {
    code: 'ZA',
    name: 'South Africa',
    flag: '🇿🇦',
    currency: 'ZAR',
    symbol: 'R',
    locale: 'en-ZA',
    vatRate: 15,
    vatName: 'VAT',
    measurement: 'ASAQS Standard System of Measuring Building Work',
    regulations: 'SANS 10400 National Building Regulations, SANS 10142-1 (electrical), NHBRC',
    rateLibrary: 'ZA',
    constructionTax: null,
    get regions() { return zaLibrary().regions.map((r) => r.name); },
    supported: true,
  },
};

// Countries with no local library yet. The user's country is still recorded
// and shown to the assistant, but prices stay UK benchmarks in GBP and the
// assistant says so rather than passing them off as local rates.
const OTHER = {
  code: 'OTHER',
  name: 'Other country',
  flag: '🌍',
  currency: 'GBP',
  symbol: '£',
  locale: 'en-GB',
  vatRate: 20,
  vatName: 'VAT / sales tax',
  measurement: 'NRM2',
  regulations: 'local building regulations',
  rateLibrary: 'UK',
  constructionTax: null,
  regions: [],
  supported: false,
};

const SYMBOLS = { GBP: '£', EUR: '€', ZAR: 'R', USD: '$', AUD: 'A$', NZD: 'NZ$', CAD: 'C$', AED: 'AED ' };

function currencySymbol(code) {
  if (!code) return '£';
  const c = String(code).toUpperCase();
  if (SYMBOLS[c]) return SYMBOLS[c];
  // Callers sometimes pass the symbol itself.
  if (Object.values(SYMBOLS).includes(String(code))) return String(code);
  return c + ' ';
}

// Symbol → ISO code, for the export paths that were handed a symbol.
function currencyCode(symbolOrCode) {
  const s = String(symbolOrCode || '').trim();
  if (!s) return 'GBP';
  if (/^[A-Z]{3}$/.test(s)) return s;
  for (const [code, sym] of Object.entries(SYMBOLS)) if (sym.trim() === s) return code;
  return 'GBP';
}

// "R 12,345.00" style. Grouping is always comma/point so the figures read the
// same in the portal, the PDF and the spreadsheet (en-ZA would print spaces
// and a decimal comma, which Excel exports then mis-read).
function formatMoney(amount, currency, opts = {}) {
  const n = Number(amount) || 0;
  const dp = opts.decimals != null ? opts.decimals : 2;
  const s = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return (n < 0 ? '-' : '') + currencySymbol(currency) + s;
}

function getCountry(code) {
  const c = String(code || '').toUpperCase();
  return COUNTRIES[c] || (c === 'OTHER' ? OTHER : COUNTRIES.GB);
}

// The profile for a user row ({country, region, country_name}). A user who has
// never been asked (country NULL) is treated as UK, which is what every
// account was before this existed.
function countryForUser(user) {
  const base = getCountry(user && user.country);
  const out = Object.assign({}, base, { regions: base.regions });
  out.region = (user && user.region) || null;
  if (base.code === 'OTHER') out.name = (user && user.country_name) || base.name;
  return out;
}

// What the frontend needs: the picker list + regions.
function publicCountryList() {
  return [COUNTRIES.GB, COUNTRIES.IE, COUNTRIES.ZA, OTHER].map((c) => ({
    code: c.code, name: c.name, flag: c.flag, currency: c.currency, symbol: c.symbol,
    vatRate: c.vatRate, regions: c.regions, supported: c.supported,
  }));
}

// The camelCase block every user payload (/auth/me, login, register) carries.
function userCountryFields(user) {
  const c = countryForUser(user);
  return {
    country: (user && user.country) || null,
    countryName: c.name,
    region: c.region,
    currency: c.currency,
    currencySymbol: c.symbol,
    vatRate: c.vatRate,
  };
}

function validateCountryInput({ country, region, countryName }) {
  const code = String(country || '').toUpperCase();
  if (!COUNTRIES[code] && code !== 'OTHER') return { error: 'Please choose a country' };
  const profile = getCountry(code);
  let reg = region ? String(region).trim().slice(0, 120) : null;
  if (reg && profile.regions.length && !profile.regions.includes(reg)) return { error: 'Unknown region for ' + profile.name };
  if (!profile.regions.length) reg = null;
  const name = code === 'OTHER' ? String(countryName || '').trim().slice(0, 80) : null;
  if (code === 'OTHER' && !name) return { error: 'Please tell us which country you are in' };
  return { country: code, region: reg, countryName: name };
}

// ── Location text → country. Only decisive signals; ambiguous text returns null
//    so the user's own country decides.
const ZA_PATTERN = /\b(south\s+africa|rsa|gauteng|johannesburg|joburg|jozi|pretoria|tshwane|midrand|sandton|centurion|randburg|roodepoort|soweto|benoni|boksburg|germiston|krugersdorp|vereeniging|cape\s+town|western\s+cape|stellenbosch|paarl|franschhoek|somerset\s+west|durbanville|bellville|constantia|hermanus|knysna|plettenberg|mossel\s+bay|kwazulu|kzn|durban|umhlanga|ballito|pietermaritzburg|richards\s+bay|eastern\s+cape|gqeberha|port\s+elizabeth|mthatha|free\s+state|bloemfontein|mpumalanga|mbombela|nelspruit|emalahleni|witbank|limpopo|polokwane|north\s+west\s+province|rustenburg|mahikeng|potchefstroom|northern\s+cape|upington|springbok)\b/i;

function detectCountryFromLocation(location) {
  if (!location) return null;
  if (ZA_PATTERN.test(String(location))) return 'ZA';
  return null;
}

// Region names in the ZA library → the place names that select them.
const ZA_REGION_PATTERNS = [
  [/cape\s+town|winelands|stellenbosch|paarl|franschhoek|somerset\s+west|durbanville|bellville|constantia|hermanus/i, 'Western Cape - Cape Town'],
  [/garden\s+route|george|knysna|plettenberg|mossel\s+bay|western\s+cape/i, 'Western Cape - Garden Route'],
  [/durban|umhlanga|ballito/i, 'KwaZulu-Natal - Durban'],
  [/kwazulu|kzn|pietermaritzburg|richards\s+bay/i, 'KwaZulu-Natal - inland'],
  [/gqeberha|port\s+elizabeth|east\s+london/i, 'Eastern Cape - Gqeberha'],
  [/eastern\s+cape|mthatha|transkei|karoo/i, 'Eastern Cape - rural'],
  [/bloemfontein/i, 'Free State - Bloemfontein'],
  [/free\s+state/i, 'Free State - rural'],
  [/mpumalanga|mbombela|nelspruit|emalahleni|witbank/i, 'Mpumalanga'],
  [/polokwane/i, 'Limpopo - Polokwane'],
  [/limpopo/i, 'Limpopo - rural'],
  [/rustenburg|mahikeng|potchefstroom|north\s+west/i, 'North West'],
  [/upington|springbok/i, 'Northern Cape - remote'],
  [/kimberley|northern\s+cape/i, 'Northern Cape - Kimberley'],
  [/gauteng|johannesburg|joburg|pretoria|tshwane|midrand|sandton|centurion|randburg|soweto|benoni|boksburg|germiston|kempton|krugersdorp|vereeniging/i, 'Gauteng'],
];

// The ZA region + factor for a job. The job's address wins over the account's
// default region, because a Gauteng builder can price a Cape Town job.
function zaRegion(location, userRegion) {
  const lib = zaLibrary();
  const byPrefix = (prefix) => lib.regions.find((r) => r.name.toLowerCase().startsWith(prefix.toLowerCase()));
  if (location) {
    for (const [re, prefix] of ZA_REGION_PATTERNS) {
      if (re.test(location)) { const r = byPrefix(prefix); if (r) return r; }
    }
  }
  if (userRegion) {
    const r = lib.regions.find((x) => x.name === userRegion);
    if (r) return r;
  }
  return lib.regions.find((r) => r.isBase) || lib.regions[0];
}

// GBP-denominated library rate → ZAR, for the UK keys the SA library has no
// equivalent for. This is a construction cost-parity factor, NOT the FX rate:
// SA labour is far cheaper than UK labour, so converting at FX (~R23/£) would
// overstate SA prices badly. It is calibrated as the median ratio of SA sell
// rate to UK rate across the 109 mapped item pairs in za-map.json (median 6.57,
// interquartile range 5.2-9.3 against SA-RL-2609-01), and countries.test.js
// fails if a library update moves the median away from it.
const ZA_GBP_PARITY = 6.6;

// SA rate for a UK library key, in ZAR at the BASE region (Gauteng), or null
// when the SA library has no equivalent. Map entries are either
// { code, factor? } or { codes: [{code, factor}] } for composite lines.
function zaRateForUkKey(key) {
  const lib = zaLibrary();
  const m = lib.ukKeyMap[key];
  if (!m) return null;
  const parts = m.codes || [{ code: m.code, factor: m.factor }];
  let rate = 0, labour = 0;
  for (const p of parts) {
    const r = lib.byCode[p.code];
    if (!r) return null;
    const f = p.factor != null ? Number(p.factor) : 1;
    rate += r.sell * f;
    labour += r.sell * f * r.labour;
  }
  if (!(rate > 0)) return null;
  return { rate, labourShare: labour / rate, codes: parts.map((p) => p.code) };
}

// Everything the pricer needs to price a job in a country.
//   locFactor   — multiplier from a UK GBP base rate to the local currency/region
//   capScale    — multiplier for the GBP-denominated sanity caps and ceilings
//   localRate   — (key) => local rate for that key, or null to use BASE × locFactor
function pricingProfile(countryCode, location, userRegion) {
  const c = getCountry(countryCode);
  if (c.code === 'ZA') {
    const region = zaRegion(location, userRegion);
    return {
      country: 'ZA',
      currency: 'ZAR',
      symbol: 'R',
      vatRate: c.vatRate,
      region,
      label: 'South Africa — ' + region.name + (region.factor !== 1 ? ` (x${region.factor.toFixed(2)})` : ''),
      locFactor: ZA_GBP_PARITY * region.factor,
      capScale: ZA_GBP_PARITY * region.factor,
      localRate(key) {
        const hit = zaRateForUkKey(key);
        return hit ? { rate: hit.rate * region.factor, labourShare: hit.labourShare, codes: hit.codes } : null;
      },
      libraryRef: zaLibrary().ref,
    };
  }
  return null; // UK / Ireland / other: the pricer's own UK/Ireland logic applies
}

// The pricer options for a job: pass the result straight into
// priceLockedQuantities' options. The job's address wins (a Cape Town address
// prices in Rand for any account); otherwise the account's country applies.
// Empty for UK / Ireland / other accounts, so their pricing is untouched.
function pricingOptions(user, location) {
  const byAddress = detectCountryFromLocation(location) === 'ZA';
  const code = byAddress ? 'ZA' : (user && user.country);
  if (String(code || '').toUpperCase() !== 'ZA') return {};
  const profile = pricingProfile('ZA', location, user && user.region);
  profile.byAddress = byAddress;
  return { countryPricing: profile };
}

// Prompt block telling the assistant where the client is. Empty for the UK so
// the existing (UK) prompts are unchanged for UK users.
function promptBlock(user) {
  const c = countryForUser(user);
  if (!user || !user.country || c.code === 'GB') return '';
  if (c.code === 'ZA') {
    const lib = zaLibrary();
    return [
      '═══ CLIENT COUNTRY: SOUTH AFRICA — THIS OVERRIDES ANY UK ASSUMPTION BELOW ═══',
      `This client works in South Africa${c.region ? ' (' + c.region + ')' : ''}. For everything you price, write or advise:`,
      '- Currency is South African Rand. Write amounts as R12,500.00 — never £ or €.',
      `- VAT is ${c.vatRate}%, added once at the foot of the BOQ. Rates are ex VAT. No CIS, no UK reverse charge.`,
      `- Measure to the ${c.measurement} and use SA trade terms (IBR sheeting, face brick, NHBRC, SANS 10400, SANS 10142-1 COC for electrical, PIRB plumbing).`,
      `- Rates come from the AI QS South Africa Rates Library ${lib.ref} (base ${lib.baseRegion}, ${lib.baseDate}), which already includes the ${lib.marginPct}% contractor margin. Regional factors: ${lib.regions.map((r) => r.name + ' ' + r.factor.toFixed(2)).join('; ')}.`,
      '- Use SA spelling of place names and SA suppliers (e.g. Builders Warehouse, Cashbuild, BUCO, Build It) when naming products.',
      '═══════════════════════════════════════════════════════════════════════════',
    ].join('\n');
  }
  if (c.code === 'IE') {
    return [
      '═══ CLIENT COUNTRY: IRELAND ═══',
      'This client works in Ireland: price in euro (€), VAT 13.5% on construction services, Irish Building Regulations (TGDs), RCT not CIS.',
    ].join('\n');
  }
  return [
    `═══ CLIENT COUNTRY: ${c.name.toUpperCase()} ═══`,
    `This client works in ${c.name}. We do not yet hold a local rates library for ${c.name}: figures from the rate library are UK benchmarks in GBP.`,
    'Say so plainly whenever you give prices, flag local VAT/sales tax and building regulations as items for the client to confirm, and never present a UK rate as a local one.',
  ].join('\n');
}

// Compact SA library listing for the chat prompt. Sorted by code, no
// timestamps, so it is byte-stable and safe to sit in a cached prompt prefix.
function renderZaLibraryCribSheet(regionFactor = 1) {
  const lib = zaLibrary();
  const lines = [];
  let section = null;
  for (const r of lib.rates) {
    if (r.section !== section) { section = r.section; lines.push(`# ${section}`); }
    lines.push(`${r.code} ${r.description} — R${(Math.round(r.sell * regionFactor * 100) / 100).toFixed(2)}/${r.unit}`);
  }
  return lines.join('\n');
}

module.exports = {
  COUNTRIES, OTHER, ZA_GBP_PARITY,
  getCountry, countryForUser, publicCountryList, userCountryFields, validateCountryInput,
  currencySymbol, currencyCode, formatMoney,
  detectCountryFromLocation, zaRegion, zaLibrary, zaRateForUkKey, pricingProfile, pricingOptions,
  promptBlock, renderZaLibraryCribSheet,
};
