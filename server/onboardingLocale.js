// onboardingLocale.js — the onboarding questions and rate sheet in the
// user's country. The catalogue in tradeCatalog.js is written for the UK (£
// day rates and job-value bands, NICEIC / Gas Safe / FENSA certifications);
// a South African builder is asked the same things in Rand with SA schemes.
// UK / Ireland / other accounts get the catalogue unchanged.

const countries = require('./lib/countries');

// Which SA labour grade (SA rates library, Labour sheet) a trade's day rate
// is prefilled from. Anything unlisted is a Class 2 tradesman.
const ZA_TRADE_GRADE = [
  [/labour/i, 'L01'],
  [/electric|solar|ev charger|air con/i, 'L09'],
  [/plumb|heating|drainage|bathroom/i, 'L10'],
  [/carpent|joiner|kitchen|steel/i, 'L06'],
  [/paint|decorat|pav|driveway|damp|waterproof/i, 'L04'],
];

const ZA_COMMON_CERTS = ['NHBRC registered', 'CIDB grading', 'Master Builders Association member', 'COIDA letter of good standing', 'Public liability insurance', 'VAT registered', 'B-BBEE certificate'];
const ZA_TRADE_CERTS = [
  [/electric|solar|ev charger/i, ['Registered electrical contractor (DoEL)', "Wireman's licence", 'ECA(SA) member', 'PV GreenCard']],
  [/plumb|heating|bathroom|drainage/i, ['PIRB registered', 'IOPSA member', 'SAQCC Gas registered']],
  [/roof/i, ['SAIA / ITC member', 'Roofing warranty (SANS 10400-L)']],
  [/window|door|glaz/i, ['AAAMSA member', 'SAGGA member']],
  [/air con/i, ['SAQCC Refrigeration (F-gas)']],
  [/scaffold/i, ['SAFSA member']],
];

function zaDayRate(tradeName) {
  const lib = countries.zaLibrary();
  const grade = (ZA_TRADE_GRADE.find(([re]) => re.test(tradeName || '')) || [null, 'L05'])[1];
  const row = lib.labour.find((l) => l.code === grade);
  if (!row) return null;
  // All-in employer cost per day plus the library's contractor margin: what a
  // day of that labour costs the customer. Rounded to R10.
  return Math.round(row.allInDay * (1 + lib.marginPct / 100) / 10) * 10;
}

// Two significant figures, so R/m² prefills read like figures a builder would
// quote (R460, not R462.37).
function roundish(n) {
  if (!(n > 0)) return n;
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 1));
  return Math.round(n / p) * p;
}

function localiseQuestions(questions, tradeName, user) {
  const c = countries.countryForUser(user);
  if (c.code !== 'ZA') return questions;
  const dayRate = zaDayRate(tradeName);
  return questions.map((q) => {
    switch (q.id) {
      case 'regions':
        return { ...q, placeholder: 'e.g. Johannesburg and the East Rand' };
      case 'typical_job_value':
        return { ...q, options: ['Under R100k', 'R100k – R500k', 'R500k – R2m', 'R2m – R10m', 'R10m+'] };
      case 'travel_radius':
        return { ...q, options: ['Up to 20 km', '20–50 km', '50–100 km', 'Anywhere in the country'] };
      case 'day_rate':
        return { ...q, unit: 'R/day', default: dayRate || q.default, desc: 'What a day of your labour costs a customer, ex VAT. Prefilled from the AI QS South Africa rates library — change it to your own figure.' };
      case 'certifications': {
        const trade = (ZA_TRADE_CERTS.find(([re]) => re.test(tradeName || '')) || [null, []])[1];
        return { ...q, options: [...trade, ...ZA_COMMON_CERTS] };
      }
      default:
        return q;
    }
  });
}

// Rate-sheet rows in the account's currency. Only a £ figure is converted:
// a percentage (a QS fee) is the same everywhere, and a row the catalogue
// flags `scale: false` was already derived from the localised day rate (see
// localiseRateSheet) so converting it again would double it.
function localiseRateItems(items, user) {
  const c = countries.countryForUser(user);
  if (c.code !== 'ZA') return items;
  return items.map((it) => {
    const sterling = /£/.test(String(it.unit || ''));
    return {
      ...it,
      unit: String(it.unit || '').replace(/£/g, 'R'),
      typical: sterling && it.scale !== false ? roundish(it.typical * countries.ZA_GBP_PARITY) : it.typical,
    };
  });
}

// The grouped sheet for a trade in the account's currency. The Labour group's
// typicals derive from the day rate, so for a Rand account the sheet is built
// from the Rand day rate (the same figure the day-rate question prefills) and
// then localised row by row.
function localiseRateSheet(tradeName, user) {
  const { getRateSheetForTrade } = require('./tradeCatalog');
  const c = countries.countryForUser(user);
  const dayRate = c.code === 'ZA' ? zaDayRate(tradeName) : null;
  return getRateSheetForTrade(tradeName, { dayRate }).map((g) => ({ ...g, items: localiseRateItems(g.items, user) }));
}

module.exports = { localiseQuestions, localiseRateItems, localiseRateSheet, zaDayRate };
