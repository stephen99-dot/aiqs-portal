import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { ArrowRightIcon, ArrowLeftIcon, XIcon, ZapIcon, HelpCircleIcon } from './Icons';

// A live, hands-on walkthrough of Office in a Box, built for a tradesperson who
// has never used software like this. It drives the real app — navigating
// between pages, spotlighting the actual controls, and on the key moments it
// stops and waits for YOU to tap the highlighted button ("your turn"), so by
// the end you've genuinely started a quote, raised an invoice, and seen a whole
// job run through. The read-only /office-demo sandbox is used for the worked
// example so nothing there is ever saved.
//
// It auto-runs once on first visit and is ALWAYS available afterwards via the
// floating "Show me around" launcher and the matching button on the Today
// header, so a stuck builder can replay it any time.

// Bump when the steps change so returning users see the refreshed walkthrough.
export const OFFICE_TOUR_VERSION = 2;

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

// The walkthrough.
//   route        — navigate here before showing the step (omit to stay put)
//   target       — [data-tour] selector to spotlight (omit for a centred card)
//   interactive  — true → wait for the user to click the control to advance
//   advanceOn    — selector the click is detected on (defaults to `target`)
//   openNav      — true → open/expand the sidebar so a menu item is reachable
//   hint         — short "your turn" instruction shown on interactive steps
const STEPS = [
  // ── Welcome ──────────────────────────────────────────────────────────────
  {
    chapter: 'Welcome', route: '/office', placement: 'center',
    title: 'Welcome to Office in a Box',
    body: "I'll point, you tap. Together we'll set you up, start a real quote, raise an invoice, and walk a whole job from start to finish. It takes about three minutes, and you can stop any time. This tour always lives on your Today screen, so you can run it again whenever you get stuck.",
  },

  // ── Get set up ─────────────────────────────────────────────────────────────
  {
    chapter: 'Get set up', route: '/office', target: '[data-tour="oiab-setup"]', placement: 'bottom',
    title: 'Everything starts here — set-up',
    body: "Two minutes: your business name, logo and colour, and two quick tax questions. Do it once and every quote, invoice and letter you send goes out looking like yours, with the VAT and CIS worked out right. Come back to it whenever you like — for now, tap Next.",
  },

  // ── The Today screen ────────────────────────────────────────────────────────
  {
    chapter: 'Your Today screen', route: '/office', target: '[data-tour="oiab-money"]', placement: 'bottom',
    title: 'Your money, at a glance',
    body: "The first thing you see every morning: what you're owed, what's overdue, and what you've quoted but not heard back on. It refreshes itself — you never need to hit reload.",
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

  // ── Make a real quote ───────────────────────────────────────────────────────
  {
    chapter: 'Make a quote', route: '/office', target: '[data-tour="oiab-new-quote"]', interactive: true, placement: 'top',
    title: 'Let\'s make a real quote',
    body: "Quoting is where every job begins. Go on — tap \"New quote\" and I'll walk you through it.",
    hint: 'Tap “New quote”',
  },
  {
    chapter: 'Make a quote', route: '/estimator/new', target: '[data-tour="est-input"]', advanceOn: '[data-tour="est-price"]', interactive: true, placement: 'left',
    title: 'Describe it like you\'d tell your mate',
    body: "Type the job in plain words — \"Kitchen extension on the back, 5 by 4, brick and block, pitched tiled roof…\". When you're done, tap \"Price the job\": the AI drafts it and your own day rates price every line.",
    hint: 'Describe the job, then tap “Price the job”',
  },
  {
    chapter: 'Make a quote', route: '/estimator/new', placement: 'center',
    title: 'Your priced quote — then send it',
    body: "Give it about fifteen seconds and your itemised quote appears. Change any line, add your margin, then tap \"Save quote\". When you're happy, \"Send the quote\" fires it to your client by WhatsApp or email — and you'll see the moment they open it and accept on their phone.",
  },

  // ── A worked example (read-only demo) ───────────────────────────────────────
  {
    chapter: 'A whole job', route: '/office-demo', placement: 'center',
    title: 'Here\'s a job already running',
    body: "Now let's see what happens after the quote. This is one real-looking job — a rear extension for Dave Patel. Every figure is an example and nothing here is saved.",
  },
  {
    chapter: 'A whole job', route: '/office-demo', target: '[data-tour="demo-quote"]', placement: 'top',
    title: 'The quote — accepted on the phone',
    body: "You sent Dave the quote, he tapped to accept and signed it on his phone — no printing, no posting. That's what the green tick means.",
  },
  {
    chapter: 'A whole job', route: '/office-demo', target: '[data-tour="demo-invoice"]', advanceOn: '[data-tour="demo-chase"]', interactive: true, placement: 'top',
    title: 'An invoice gone overdue',
    body: "The deposit's paid, but this invoice is a couple of days late. Tap \"Chase it\" and see what happens — it writes the polite reminder for you.",
    hint: 'Tap “Chase it”',
  },
  {
    chapter: 'A whole job', route: '/office-demo', target: '[data-tour="demo-change"]', placement: 'top',
    title: 'Changes, signed and priced',
    body: "You found rot behind the plaster. You priced the extra, Dave signed it off, and the photo's attached — so there's no argument later about what was agreed or what it cost.",
  },
  {
    chapter: 'A whole job', route: '/office-demo', target: '[data-tour="demo-retention"]', placement: 'top',
    title: 'Nothing slips through',
    body: "Money held back as retention gets a reminder when it's due back to you, so you never forget to collect it. That's a whole job — first quote to last payment.",
  },

  // ── Raise an invoice ────────────────────────────────────────────────────────
  {
    chapter: 'Raise an invoice', route: '/money', target: '[data-tour="money-title"]', placement: 'bottom',
    title: 'Money — invoices and payments',
    body: "This is where the money side lives. Let's raise a real invoice now so you've done it once.",
  },
  {
    chapter: 'Raise an invoice', route: '/money', target: '[data-tour="money-new-invoice"]', interactive: true, placement: 'bottom',
    title: 'Start an invoice',
    body: "Your turn — tap \"+ New invoice\".",
    hint: 'Tap “+ New invoice”',
  },
  {
    chapter: 'Raise an invoice', target: '[data-tour="money-invoice-form"]', advanceOn: '[data-tour="money-create-invoice"]', interactive: true, placement: 'top',
    title: 'Pick the job, then create it',
    body: "Choose the job it's for — or start from the quote so all the lines fill in for you — then tap \"Create the invoice\".",
    hint: 'Fill it in, then tap “Create the invoice”',
  },
  {
    chapter: 'Raise an invoice', target: '[data-tour="invoice-send"]', placement: 'bottom',
    title: 'Ready to send',
    body: "Here's your invoice, with CIS and VAT already worked out for you. Tap \"Send the invoice\" to email or WhatsApp it — then it looks after itself, chasing politely if it ever goes overdue.",
  },

  // ── The rest of Money ────────────────────────────────────────────────────────
  {
    chapter: 'Money, in full', route: '/money', target: '[data-tour="money-tab-due"]', interactive: true, placement: 'bottom',
    title: 'What you\'re owed',
    body: "Money has three views. Tap \"Due in\" — the payments you're expecting but haven't invoiced yet, like stage payments and retention coming back.",
    hint: 'Tap “Due in”',
  },
  {
    chapter: 'Money, in full', route: '/money', target: '[data-tour="money-tab-numbers"]', interactive: true, placement: 'bottom',
    title: 'Your numbers',
    body: "And tap \"Your numbers\" — what your business costs to run each month, and the day rate you need to charge just to break even.",
    hint: 'Tap “Your numbers”',
  },

  // ── Getting around ──────────────────────────────────────────────────────────
  {
    chapter: 'Getting around', target: '[data-tour="nav-jobs"]', openNav: true, interactive: true, placement: 'right',
    title: 'Find your way around',
    body: "Everything's reached from the menu. Tap \"Jobs\" to see every job in one place.",
    hint: 'Tap “Jobs” in the menu',
  },
  {
    chapter: 'Getting around', route: '/jobs', target: '[data-tour="jobs-title"]', placement: 'bottom',
    title: 'Jobs — one card each',
    body: "Every job in one list, with anything owing you money up top. Open a job and the quote, invoices, changes, photos and paperwork for it are all on one screen.",
  },
  {
    chapter: 'Getting around', target: '[data-tour="nav-tools"]', openNav: true, interactive: true, placement: 'right',
    title: 'One more',
    body: "Last one — tap \"Tools\" in the menu.",
    hint: 'Tap “Tools” in the menu',
  },
  {
    chapter: 'Getting around', route: '/tools', target: '[data-tour="tools-title"]', placement: 'bottom',
    title: "Tools — for when you're on site",
    body: "Trade calculators (concrete, bricks, plasterboard and more) and current supplier prices you can drop straight into a quote.",
  },

  // ── Finish ──────────────────────────────────────────────────────────────────
  {
    chapter: "You're set", route: '/office', placement: 'center', confetti: true,
    title: "That's the tour",
    body: "You've set up, started a quote, raised an invoice and walked a whole job. If you ever get lost, tap \"Show me around\" on the Today screen and I'll walk you through it all again.",
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
  const w = Math.min(380, win.width - 32);
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
  const { t, mode } = useTheme();

  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [win, setWin] = useState({ width: window.innerWidth, height: window.innerHeight });

  const step = STEPS[index];
  const isDark = mode === 'dark';

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
    if (location.pathname !== '/office') navigate('/office');
  }, [userId, navigate, location.pathname]);

  const next = useCallback(() => {
    if (index >= STEPS.length - 1) finish();
    else setIndex(index + 1);
  }, [index, finish]);
  const prev = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);

  // Keep a stable reference to next() for DOM click handlers.
  const nextRef = useRef(next);
  useEffect(() => { nextRef.current = next; });

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

  // Re-measure the current target without scrolling — keeps the spotlight glued
  // to its element while the page scrolls or resizes.
  const reposition = useCallback(() => {
    if (!step.target) { setRect(null); return; }
    const el = document.querySelector(step.target);
    if (el) setRect(el.getBoundingClientRect());
  }, [step]);

  // Locate (and scroll to) the spotlight target. Returns false until it's ready.
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

  // Tracks the step index we've already performed the entry-navigation for, so
  // that a user-initiated navigation (e.g. tapping the highlighted button)
  // doesn't make us bounce back to the step's own route before we advance.
  const navedFor = useRef(-1);

  // Drive the current step: navigate if needed, open the nav if needed, then
  // poll for the spotlight target (it may live on a page we just navigated to).
  useEffect(() => {
    if (!active) return;
    if (step.route && location.pathname !== step.route && navedFor.current !== index) {
      navedFor.current = index;
      navigate(step.route);
      return;
    }
    navedFor.current = index;
    if (step.openNav) window.dispatchEvent(new Event('aiqs:open-office-nav'));
    if (!step.target) { setRect(null); return; }

    let cancelled = false;
    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      if (locateTarget()) {
        setTimeout(() => { if (!cancelled) locateTarget(); }, 320);
        return;
      }
      if (tries++ < 40) setTimeout(tick, 120);
      else setRect(null); // give up gracefully → centred card; Skip still works
    };
    tick();
    return () => { cancelled = true; };
  }, [active, index, location.pathname, step, navigate, locateTarget]);

  // Interactive steps: wait for the user to actually click the control.
  useEffect(() => {
    if (!active || !step.interactive) return;
    let el = null;
    let cancelled = false;
    let tries = 0;
    const handler = () => { setTimeout(() => { if (!cancelled) nextRef.current(); }, 180); };
    const attach = () => {
      if (cancelled) return;
      const sel = step.advanceOn || step.target;
      el = sel && document.querySelector(sel);
      if (el) { el.addEventListener('click', handler); return; }
      if (tries++ < 60) setTimeout(attach, 120);
    };
    attach();
    return () => { cancelled = true; if (el) el.removeEventListener('click', handler); };
  }, [active, index, location.pathname, step]);

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
  }, [active, reposition]);

  // Keyboard: Esc closes; arrows move (Next only on narrated steps).
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight' && !step.interactive) next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, step, finish, next, prev]);

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
  const dim = isDark ? 'rgba(2,6,12,0.74)' : 'rgba(15,23,42,0.45)';
  const isLast = index === STEPS.length - 1;

  // Four dim panels around the spotlight leave the highlighted control exposed
  // and clickable through the "hole"; a full-screen dim is used for centre cards.
  const panel = (s) => ({ position: 'fixed', background: dim, zIndex: 10001, pointerEvents: 'auto', ...s });
  const panels = rect ? [
    panel({ left: 0, top: 0, width: '100%', height: Math.max(0, rect.top - pad) }),
    panel({ left: 0, top: rect.bottom + pad, width: '100%', height: Math.max(0, win.height - (rect.bottom + pad)) }),
    panel({ left: 0, top: rect.top - pad, width: Math.max(0, rect.left - pad), height: rect.height + pad * 2 }),
    panel({ left: rect.right + pad, top: rect.top - pad, width: Math.max(0, win.width - (rect.right + pad)), height: rect.height + pad * 2 }),
  ] : [panel({ inset: 0 })];

  // Theme-aware tooltip surface.
  const cardBg = t.card;
  const cardBorder = `1px solid ${isDark ? 'rgba(245,158,11,0.28)' : 'rgba(245,158,11,0.4)'}`;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, animation: 'oTourFade 0.3s ease forwards' }}>
      {step.confetti && <Confetti />}

      {panels.map((p, i) => <div key={i} style={p} />)}

      {/* Glowing ring around the spotlight (never blocks the click) */}
      {rect && (
        <div style={{
          position: 'fixed',
          left: rect.left - pad - 2, top: rect.top - pad - 2,
          width: rect.width + (pad + 2) * 2, height: rect.height + (pad + 2) * 2,
          borderRadius: rad + 2, border: `2px solid ${AMBER}`,
          boxShadow: '0 0 0 4px rgba(245,158,11,0.18)',
          zIndex: 10002, pointerEvents: 'none',
          animation: 'oTourPulse 1.8s ease infinite',
        }} />
      )}

      {/* Tooltip card */}
      <div style={{
        ...getTooltipStyle(rect, step.placement, win),
        zIndex: 10003,
        animation: step.placement === 'center' ? 'oTourPop 0.32s ease forwards' : 'oTourSlide 0.3s cubic-bezier(0.22,1,0.36,1) forwards',
      }}>
        <div style={{ background: cardBg, border: cardBorder, borderRadius: 16, padding: '18px 18px 14px', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: AMBER_DIM }}>
              <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <ZapIcon size={11} color="#0A0F1C" />
              </span>
              {step.chapter}
            </span>
            <button onClick={finish} aria-label="Close tour" style={{ background: t.surface, border: 'none', borderRadius: 7, padding: 5, cursor: 'pointer', color: t.textMuted, display: 'flex' }}>
              <XIcon size={14} color={t.textMuted} />
            </button>
          </div>

          <h3 style={{ fontSize: 17, fontWeight: 800, color: t.text, margin: '0 0 7px', lineHeight: 1.25 }}>{step.title}</h3>
          <p style={{ fontSize: 13.5, color: t.textSecondary, lineHeight: 1.6, margin: '0 0 16px' }}>{step.body}</p>

          {/* "Your turn" prompt on interactive steps */}
          {step.interactive && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16,
              padding: '10px 12px', borderRadius: 10,
              background: isDark ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.1)',
              border: `1px solid ${isDark ? 'rgba(245,158,11,0.35)' : 'rgba(245,158,11,0.4)'}`,
            }}>
              <span style={{ fontSize: 18, animation: 'oTourPoint 1.1s ease-in-out infinite' }}>👆</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: t.text }}>
                Your turn — {step.hint || 'tap the highlighted button'}
              </span>
            </div>
          )}

          {/* Progress */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 999, background: t.border, overflow: 'hidden' }}>
              <div style={{ width: progress + '%', height: '100%', background: `linear-gradient(90deg, ${AMBER}, ${AMBER_DIM})`, borderRadius: 999, transition: 'width 0.3s ease' }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, whiteSpace: 'nowrap' }}>{index + 1} / {STEPS.length}</span>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <button onClick={finish} style={{ background: 'none', border: 'none', color: t.textMuted, fontSize: 12, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, padding: 0 }}>
              {isLast ? 'Close' : 'Skip tour'}
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
              {index > 0 && (
                <button onClick={prev} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderRadius: 8, background: t.surface, border: `1px solid ${t.border}`, color: t.textSecondary, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  <ArrowLeftIcon size={13} color={t.textSecondary} /> Back
                </button>
              )}
              {step.interactive ? (
                <button onClick={next} title="Skip this step" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderRadius: 8, background: 'transparent', border: `1px solid ${t.border}`, color: t.textMuted, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  Skip step <ArrowRightIcon size={13} color={t.textMuted} />
                </button>
              ) : (
                <button onClick={next} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 8, background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`, border: 'none', color: '#0A0F1C', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', boxShadow: '0 3px 12px rgba(245,158,11,0.3)' }}>
                  {isLast ? 'Finish' : 'Next'} <ArrowRightIcon size={13} color="#0A0F1C" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes oTourFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes oTourPop { from { opacity: 0; transform: translate(-50%, -48%); } to { opacity: 1; transform: translate(-50%, -50%); } }
        @keyframes oTourSlide { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; } }
        @keyframes oTourPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes oTourPoint { 0%,100% { transform: translateY(0); } 50% { transform: translateY(3px); } }
        @media (prefers-reduced-motion: reduce) { [style*="oTour"] { animation: none !important; } }
      `}</style>
    </div>
  );
}
