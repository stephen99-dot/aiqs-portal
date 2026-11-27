// ═══ Black Friday 2026 — the sale, from anywhere ═════════════════════════════
// The server (server/blackFriday.js) owns the deals and the dates; this asks
// it once per signed-in account and shares the answer with every surface:
// the scratch-card popup, the dashboard banner, and the buy buttons that swap
// to sale prices while it runs.
//
//   const sale = useBlackFriday(user);   // null unless it's on and for them
//   openBlackFriday();                   // shows the popup from any page
//
// Inside the iOS app nothing is for sale (App Store rule 3.1.1), so the hook
// always answers null there.
import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { canShowPurchases } from './purchases';

export const BLACK_FRIDAY_EVENT = 'aiqs:black-friday';

export function openBlackFriday() {
  try { window.dispatchEvent(new CustomEvent(BLACK_FRIDAY_EVENT)); } catch (e) { /* no window */ }
}

const cache = new Map(); // account id → Promise<sale | null>
function load(userId) {
  if (!cache.has(userId)) {
    cache.set(userId, apiFetch('/black-friday').catch(() => { cache.delete(userId); return null; }));
  }
  return cache.get(userId);
}

const live = (sale) => !!(sale && sale.active && Date.parse(sale.ends_at) > Date.now());

// The sale while it's on. `preview` also answers for accounts it isn't offered
// to (admins, Unlimited) — the popup uses it for ?deals=1.
export function useBlackFriday(user, { preview = false } = {}) {
  const id = user && user.id;
  const [sale, setSale] = useState(null);
  const [, expire] = useState(0);

  useEffect(() => {
    if (!id || !canShowPurchases()) { setSale(null); return undefined; }
    let on = true;
    load(id).then((s) => { if (on) setSale(s); });
    return () => { on = false; };
  }, [id]);

  // Take the sale down in place the moment it ends.
  useEffect(() => {
    if (!live(sale)) return undefined;
    const ms = Date.parse(sale.ends_at) - Date.now() + 500;
    if (ms > 2147483647) return undefined;
    const t = setTimeout(() => expire((n) => n + 1), ms);
    return () => clearTimeout(t);
  }, [sale]);

  if (!live(sale)) return null;
  if (!sale.eligible && !preview) return null;
  return sale;
}

// Opens Stripe Checkout for one deal. The server stamps the session with the
// account and the number of jobs, so the webhook lands exactly those credits.
export async function startBlackFridayCheckout(dealKey) {
  const r = await apiFetch('/black-friday/checkout', { method: 'POST', body: JSON.stringify({ deal: dealKey }) });
  if (!r || !r.url) throw new Error('Could not open the checkout.');
  window.location.assign(r.url);
  // Stay busy while the browser leaves for Stripe.
  await new Promise((resolve) => setTimeout(resolve, 8000));
}

// Ticks every `stepMs` and returns what's left until `endsAt`.
export function useCountdown(endsAt, stepMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [endsAt, stepMs]);
  const left = Math.max(0, Date.parse(endsAt || '') - now) || 0;
  const s = Math.floor(left / 1000);
  return { left, d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

const pad = (n) => String(n).padStart(2, '0');
// "2d 04h 12m 09s" — or without seconds, "2d 04h 12m".
export function countdownText({ d, h, m, s }, seconds = true) {
  const parts = [];
  if (d) parts.push(d + 'd');
  parts.push(pad(h) + 'h', pad(m) + 'm');
  if (seconds) parts.push(pad(s) + 's');
  return parts.join(' ');
}

// "midnight on Monday 30 November" — a UK-time end, said the way people say it.
export function endsText(endsAt) {
  const end = new Date(endsAt);
  if (isNaN(end)) return '';
  const tz = 'Europe/London';
  const time = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const atMidnight = time === '00:00';
  const day = new Date(end.getTime() - (atMidnight ? 1 : 0)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
  return atMidnight ? 'midnight on ' + day : time + ' on ' + day;
}

export const jobsLabel = (n) => (n === 1 ? '1 job' : n + ' jobs');
