// Currency helpers for the portal. Mirrors server/lib/countries.js: the
// currency a figure was priced in decides its symbol, and grouping is always
// 1,234.56 so the portal, PDFs and spreadsheets read the same.
const SYMBOLS = { GBP: '£', EUR: '€', ZAR: 'R', USD: '$', AUD: 'A$', NZD: 'NZ$', CAD: 'C$' };

export function currencySymbol(code) {
  if (!code) return '£';
  const c = String(code).toUpperCase();
  if (SYMBOLS[c]) return SYMBOLS[c];
  if (Object.values(SYMBOLS).includes(String(code))) return String(code);
  return c + ' ';
}

export function formatMoney(amount, currency, decimals = 2) {
  const n = Number(amount) || 0;
  const s = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (n < 0 ? '-' : '') + currencySymbol(currency) + s;
}

// The signed-in user's currency (from /auth/me), defaulting to GBP.
export function userCurrency(user) {
  return (user && user.currency) || 'GBP';
}
