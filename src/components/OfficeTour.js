import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowRightIcon, ArrowLeftIcon, XIcon, ZapIcon, HelpCircleIcon } from './Icons';

// A live, guided walkthrough of Office in a Box — built for a tradesperson who
// has never used software like this. It physically drives the app: navigating
// between pages, spotlighting the real controls and narrating each one, then
// walking a complete example job (quote → accepted → invoiced → paid → change
// → retention) through the read-only /office-demo sandbox so nothing is saved.
//
// It auto-runs once on first visit, and is ALWAYS available afterwards via the
// floating "Show me around" button (and the matching button on the Today
// header), so a stuck builder can replay it any time.

// Bump when the steps change so returning users see the refreshed walkthrough.
export const OFFICE_TOUR_VERSION = 1;

const AMBER = '#F59E0B';
const AMBER_DIM = '#D97706';

const key = (userId) => `aiqs_office_tour_complete_${userId || 'default'}`;

// Routes that count as "inside" Office in a Box — the launcher shows on these.
const OFFICE_PREFIXES = [
  '/office', '/jobs', '/clients', '/money', '/tools', '/estimator',
  '/invoices', '/finance', '/change-orders', '/documents', '/calculators', '/materials',
];
const isOfficeRoute = (path) =>
  OFFICE_PREFIXES.some(p => path === p || path.startsWith(p + '/'));

// The walkthrough. Each step optionally navigates to `route`, then spotlights
// the element matching `target` (a [data-tour] selector). A null target shows a
// centred card. `placement` positions the tooltip around the spotlight.
const STEPS = [
  // ── Welcome ──────────────────────────────────────────────────────────────
  {
    chapter: 'Welcome', route: '/office', target: null, placement: 'center',
    title: 'Welcome to Office in a Box',
    body: "I'll walk you through the whole thing — getting set up, then a complete example job from quote right through to getting paid. It takes about two minutes, and you can stop any time. This tour always lives on your Today screen, so you can run it again whenever you get stuck.",
  },

  // ── Get set up ─────────────────────────────────────────────────────────────
  {
    chapter: 'Get set up', route: '/office', target: '[data-tour="oiab-setup"]', placement: 'bottom',
    title: 'Start here — two minutes of set-up',
    body: "Tap this to add your business name, logo and colour, and answer two quick tax questions. Do it once and every quote, invoice and letter you send goes out looking like yours — with the VAT and CIS worked out right first time.",
  },

  // ── The Today screen ────────────────────────────────────────────────────────
  {
    chapter: 'Your Today screen', route: '/office', target: '[data-tour="oiab-money"]', placement: 'bottom',
    title: 'Your money, at a glance',
    body: "The first thing you see every morning: what you're owed, what's overdue, and what you've quoted but not heard back on. It refreshes itself every time you open it — you never need to hit reload.",
  },
  {
    chapter: 'Your Today screen', route: '/office', target: '[data-tour="oiab-ask"]', placement: 'bottom',
    title: 'Ask about your jobs',
    body: "Type a plain question — \"Who owes me the most?\" — and you get a straight answer pulled from your own quotes, jobs and invoices. It never makes anything up.",
  },
  {
    chapter: 'Your Today screen', route: '/office', target: '[data-tour="oiab-attention"]', placement: 'top',
    title: 'Things that need chasing',
    body: "Anything that needs you — an overdue invoice, a quote going cold — turns up here, each with one button that does the obvious thing. Clear this list and you know you're on top of the job.",
  },
  {
    chapter: 'Your Today screen', route: '/office', target: '[data-tour="oiab-quick"]', placement: 'top',
    title: 'Where a real job begins',
    body: "When you're ready for the real thing, \"New quote\" is the start — describe a job in plain English and a priced, branded quote comes back. For now, let's follow a finished example so you can see the whole journey.",
  },

  // ── A worked example (read-only demo) ───────────────────────────────────────
  {
    chapter: 'A worked example', route: '/office-demo', target: null, placement: 'center',
    title: "Here's a job, start to finish",
    body: "This is one real-looking job — a rear extension for Dave Patel. Every figure is an example and nothing here is saved. Let's follow it from quote to final payment.",
  },
  {
    chapter: 'A worked example', route: '/office-demo', target: '[data-tour="demo-money"]', placement: 'bottom',
    title: '1. The numbers for this job',
    body: "The same three numbers as your Today screen, but just for this one job: what's owed on it, what's overdue, and what was quoted.",
  },
  {
    chapter: 'A worked example', route: '/office-demo', target: '[data-tour="demo-quote"]', placement: 'top',
    title: '2. The quote — accepted on the phone',
    body: "You sent Dave the quote by WhatsApp. He tapped to accept and signed it on his phone — no printing, no posting. That's what the green tick means.",
  },
  {
    chapter: 'A worked example', route: '/office-demo', target: '[data-tour="demo-invoice"]', placement: 'top',
    title: '3. Invoicing as you go',
    body: "The deposit's already paid. The next invoice is a couple of days overdue — so \"Chase it\" writes a polite reminder for you to send in one tap. CIS and VAT are handled on every invoice automatically.",
  },
  {
    chapter: 'A worked example', route: '/office-demo', target: '[data-tour="demo-change"]', placement: 'top',
    title: '4. Changes, signed and priced',
    body: "You found rot behind the plaster. You priced the extra, Dave signed it off, and the photo's attached — so there's no argument later about what was agreed or what it cost.",
  },
  {
    chapter: 'A worked example', route: '/office-demo', target: '[data-tour="demo-retention"]', placement: 'top',
    title: '5. Nothing slips through',
    body: "Money held back as retention gets a reminder when it's due back to you, so you never forget to collect it. That's a whole job, handled from first quote to last payment.",
  },

  // ── Getting around ──────────────────────────────────────────────────────────
  {
    chapter: 'Getting around', route: '/jobs', target: '[data-tour="jobs-title"]', placement: 'bottom',
    title: 'Jobs — one card each',
    body: "Every job in one list, with anything owing you money up top. Open a job and the quote, invoices, changes, photos and paperwork for it are all on one screen.",
  },
  {
    chapter: 'Getting around', route: '/money', target: '[data-tour="money-title"]', placement: 'bottom',
    title: 'Money — everything in and out',
    body: "Every invoice coming in, the payments you're due, and what the business costs to run each month — including the day rate you need to charge just to break even.",
  },
  {
    chapter: 'Getting around', route: '/tools', target: '[data-tour="tools-title"]', placement: 'bottom',
    title: "Tools — for when you're on site",
    body: "Trade calculators (concrete, bricks, plasterboard and more) and current supplier prices you can drop straight into a quote.",
  },

  // ── Finish ──────────────────────────────────────────────────────────────────
  {
    chapter: "You're ready", route: '/office', target: null, placement: 'center', confetti: true,
    title: "That's the tour",
    body: "Start with set-up, then send your first quote. If you ever get lost, tap \"Show me around\" on the Today screen and I'll walk you through it all again.",
  },
];

// ─── Confetti for the finale ──────────────────────────────────────────────────
function Confetti() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = [AMBER, '#FBBF24', AMBER_DIM, '#3B82F6', '#10B981', '#F8FAFC'];
    const pieces = Array.from({ length: 110 }, () => ({
      x: Math.random() * canvas.width, y: -20 - Math.random() * 200,
      w: 4 + Math.random() * 6, h: 8 + Math.random() * 10,
      vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.15,
      color: colors[Math.floor(Math.random() * colors.length)], opacity: 1,
    }));
    let frame; const start = Date.now();
    function draw() {
      const elapsed = Date.now() - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.rot += p.vr;
        if (elapsed > 1800) p.opacity = Math.max(0, p.opacity - 0.016);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = p.opacity; ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (elapsed < 3800 && pieces.some(p => p.opacity > 0)) frame = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, zIndex: 10006, pointerEvents: 'none' }} />;
}

function getTooltipStyle(rect, placement, win) {
  const w = Math.min(360, win.width - 32);
  const m = 16;
  if (placement === 'center' || !rect) {
    return { position: 'fixed', top: '50%', left: '50%', width: w, transform: 'translate(-50%, -50%)' };
  }
  let top, left, transform = 'none';
  switch (placement) {
    case 'bottom': top = rect.bottom + m; left = rect.left + rect.width / 2 - w / 2; break;
    case 'top':    top = rect.top - m;    left = rect.left + rect.width / 2 - w / 2; transform = 'translateY(-100%)'; break;
    case 'right':  top = rect.top + rect.height / 2; left = rect.right + m; transform = 'translateY(-50%)'; break;
    case 'left':   top = rect.top + rect.height / 2; left = rect.left - w - m; transform = 'translateY(-50%)'; break;
    default:       top = rect.bottom + m; left = rect.left;
  }
  left = Math.max(16, Math.min(left, win.width - w - 16));
  top = Math.max(16, Math.min(top, win.height - 40));
  return { position: 'fixed', top, left, width: w, transform };
}

export default function OfficeTour({ userId, autoStart }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [win, setWin] = useState({ width: window.innerWidth, height: window.innerHeight });
  const overlayRef = useRef(null);

  const step = STEPS[index];

  const start = useCallback(() => { setIndex(0); setRect(null); setActive(true); }, []);

  // The "Show me around" buttons (Today header, and elsewhere) fire this event.
  useEffect(() => {
    const onStart = () => start();
    window.addEventListener('aiqs:start-office-tour', onStart);
    return () => window.removeEventListener('aiqs:start-office-tour', onStart);
  }, [start]);

  const finish = useCallback(() => {
    setActive(false);
    try { localStorage.setItem(key(userId), String(OFFICE_TOUR_VERSION)); } catch {}
    // Always leave the builder back on a sensible home screen.
    if (location.pathname !== '/office') navigate('/office');
  }, [userId, navigate, location.pathname]);

  const next = useCallback(() => {
    setIndex(i => (i < STEPS.length - 1 ? i + 1 : i));
    if (index >= STEPS.length - 1) finish();
  }, [index, finish]);
  const prev = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);

  // Auto-run once for subscribers who have never seen the current version.
  useEffect(() => {
    if (!autoStart || active) return;
    let seen = -1;
    try { seen = parseInt(localStorage.getItem(key(userId)) || '-1', 10); } catch {}
    if (seen >= OFFICE_TOUR_VERSION) return;
    if (!isOfficeRoute(location.pathname)) return;
    const id = setTimeout(start, 900);
    return () => clearTimeout(id);
  }, [autoStart, active, userId, location.pathname, start]);

  // Re-measure the current target without scrolling — used while the page
  // scrolls or resizes so the spotlight stays glued to it.
  const reposition = useCallback(() => {
    if (!step.target) { setRect(null); return; }
    const el = document.querySelector(step.target);
    if (el) setRect(el.getBoundingClientRect());
  }, [step]);

  // Find the spotlight target for the current step, scrolling it into view if
  // needed. Returns false if the element isn't present/ready yet (so the caller
  // can keep polling — the target may live on a page we just navigated to).
  const locateTarget = useCallback(() => {
    if (!step.target) { setRect(null); return true; }
    const el = document.querySelector(step.target);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const onScreen = r.bottom > 0 && r.top < window.innerHeight;
    if (!onScreen) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setRect(el.getBoundingClientRect());
    return true;
  }, [step]);

  useEffect(() => {
    if (!active) return;
    // Navigate first if this step belongs to another page; the location change
    // re-runs the effect and we then look for the element.
    if (step.route && location.pathname !== step.route) {
      navigate(step.route);
      return;
    }
    if (!step.target) { setRect(null); return; }

    let cancelled = false;
    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      if (locateTarget()) {
        // Recompute once more after any smooth-scroll settles.
        setTimeout(() => { if (!cancelled) locateTarget(); }, 320);
        return;
      }
      if (tries++ < 28) setTimeout(tick, 110);
      else setRect(null); // give up gracefully → centred card
    };
    tick();
    return () => { cancelled = true; };
  }, [active, index, location.pathname, step, navigate, locateTarget]);

  // Keep the spotlight glued to its target while scrolling / resizing.
  useEffect(() => {
    if (!active) return;
    const onMove = () => {
      setWin({ width: window.innerWidth, height: window.innerHeight });
      reposition();
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [active, step, reposition]);

  // Keyboard: Esc closes, arrows move.
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, finish, next, prev]);

  // ── Floating launcher — always available on Office pages when not running ──
  if (!active) {
    if (!isOfficeRoute(location.pathname)) return null;
    return (
      <button
        onClick={start}
        aria-label="Show me around Office in a Box"
        style={{
          position: 'fixed', left: 16, bottom: 'calc(16px + env(safe-area-inset-bottom))',
          zIndex: 1200, display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', borderRadius: 999, cursor: 'pointer',
          background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
          color: '#0A0F1C', border: 'none', fontSize: 13, fontWeight: 800,
          boxShadow: '0 6px 20px rgba(245,158,11,0.4)',
        }}
      >
        <HelpCircleIcon size={16} color="#0A0F1C" />
        Show me around
      </button>
    );
  }

  const pad = 8;
  const rad = 12;
  const progress = ((index + 1) / STEPS.length) * 100;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, animation: 'oTourFade 0.35s ease forwards' }}>
      {step.confetti && <Confetti />}

      {/* Dimmer with a hole punched over the spotlight target */}
      <svg
        ref={overlayRef}
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 10001 }}
      >
        <defs>
          <mask id="office-tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - pad} y={rect.top - pad}
                width={rect.width + pad * 2} height={rect.height + pad * 2}
                rx={rad} fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.72)" mask="url(#office-tour-mask)" />
      </svg>

      {/* Glowing ring around the spotlight */}
      {rect && (
        <div style={{
          position: 'fixed',
          left: rect.left - pad - 2, top: rect.top - pad - 2,
          width: rect.width + (pad + 2) * 2, height: rect.height + (pad + 2) * 2,
          borderRadius: rad + 2, border: `2px solid ${AMBER}`,
          boxShadow: '0 0 0 4px rgba(245,158,11,0.18)',
          zIndex: 10002, pointerEvents: 'none',
          animation: 'oTourPulse 2.4s ease infinite',
        }} />
      )}

      {/* Tooltip card */}
      <div style={{
        ...getTooltipStyle(rect, step.placement, win),
        zIndex: 10003,
        animation: step.placement === 'center' ? 'oTourPop 0.35s ease forwards' : 'oTourSlide 0.32s cubic-bezier(0.22,1,0.36,1) forwards',
      }}>
        <div style={{
          background: '#0E1626', border: '1px solid rgba(245,158,11,0.22)',
          borderRadius: 16, padding: '20px 20px 16px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}>
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: AMBER,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <ZapIcon size={11} color="#0A0F1C" />
              </span>
              {step.chapter}
            </span>
            <button onClick={finish} aria-label="Close tour" style={{
              background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 7,
              padding: 5, cursor: 'pointer', color: '#94A3B8', display: 'flex',
            }}>
              <XIcon size={14} color="#94A3B8" />
            </button>
          </div>

          <h3 style={{ fontSize: 17, fontWeight: 800, color: '#F1F5F9', margin: '0 0 7px', lineHeight: 1.25 }}>
            {step.title}
          </h3>
          <p style={{ fontSize: 13.5, color: '#9FB0C5', lineHeight: 1.6, margin: '0 0 18px' }}>
            {step.body}
          </p>

          {/* Progress bar + counter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{ width: progress + '%', height: '100%', background: `linear-gradient(90deg, ${AMBER}, ${AMBER_DIM})`, borderRadius: 999, transition: 'width 0.3s ease' }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', whiteSpace: 'nowrap' }}>
              {index + 1} / {STEPS.length}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <button onClick={finish} style={{
              background: 'none', border: 'none', color: '#475569', fontSize: 12,
              cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, padding: 0,
            }}>
              {index < STEPS.length - 1 ? 'Skip tour' : 'Close'}
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
              {index > 0 && (
                <button onClick={prev} style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                  color: '#9FB0C5', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                }}>
                  <ArrowLeftIcon size={13} color="#9FB0C5" /> Back
                </button>
              )}
              <button onClick={next} style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 8,
                background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`, border: 'none',
                color: '#0A0F1C', fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
                boxShadow: '0 3px 12px rgba(245,158,11,0.3)',
              }}>
                {index < STEPS.length - 1 ? <>Next <ArrowRightIcon size={13} color="#0A0F1C" /></> : <>Finish <ArrowRightIcon size={13} color="#0A0F1C" /></>}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes oTourFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes oTourPop { from { opacity: 0; transform: translate(-50%, -48%); } to { opacity: 1; transform: translate(-50%, -50%); } }
        @keyframes oTourSlide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; } }
        @keyframes oTourPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
        @media (prefers-reduced-motion: reduce) {
          [style*="oTourPulse"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
