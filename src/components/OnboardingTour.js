import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowRightIcon, ArrowLeftIcon, XIcon } from './Icons';

// Bump this version whenever tour content changes — existing users will see the updated tour
export const TOUR_VERSION = 7;

const TOUR_STEPS = [
  {
    target: '[data-tour="welcome"]',
    title: 'Welcome to AI QS',
    description: 'Your AI-powered quantity surveying portal. Upload drawings, chat with the AI, and walk away with a priced BOQ — Excel and Word documents ready to send to clients. This short tour covers everything that is new.',
    position: 'center',
    icon: '\u2726',
  },
  {
    target: '[data-tour="start-chat"]',
    title: 'Start a project',
    description: 'Open the chat from here. Attach your drawings (PDF, ZIP, Excel, images — up to 5 files, 150 MB each), describe the scope, and hit Send. The AI extracts quantities, applies your trained rates, and produces a priced BOQ with Excel and Word downloads in under a minute.',
    position: 'bottom',
    icon: '\u2197',
  },
  {
    target: '[data-tour="welcome"]',
    title: 'A few questions when you upload',
    description: 'The first time you attach drawings to a new chat, a short intake form pops up asking for scope, floor area, location and spec level. Your answers feed straight into the pricing so the total is grounded in your numbers instead of guessed from the drawings. Skippable if you would rather the AI infer it.',
    position: 'center',
    icon: '\u270E',
  },
  {
    target: '[data-tour="welcome"]',
    title: 'Editable BOQ with provenance',
    description: 'After extraction an editable BOQ table appears inline in the chat. Click any quantity to change it and the deterministic pricer re-runs instantly. Every row carries colour-coded badges showing where the number came from — your rate library, SPON\'s base rates, AI estimate, or a manual edit — so you can see exactly what drove the total.',
    position: 'center',
    icon: '\u270F',
  },
  {
    target: '[data-tour="projects-list"]',
    title: 'Projects & Variations',
    description: 'Every confirmed BOQ lands here. Open any project to re-download the Excel + Word, view the full cost breakdown, or raise a Variation Order when the scope changes — the AI analyses the delta and the new totals flow through automatically. Approve, reject, and generate revised documents all from the Variations page on each project.',
    position: 'top',
    icon: '\u2630',
  },
  {
    target: '[data-tour="ai-memory"]',
    title: 'AI Memory — it remembers how you work',
    description: 'Everything the AI has learned about you lives here: default contingency, preferred suppliers, standard exclusions, typical regions, project types. Memories get captured automatically from your chats (with visible undo buttons so you stay in control), added manually, or seeded in 2 minutes via the onboarding questionnaire linked from this page. Every future BOQ uses them as ground truth.',
    position: 'right',
    icon: '\u{1F9E0}',
  },
  {
    target: '[data-tour="my-rates"]',
    title: 'My Rates — your pricing library',
    description: 'Build your own rate library here. Any rate you save, or correct while chatting, gets applied to every future BOQ and is badged "Your rate" on the editable table — so you can see exactly where your numbers are winning over the generic base rates.',
    position: 'right',
    icon: '\u00A3',
  },
  {
    target: '[data-tour="usage-bar"]',
    title: 'Messages & BOQ credits',
    description: 'Your monthly usage at a glance — chat messages and BOQ generations. Hover for the exact numbers. When you run low you will see a warning; upgrade or top up anytime from the Pricing page.',
    position: 'bottom',
    icon: '\u25CE',
  },
  {
    target: '[data-tour="sidebar-nav"]',
    title: 'You are all set',
    description: 'That is the tour. Upload your first set of drawings in the Chat and you will have a priced BOQ in minutes. Any questions, just ask the AI.',
    position: 'right',
    icon: '\u2714',
  },
];

function Confetti() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#F59E0B', '#FBBF24', '#D97706', '#3B82F6', '#10B981', '#A855F7', '#EF4444', '#F8FAFC'];
    const pieces = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 200,
      w: 4 + Math.random() * 6,
      h: 8 + Math.random() * 10,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.15,
      color: colors[Math.floor(Math.random() * colors.length)],
      opacity: 1,
    }));

    let frame;
    let startTime = Date.now();

    function draw() {
      const elapsed = Date.now() - startTime;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      pieces.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.06;
        p.rot += p.vr;
        if (elapsed > 2000) p.opacity = Math.max(0, p.opacity - 0.015);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });

      if (elapsed < 4000 && pieces.some(p => p.opacity > 0)) {
        frame = requestAnimationFrame(draw);
      }
    }

    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas ref={canvasRef} style={{
      position: 'fixed', inset: 0, zIndex: 10005, pointerEvents: 'none',
    }} />
  );
}

function getTooltipStyle(rect, position, windowSize) {
  const w = 360;
  const m = 16;

  if (position === 'center' || !rect) {
    return { position: 'fixed', top: '50%', left: '50%', width: w, transform: 'translate(-50%, -50%)' };
  }

  let top, left;

  switch (position) {
    case 'bottom':
      top = rect.bottom + m;
      left = rect.left + rect.width / 2 - w / 2;
      break;
    case 'top':
      top = rect.top - m;
      left = rect.left + rect.width / 2 - w / 2;
      break;
    case 'right':
      top = rect.top + rect.height / 2;
      left = rect.right + m;
      break;
    case 'left':
      top = rect.top + rect.height / 2;
      left = rect.left - w - m;
      break;
    default:
      top = rect.bottom + m;
      left = rect.left;
  }

  left = Math.max(16, Math.min(left, windowSize.width - w - 16));
  top = Math.max(16, Math.min(top, windowSize.height - 280));

  return {
    position: 'fixed', top, left, width: w,
    transform: position === 'top' ? 'translateY(-100%)' : position === 'right' || position === 'left' ? 'translateY(-50%)' : 'none',
  };
}

export default function OnboardingTour({ userId, onComplete }) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const [visible, setVisible] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const overlayRef = useRef(null);

  const currentStep = TOUR_STEPS[step];

  const updateTarget = useCallback(() => {
    if (currentStep.position === 'center') { setTargetRect(null); return; }
    const el = document.querySelector(currentStep.target);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      setTargetRect(null);
    }
  }, [currentStep]);

  useEffect(() => {
    const timer = setTimeout(() => { setVisible(true); setShowConfetti(true); }, 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (showConfetti) {
      const timer = setTimeout(() => setShowConfetti(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [showConfetti]);

  useEffect(() => {
    if (!visible) return;
    updateTarget();
    const timer = setTimeout(updateTarget, 300);
    return () => clearTimeout(timer);
  }, [step, visible, updateTarget]);

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
      updateTarget();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateTarget]);

  const next = () => { if (step < TOUR_STEPS.length - 1) setStep(s => s + 1); else finish(); };
  const prev = () => { if (step > 0) setStep(s => s - 1); };
  const finish = () => {
    setVisible(false);
    try { localStorage.setItem(`aiqs_tour_complete_${userId || 'default'}`, String(TOUR_VERSION)); } catch {}
    setTimeout(() => onComplete?.(), 300);
  };

  if (!visible) return null;

  const pad = 8;
  const rad = 12;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, animation: 'tourFadeIn 0.4s ease forwards' }}>
      {showConfetti && step === 0 && <Confetti />}

      <svg ref={overlayRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 10001 }}
        onClick={(e) => { if (e.target === overlayRef.current || e.target.tagName === 'rect') finish(); }}>
        <defs>
          <mask id="tour-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect x={targetRect.left - pad} y={targetRect.top - pad}
                width={targetRect.width + pad * 2} height={targetRect.height + pad * 2}
                rx={rad} fill="black" />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.7)" mask="url(#tour-mask)" style={{ cursor: 'pointer' }} />
      </svg>

      {targetRect && (
        <div style={{
          position: 'fixed',
          left: targetRect.left - pad - 2, top: targetRect.top - pad - 2,
          width: targetRect.width + (pad + 2) * 2, height: targetRect.height + (pad + 2) * 2,
          borderRadius: rad + 2,
          border: '1.5px solid rgba(245,158,11,0.4)',
          boxShadow: '0 0 20px rgba(245,158,11,0.15)',
          zIndex: 10002, pointerEvents: 'none',
          animation: 'tourPulseRing 2.5s ease infinite',
        }} />
      )}

      <div style={{
        ...getTooltipStyle(targetRect, currentStep.position, windowSize),
        zIndex: 10003,
        animation: currentStep.position === 'center' ? 'tourFadeInTooltip 0.4s ease forwards' : 'tourSlideIn 0.35s cubic-bezier(0.22,1,0.36,1) forwards',
      }}>
        <div style={{
          background: '#141920', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14, padding: '22px 22px 18px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 1px rgba(255,255,255,0.1)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontSize: 13, color: '#F59E0B', fontWeight: 600, lineHeight: 1,
              }}>{currentStep.icon}</span>
              <span style={{
                fontSize: 10.5, fontWeight: 600, color: 'rgba(245,158,11,0.7)',
                textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                {step + 1} / {TOUR_STEPS.length}
              </span>
            </div>
            <button onClick={finish} style={{
              background: 'rgba(255,255,255,0.05)', border: 'none',
              borderRadius: 6, padding: 4, cursor: 'pointer',
              color: '#4B5563', display: 'flex', transition: 'all 0.12s',
            }}
              onMouseEnter={e => e.currentTarget.style.color = '#94A3B8'}
              onMouseLeave={e => e.currentTarget.style.color = '#4B5563'}
            >
              <XIcon size={13} />
            </button>
          </div>

          <h3 style={{
            fontSize: 16, fontWeight: 700, color: '#F1F5F9',
            marginBottom: 6, lineHeight: 1.3,
            fontFamily: "'DM Serif Display', Georgia, serif",
          }}>
            {currentStep.title}
          </h3>
          <p style={{
            fontSize: 13, color: '#8896AB', lineHeight: 1.65, marginBottom: 20,
          }}>
            {currentStep.description}
          </p>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {TOUR_STEPS.map((_, i) => (
                <div key={i} style={{
                  width: i === step ? 18 : 5, height: 5, borderRadius: 3,
                  background: i === step ? '#F59E0B' : i < step ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.1)',
                  transition: 'all 0.3s cubic-bezier(0.22,1,0.36,1)',
                }} />
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {step > 0 && (
                <button onClick={prev} style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '6px 10px', borderRadius: 7,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)',
                  color: '#8896AB', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>
                  <ArrowLeftIcon size={12} /> Back
                </button>
              )}
              <button onClick={next} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '6px 14px', borderRadius: 7,
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                border: 'none', color: '#0A0F1C', fontSize: 12, fontWeight: 700,
                cursor: 'pointer', boxShadow: '0 2px 10px rgba(245,158,11,0.25)',
              }}>
                {step < TOUR_STEPS.length - 1 ? <>Next <ArrowRightIcon size={12} /></> : <>Get Started <ArrowRightIcon size={12} /></>}
              </button>
            </div>
          </div>

          {step < TOUR_STEPS.length - 1 && (
            <button onClick={finish} style={{
              display: 'block', margin: '10px auto 0',
              background: 'none', border: 'none',
              color: '#3D4A5C', fontSize: 11, cursor: 'pointer',
              textDecoration: 'underline', textUnderlineOffset: 3,
            }}>
              Skip tour
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes tourFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tourFadeInTooltip { from { opacity: 0; transform: translate(-50%, -48%); } to { opacity: 1; transform: translate(-50%, -50%); } }
        @keyframes tourSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes tourPulseRing {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.005); }
        }
      `}</style>
    </div>
  );
}
