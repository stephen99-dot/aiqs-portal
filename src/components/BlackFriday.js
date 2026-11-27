import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  BLACK_FRIDAY_EVENT, openBlackFriday, useBlackFriday, startBlackFridayCheckout,
  useCountdown, countdownText, endsText, jobsLabel,
} from '../utils/blackFriday';
import { gbp, billingNote } from '../utils/planPrice';
import './blackFriday.css';

// ═══ Black Friday 2026 — the scratch card and the sale prices ════════════════
//
//   <BlackFridayPopup />        mounted once in Layout. A gold scratch card:
//                               scratch it (or press Enter, or "just show me")
//                               to reveal "10 jobs for the price of 5", then
//                               the four deals, each straight to Stripe.
//                               Opens by itself once a day on the dashboard,
//                               from ?deals=1 on any page, or openBlackFriday().
//   <BlackFridayBanner />       the dashboard strip that reopens it.
//   <BlackFridayButtons />      sale-priced buy buttons, in place of the
//                               full-price ones while the sale runs.
//   <BlackFridayDealList />     the same as compact rows, for the chat and the
//                               "out of credits" prompts.
//
// What's on sale, the prices and the dates all come from the server
// (server/blackFriday.js); nothing here is shown outside the sale or inside the
// iOS app.

const REVEALED_KEY = 'aiqs_bf2026_revealed';
const AUTO_KEY = 'aiqs_bf2026_auto';
const AUTO_EVERY_MS = 20 * 60 * 60 * 1000; // at most once a day
const OTHER_OVERLAYS = '.ui-modal-overlay, [aria-modal="true"], [data-overlay]';
const HEADLINE = '10 jobs for the price of 5!';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};
const perJob = (n) => '£' + Number(n).toFixed(2);

// One checkout at a time; errors shown where the button is (the popup sits
// above the toasts).
function useDealCheckout() {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const buy = async (key) => {
    if (busy) return;
    setBusy(key);
    setError('');
    try { await startBlackFridayCheckout(key); } catch (e) { setError(e.message || 'Could not open the checkout — please try again.'); } finally { setBusy(''); }
  };
  return { busy, buy, error };
}

// ── The scratch card ─────────────────────────────────────────────────────────
const font = () => getComputedStyleSafe('--font-body') || '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const BRUSH_PX = 34;
const REVEAL_AT = 0.55; // share of the foil scratched off — three or four good swipes

function getComputedStyleSafe(name) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { return ''; }
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintFoil(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  const FONT = font();

  const g = ctx.createLinearGradient(0, 0, w, h);
  [[0, '#9C6B17'], [0.2, '#E6BD55'], [0.4, '#FFF0B5'], [0.58, '#D6A537'], [0.8, '#F3D677'], [1, '#A8771F']].forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#4A3000';
  ctx.font = '700 15px ' + FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let y = 12, row = 0; y < h + 12; y += 24, row += 1) {
    for (let x = (row % 2) * 16; x < w + 16; x += 32) ctx.fillText('£', x, y);
  }
  ctx.restore();

  const pw = Math.min(w - 32, 330);
  const ph = 76;
  const px = (w - pw) / 2;
  const py = (h - ph) / 2;
  ctx.fillStyle = 'rgba(17,17,17,0.9)';
  roundedRect(ctx, px, py, pw, ph, 12);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#F8D45C';
  ctx.font = '800 ' + (w < 380 ? 19 : 22) + 'px ' + FONT;
  ctx.fillText('SCRATCH TO REVEAL', w / 2, py + 29);
  ctx.fillStyle = 'rgba(255,255,255,0.86)';
  ctx.font = '600 13px ' + FONT;
  ctx.fillText('your Black Friday deal', w / 2, py + 53);
}

function ScratchCard({ revealed, onReveal, children }) {
  const canvasRef = useRef(null);
  const st = useRef({ down: false, last: null, strokes: 0 });

  useLayoutEffect(() => {
    if (revealed) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    paintFoil(canvas);
    // Repaint for the real font, and for a new size — until the first scratch.
    const fresh = () => { if (st.current.strokes === 0 && canvasRef.current) paintFoil(canvasRef.current); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fresh).catch(() => {});
    window.addEventListener('resize', fresh);
    return () => window.removeEventListener('resize', fresh);
  }, [revealed]);

  const ctx = () => canvasRef.current && canvasRef.current.getContext('2d', { willReadFrequently: true });

  const point = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const sx = c.width / (r.width || 1);
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sx, s: sx };
  };

  const check = () => {
    const c = canvasRef.current;
    const x = ctx();
    if (!c || !x || !c.width) return;
    let data;
    try { data = x.getImageData(0, 0, c.width, c.height).data; } catch (e) { onReveal(); return; }
    let clear = 0;
    let total = 0;
    for (let i = 3; i < data.length; i += 4 * 23) { total += 1; if (data[i] < 64) clear += 1; }
    if (total && clear / total >= REVEAL_AT) onReveal();
  };

  const scratch = (p) => {
    const x = ctx();
    if (!x) return;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'destination-out';
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.lineWidth = BRUSH_PX * p.s;
    const from = st.current.last || p;
    x.beginPath();
    x.moveTo(from.x, from.y);
    x.lineTo(p.x + 0.01, p.y);
    x.stroke();
    st.current.last = p;
    st.current.strokes += 1;
    if (st.current.strokes % 12 === 0) check();
  };

  const down = (e) => {
    if (revealed) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    st.current.down = true;
    st.current.last = null;
    scratch(point(e));
  };
  const move = (e) => { if (st.current.down && !revealed) scratch(point(e)); };
  const up = () => {
    if (!st.current.down) return;
    st.current.down = false;
    st.current.last = null;
    check();
  };
  const key = (e) => {
    if (revealed) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReveal(); }
  };

  return (
    <div
      className={'bf-ticket' + (revealed ? ' bf-ticket--revealed' : '')}
      tabIndex={revealed ? -1 : 0}
      role={revealed ? undefined : 'button'}
      aria-label={revealed ? undefined : 'Scratch card. Scratch it, or press Enter, to reveal your Black Friday deal.'}
      onKeyDown={key}
    >
      <div className="bf-prize" aria-hidden={!revealed}>{children}</div>
      {!revealed && <div className="bf-shine" aria-hidden="true" />}
      <canvas
        ref={canvasRef}
        className={'bf-foil' + (revealed ? ' bf-foil--gone' : '')}
        aria-hidden="true"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
    </div>
  );
}

const CONFETTI_COLOURS = ['#F8D45C', '#FFFFFF', '#E6BD55', '#4ADE80', '#FFF0B5', '#F59E0B'];
function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 40 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 40 + Math.random() * 0.35;
    const dist = 110 + Math.random() * 170;
    const w = 6 + Math.random() * 6;
    return {
      '--dx': Math.cos(angle) * dist + 'px',
      '--dy': Math.sin(angle) * dist * 0.65 - 20 + 'px',
      '--rot': Math.round(Math.random() * 720 - 360) + 'deg',
      background: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
      animationDelay: Math.round(Math.random() * 90) + 'ms',
      width: w,
      height: Math.max(3, w * 0.45),
    };
  }), []);
  return <div className="bf-confetti" aria-hidden="true">{pieces.map((s, i) => <i key={i} style={s} />)}</div>;
}

// ── The four deals ──────────────────────────────────────────────────────────
function DealGrid({ sale, locked }) {
  const { busy, buy, error } = useDealCheckout();
  return (
    <div className={'bf-deals' + (locked ? ' bf-deals--locked' : '')} aria-hidden={locked || undefined} {...(locked ? { inert: '' } : {})}>
      {error && <div className="bf-error" role="alert">{error}</div>}
      <div className="bf-grid">
        {sale.deals.map((d, i) => (
          <div key={d.key} className={'bf-deal' + (d.featured ? ' bf-deal--featured' : '')} style={{ animationDelay: (locked ? 0 : 80 * i) + 'ms' }}>
            <div className="bf-deal__tag">{d.tag}</div>
            <div className="bf-deal__jobs">{jobsLabel(d.jobs)}</div>
            <div className="bf-deal__was"><s>£{d.was}</s></div>
            <div className="bf-deal__price">{gbp(d.price)}</div>
            <div className="bf-deal__save">Save £{d.save}</div>
            <div className="bf-deal__per">{perJob(d.per_job)} per job</div>
            <button type="button" className="bf-buy" disabled={!!busy || locked} onClick={() => buy(d.key)}>
              {busy === d.key ? 'Opening checkout…' : 'Buy now – £' + d.price}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BlackFridayPopup() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const sale = useBlackFriday(user, { preview: true });
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(() => store.get(REVEALED_KEY) === '1');
  const [burst, setBurst] = useState(false);
  const dialogRef = useRef(null);
  const clock = useCountdown(open && sale ? sale.ends_at : null, 1000);

  // From anywhere: the banner, a buy prompt, the deals page link.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(BLACK_FRIDAY_EVENT, show);
    return () => window.removeEventListener(BLACK_FRIDAY_EVENT, show);
  }, []);

  // ?deals=1 on any page — back from Stripe without paying, a link in an
  // email, or an admin looking at it. Taken off the address once used.
  useEffect(() => {
    if (!sale) return;
    const p = new URLSearchParams(location.search);
    if (p.get('deals') !== '1') return;
    p.delete('deals');
    const qs = p.toString();
    navigate({ pathname: location.pathname, search: qs ? '?' + qs : '' }, { replace: true });
    setOpen(true);
  }, [sale, location.search, location.pathname, navigate]);

  // By itself: on the dashboard, at most once a day, never on top of another
  // popup (it waits for that one to close).
  useEffect(() => {
    if (!sale || !sale.eligible || location.pathname !== '/dashboard') return undefined;
    const last = Number(store.get(AUTO_KEY) || 0);
    if (last && Date.now() - last < AUTO_EVERY_MS) return undefined;
    let tries = 0;
    let t;
    const attempt = () => {
      if (document.querySelector(OTHER_OVERLAYS)) {
        tries += 1;
        if (tries < 15) t = setTimeout(attempt, 4000);
        return;
      }
      store.set(AUTO_KEY, String(Date.now()));
      setOpen(true);
    };
    t = setTimeout(attempt, 1800);
    return () => clearTimeout(t);
  }, [sale, location.pathname]);

  // While open: Escape closes, the page behind stays put.
  useEffect(() => {
    if (!open || !sale) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (dialogRef.current) dialogRef.current.focus({ preventScroll: true });
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, sale]);

  if (!open || !sale) return null;

  const reveal = () => {
    if (revealed) return;
    setRevealed(true);
    store.set(REVEALED_KEY, '1');
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still) { setBurst(true); setTimeout(() => setBurst(false), 1600); }
  };
  const note = billingNote();

  return (
    <div className="bf-overlay" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div ref={dialogRef} tabIndex={-1} className="bf-modal" role="dialog" aria-modal="true" aria-labelledby="bf-title">
        <div className="bf-head">
          <button type="button" className="bf-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          <div className="bf-brand">THE AI QS</div>
          <div className="bf-sale" id="bf-title">BLACK FRIDAY SALE</div>

          <div className="bf-ticket-wrap">
            <ScratchCard revealed={revealed} onReveal={reveal}>
              <div className="bf-prize__big">{HEADLINE}</div>
              <div className="bf-prize__save">Save up to £{sale.max_save}</div>
            </ScratchCard>
            {burst && <Confetti />}
          </div>

          {revealed
            ? <div className="bf-sub">New customers, existing customers and credit top-ups.</div>
            : <button type="button" className="bf-skip" onClick={reveal}>Rather not scratch? Show me the deal</button>}
          <div className="bf-clock" aria-label={'Sale ends ' + endsText(sale.ends_at)}>
            <span className="bf-clock__dot" aria-hidden="true" /> Ends in {countdownText(clock)}
          </div>
        </div>

        {!revealed && <div className="bf-locked-hint">Scratch the gold card to unlock your prices</div>}
        <DealGrid sale={sale} locked={!revealed} />

        <div className="bf-foot">
          One job is one BOQ. Credits never expire and are on your account the moment you pay. Secure checkout by Stripe.
          {' '}Sale ends {endsText(sale.ends_at)}.{note ? ' ' + note : ''}
        </div>
      </div>
    </div>
  );
}

// ── The dashboard strip ─────────────────────────────────────────────────────
export function BlackFridayBanner() {
  const { user } = useAuth();
  const sale = useBlackFriday(user);
  const clock = useCountdown(sale ? sale.ends_at : null, 30000);
  if (!sale) return null;
  return (
    <button type="button" className="bf-banner" onClick={openBlackFriday}>
      <span className="bf-banner__tag">Black Friday</span>
      <span className="bf-banner__text"><strong>10 jobs for the price of 5</strong> <span className="bf-banner__save">· save up to £{sale.max_save}</span></span>
      <span className="bf-banner__clock">Ends in {countdownText(clock, false)}</span>
      <span className="bf-banner__cta">See the deals →</span>
    </button>
  );
}

// ── Sale-priced buy buttons (in place of the full-price ones) ───────────────
export function BlackFridayButtons({ sale }) {
  const { busy, buy, error } = useDealCheckout();
  return (
    <div className="bf-buttons">
      <button type="button" className="bf-buttons__tag" onClick={openBlackFriday}>Black Friday</button>
      {sale.deals.map((d) => (
        <button key={d.key} type="button" className={'bf-mini' + (d.featured ? ' bf-mini--featured' : '')} disabled={!!busy} onClick={() => buy(d.key)}>
          {busy === d.key ? 'Opening…' : <>{jobsLabel(d.jobs)} <s>£{d.was}</s> <strong>£{d.price}</strong></>}
        </button>
      ))}
      {error && <span className="bf-error bf-error--inline" role="alert">{error}</span>}
    </div>
  );
}

// ── Compact rows, for the chat and the "out of credits" prompts ─────────────
export function BlackFridayDealList({ sale }) {
  const { busy, buy, error } = useDealCheckout();
  const clock = useCountdown(sale.ends_at, 30000);
  return (
    <div className="bf-list">
      <div className="bf-list__head">
        <span className="bf-list__sale">Black Friday</span>
        <span className="bf-list__title">{HEADLINE}</span>
        <span className="bf-list__clock">Ends in {countdownText(clock, false)}</span>
      </div>
      {sale.deals.map((d) => (
        <div key={d.key} className={'bf-row' + (d.featured ? ' bf-row--featured' : '')}>
          <div className="bf-row__what">
            <div><strong>{jobsLabel(d.jobs)}</strong> <span className="bf-row__tag">{d.tag}</span></div>
            <div className="bf-row__per">{perJob(d.per_job)} per job · save £{d.save}</div>
          </div>
          <div className="bf-row__price"><s>£{d.was}</s> <strong>£{d.price}</strong></div>
          <button type="button" className="bf-row__buy" disabled={!!busy} onClick={() => buy(d.key)}>
            {busy === d.key ? 'Opening…' : 'Buy'}
          </button>
        </div>
      ))}
      {error && <div className="bf-error" role="alert">{error}</div>}
    </div>
  );
}
