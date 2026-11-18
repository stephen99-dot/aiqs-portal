// ═══ Opening MAX from anywhere ═══════════════════════════════════════════════
// Any page can hand MAX a prompt without knowing where the panel lives:
//
//   openMax({ prompt: 'Price a 20 m² patio', send: true })   // sends it
//   openMax({ prompt: 'Price a …' })                           // puts it in the box
//   openMax({ voice: true })                                   // opens listening
//
// The panel (components/max/MaxPanel.js) listens for this event.

export const MAX_OPEN_EVENT = 'aiqs:max';

export function openMax(detail) {
  try { window.dispatchEvent(new CustomEvent(MAX_OPEN_EVENT, { detail: detail || { open: true } })); } catch (e) { /* no window */ }
}

export function closeMax() {
  openMax({ open: false });
}

// £ to the penny, the way every MAX surface shows money.
export function fmtMoney2(n, currency) {
  const v = Number(n);
  const sym = currency === 'EUR' ? '€' : currency === 'ZAR' ? 'R' : '£';
  return Number.isFinite(v) ? sym + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}
export function fmtMoney0(n, currency) {
  const v = Number(n);
  const sym = currency === 'EUR' ? '€' : currency === 'ZAR' ? 'R' : '£';
  return Number.isFinite(v) ? sym + Math.round(v).toLocaleString('en-GB') : '—';
}
