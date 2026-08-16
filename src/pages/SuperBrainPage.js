import React, { useState, useEffect, useRef, useMemo } from 'react';
import { apiFetch } from '../utils/api';
import {
  RefreshIcon, ZapIcon, SparklesIcon, LayersIcon,
  CheckCircleIcon, AlertCircleIcon, LinkIcon, BrainIcon,
} from '../components/Icons';

// ─── The Super Brain, rendered as an actual brain ───────────────────────────
//
// A living neural visual: nodes and synapses sampled inside a brain
// silhouette, breathing and firing on a canvas. The brain is data-driven —
// more knowledge grows more neurons, and once the cross-app link is live a
// share of the pulses turn cyan: knowledge arriving from the sibling app.
// Amber = neurons this app grew itself. Cyan = the sibling's contribution.
//
// The page deliberately stays deep-space dark in both themes — it is the
// one place in the portal that is allowed to look like a machine dreaming.

const AMBER = '#F59E0B';
const AMBER_BRIGHT = '#FBBF24';
const CYAN = '#22D3EE';
const VIOLET = '#8B5CF6';

const LAYER_ICONS = {
  rates: ZapIcon,
  quantities: LayersIcon,
  projects: LayersIcon,
  corrections: SparklesIcon,
  patterns: LinkIcon,
  client_profiles: BrainIcon,
  user_memories: BrainIcon,
  playbooks: BrainIcon,
  flywheel: RefreshIcon,
  entities: BrainIcon,
  price_evidence: LayersIcon,
};

function timeAgo(iso) {
  if (!iso) return 'never';
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(then)) return iso;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function freshnessColor(iso) {
  if (!iso) return 'rgba(148,163,184,0.4)';
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  const hours = (Date.now() - then) / 3600000;
  if (hours < 2) return '#34D399';
  if (hours < 24) return AMBER_BRIGHT;
  return 'rgba(148,163,184,0.45)';
}

// Count-up that eases in — the number feels computed, not printed.
function useCountUp(target, ms = 1600) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!target) { setValue(0); return; }
    let raf; const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

// ─── The brain canvas ───────────────────────────────────────────────────────

// Side-profile brain silhouette in a 400×330 design space (facing left),
// with a cerebellum lobe and brainstem so it reads as a brain, not a blob.
function brainPath() {
  const p = new Path2D();
  p.moveTo(58, 192);
  p.bezierCurveTo(38, 150, 54, 102, 96, 76);
  p.bezierCurveTo(134, 48, 204, 36, 258, 52);
  p.bezierCurveTo(314, 68, 348, 110, 352, 160);
  p.bezierCurveTo(355, 196, 342, 226, 314, 241);
  p.bezierCurveTo(331, 251, 337, 269, 324, 284);
  p.bezierCurveTo(306, 301, 274, 303, 256, 290);
  p.bezierCurveTo(248, 298, 237, 302, 226, 298);
  p.lineTo(222, 314);
  p.lineTo(200, 311);
  p.bezierCurveTo(196, 298, 199, 290, 206, 284);
  p.bezierCurveTo(168, 287, 128, 273, 103, 250);
  p.bezierCurveTo(78, 228, 64, 212, 58, 192);
  p.closePath();
  return p;
}

function BrainCanvas({ totalKnowledge, linked, height = 460 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let nodes = [];
    let edges = [];
    let pulses = [];
    let W = 0; let H = 0;
    const path = brainPath();
    const DW = 400; const DH = 330; // design space

    function rand(a, b) { return a + Math.random() * (b - a); }

    function build() {
      const dpr = window.devicePixelRatio || 1;
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Neuron count grows with knowledge: an empty brain is sparse, a
      // learned one is dense. 60 neurons at zero → 230 at ~5000 pieces.
      const N = Math.min(230, 60 + Math.floor(Math.sqrt(totalKnowledge || 0) * 2.4));
      nodes = [];
      let guard = 0;
      // isPointInPath tests the point in device space against the CTM-transformed
      // path — sample under an identity transform so design coords line up.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      while (nodes.length < N && guard < N * 300) {
        guard++;
        const x = rand(30, DW - 20); const y = rand(30, DH - 10);
        if (ctx.isPointInPath(path, x, y)) {
          nodes.push({
            x, y,
            r: rand(1.1, 2.6),
            phase: rand(0, Math.PI * 2),
            drift: rand(0.4, 1.4),
            // Once linked, ~28% of neurons are the sibling's colour.
            shared: linked && Math.random() < 0.28,
          });
        }
      }
      ctx.restore();
      const dpr2 = window.devicePixelRatio || 1;
      ctx.setTransform(dpr2, 0, 0, dpr2, 0, 0);

      // Synapses: each neuron reaches for its 2 nearest peers, plus a few
      // long-range association fibres so pulses can cross the whole cortex.
      edges = [];
      const seen = new Set();
      const link = (i, j) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (i !== j && !seen.has(key)) { seen.add(key); edges.push([i, j]); }
      };
      nodes.forEach((n, i) => {
        const near = nodes
          .map((m, j) => ({ j, d: (m.x - n.x) ** 2 + (m.y - n.y) ** 2 }))
          .sort((a, b) => a.d - b.d)
          .slice(1, 3);
        near.forEach(({ j }) => link(i, j));
      });
      for (let k = 0; k < Math.floor(nodes.length / 9); k++) {
        link(Math.floor(rand(0, nodes.length)), Math.floor(rand(0, nodes.length)));
      }
      pulses = [];
    }

    function spawnPulse() {
      if (edges.length === 0 || pulses.length > 16) return;
      const [a, b] = edges[Math.floor(rand(0, edges.length))];
      pulses.push({
        a, b,
        t: 0,
        speed: rand(0.006, 0.016),
        color: linked && Math.random() < 0.35 ? CYAN : AMBER_BRIGHT,
      });
    }

    let lastSpawn = 0;
    function draw(now) {
      ctx.clearRect(0, 0, W, H);

      // Fit the design space into the canvas — brain sits high so the title
      // and counter get clear air beneath it.
      const s = Math.min(W / (DW + 80), (H * 0.78) / DH);
      const ox = (W - DW * s) / 2;
      const oy = H * 0.04;
      const breathe = reduceMotion ? 1 : 1 + 0.012 * Math.sin(now / 1500);

      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(breathe, breathe);
      ctx.translate(-W / 2, -H / 2);
      ctx.translate(ox, oy);
      ctx.scale(s, s);

      // The glowing contour of the mind.
      ctx.save();
      ctx.strokeStyle = 'rgba(245,158,11,0.28)';
      ctx.lineWidth = 1.6 / s;
      ctx.shadowColor = AMBER;
      ctx.shadowBlur = 26;
      ctx.stroke(path);
      ctx.restore();

      // Synapses.
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = 0.6;
      edges.forEach(([i, j]) => {
        const a = nodes[i]; const b = nodes[j];
        ctx.strokeStyle = a.shared || b.shared
          ? 'rgba(34,211,238,0.10)' : 'rgba(245,158,11,0.11)';
        ctx.beginPath();
        ctx.moveTo(a.x + a.dx, a.y + a.dy);
        ctx.lineTo(b.x + b.dx, b.y + b.dy);
        ctx.stroke();
      });

      // Neurons, breathing on their own phases.
      nodes.forEach((n) => {
        const w = reduceMotion ? 0.7 : 0.55 + 0.45 * Math.sin(n.phase + now / 900);
        n.dx = reduceMotion ? 0 : Math.sin(n.phase + now / 2300) * n.drift;
        n.dy = reduceMotion ? 0 : Math.cos(n.phase * 1.3 + now / 2700) * n.drift;
        const color = n.shared ? CYAN : AMBER;
        ctx.shadowColor = color;
        ctx.shadowBlur = 9 * w;
        ctx.fillStyle = n.shared
          ? `rgba(34,211,238,${0.35 + 0.5 * w})`
          : `rgba(251,191,36,${0.35 + 0.5 * w})`;
        ctx.beginPath();
        ctx.arc(n.x + n.dx, n.y + n.dy, n.r * (0.8 + 0.4 * w), 0, Math.PI * 2);
        ctx.fill();
      });

      // Thoughts in flight.
      if (!reduceMotion) {
        pulses = pulses.filter((pl) => pl.t <= 1);
        pulses.forEach((pl) => {
          pl.t += pl.speed;
          const a = nodes[pl.a]; const b = nodes[pl.b];
          const x = a.x + a.dx + (b.x + b.dx - a.x - a.dx) * pl.t;
          const y = a.y + a.dy + (b.y + b.dy - a.y - a.dy) * pl.t;
          ctx.shadowColor = pl.color;
          ctx.shadowBlur = 16;
          ctx.fillStyle = pl.color;
          ctx.beginPath();
          ctx.arc(x, y, 1.9, 0, Math.PI * 2);
          ctx.fill();
          // faint trail
          ctx.shadowBlur = 0;
          ctx.strokeStyle = pl.color === CYAN ? 'rgba(34,211,238,0.25)' : 'rgba(251,191,36,0.25)';
          ctx.lineWidth = 0.9;
          const tx = a.x + a.dx + (b.x + b.dx - a.x - a.dx) * Math.max(0, pl.t - 0.12);
          const ty = a.y + a.dy + (b.y + b.dy - a.y - a.dy) * Math.max(0, pl.t - 0.12);
          ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
        });
        if (now - lastSpawn > 240) { spawnPulse(); lastSpawn = now; }
      }

      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';

      if (!reduceMotion) raf = requestAnimationFrame(draw);
    }

    nodes.forEach((n) => { n.dx = 0; n.dy = 0; });
    build();
    nodes.forEach((n) => { n.dx = 0; n.dy = 0; });
    raf = requestAnimationFrame(draw);
    const onResize = () => { build(); nodes.forEach((n) => { n.dx = 0; n.dy = 0; }); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [totalKnowledge, linked]);

  return (
    <canvas
      ref={ref}
      style={{ width: '100%', height, display: 'block' }}
      aria-label="Neural visualisation of the Super Brain"
    />
  );
}

// Animated particle stream between the two linked apps.
function ExchangeStream({ active }) {
  const dots = [0, 1, 2, 3, 4, 5];
  return (
    <svg viewBox="0 0 300 60" style={{ width: '100%', height: 44, display: 'block' }} aria-hidden="true">
      <defs>
        <linearGradient id="sb-link" x1="0" x2="1">
          <stop offset="0%" stopColor={AMBER} stopOpacity="0.7" />
          <stop offset="100%" stopColor={CYAN} stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <path id="sb-wire" d="M 8 30 C 90 6, 210 54, 292 30" fill="none"
        stroke={active ? 'url(#sb-link)' : 'rgba(148,163,184,0.25)'} strokeWidth="1.4"
        strokeDasharray={active ? 'none' : '4 6'} />
      {active && dots.map((d) => (
        <circle key={d} r="2.6" fill={d % 2 ? CYAN : AMBER_BRIGHT}
          style={{ filter: `drop-shadow(0 0 4px ${d % 2 ? CYAN : AMBER_BRIGHT})` }}>
          <animateMotion dur={`${2.8 + d * 0.4}s`} begin={`${d * 0.45}s`}
            repeatCount="indefinite" keyPoints={d % 2 ? '1;0' : '0;1'} keyTimes="0;1">
            <mpath href="#sb-wire" />
          </animateMotion>
        </circle>
      ))}
    </svg>
  );
}

function Orb({ label, sub, color, active }) {
  return (
    <div style={{ textAlign: 'center', width: 128, flexShrink: 0 }}>
      <div className={active ? 'sb-orb sb-orb-live' : 'sb-orb'} style={{
        '--orb': color,
        margin: '0 auto 10px',
      }}>
        <BrainIcon size={22} />
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#E2E8F0', letterSpacing: '0.02em' }}>{label}</div>
      <div style={{ fontSize: 10.5, color: 'rgba(148,163,184,0.8)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{sub}</div>
    </div>
  );
}

const CSS = `
  .sb-root { background: radial-gradient(1200px 700px at 50% -10%, #101B33 0%, #070B14 55%, #05070D 100%); min-height: 100%; }
  .sb-title {
    font-size: clamp(30px, 5vw, 46px); font-weight: 800; letter-spacing: 0.14em; margin: 0;
    background: linear-gradient(100deg, #FDE68A 0%, ${AMBER} 38%, ${CYAN} 78%, ${VIOLET} 100%);
    background-size: 220% 100%;
    -webkit-background-clip: text; background-clip: text; color: transparent;
    animation: sb-hue 9s ease-in-out infinite alternate;
    text-shadow: none;
  }
  @keyframes sb-hue { from { background-position: 0% 0; } to { background-position: 100% 0; } }
  .sb-chip {
    display: inline-flex; align-items: center; gap: 7px; padding: 6px 13px; border-radius: 999px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
    border: 1px solid rgba(245,158,11,0.35); color: #FDE68A; background: rgba(245,158,11,0.08);
    backdrop-filter: blur(6px);
  }
  .sb-chip-cyan { border-color: rgba(34,211,238,0.4); color: #A5F3FC; background: rgba(34,211,238,0.08); }
  .sb-dot { width: 7px; height: 7px; border-radius: 50%; background: #34D399; box-shadow: 0 0 8px #34D399; animation: sb-blink 2.2s ease-in-out infinite; }
  .sb-dot-off { background: #64748B; box-shadow: none; animation: none; }
  @keyframes sb-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
  .sb-card {
    position: relative; padding: 18px 20px; border-radius: 14px; overflow: hidden;
    background: linear-gradient(160deg, rgba(17,24,39,0.92), rgba(10,15,28,0.92));
    border: 1px solid rgba(245,158,11,0.14);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 12px 40px rgba(0,0,0,0.45);
    transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
  }
  .sb-card:hover {
    transform: translateY(-3px);
    border-color: rgba(245,158,11,0.45);
    box-shadow: 0 0 0 1px rgba(245,158,11,0.15), 0 18px 50px rgba(0,0,0,0.6), 0 0 34px rgba(245,158,11,0.10);
  }
  .sb-card::before {
    content: ''; position: absolute; inset: 0 0 auto 0; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(251,191,36,0.7), transparent);
    opacity: 0.5;
  }
  .sb-bar { height: 4px; border-radius: 2px; background: rgba(148,163,184,0.15); overflow: hidden; }
  .sb-bar > span { display: block; height: 100%; border-radius: 2px;
    background: linear-gradient(90deg, ${AMBER}, ${AMBER_BRIGHT});
    box-shadow: 0 0 8px rgba(245,158,11,0.6);
    animation: sb-fill 1.2s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
  @keyframes sb-fill { from { width: 0 !important; } }
  .sb-orb {
    width: 62px; height: 62px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    color: var(--orb); border: 1px solid var(--orb);
    background: radial-gradient(circle at 35% 30%, rgba(255,255,255,0.10), transparent 60%), rgba(10,15,28,0.9);
    box-shadow: 0 0 18px -2px var(--orb), inset 0 0 14px -6px var(--orb);
  }
  .sb-orb-live { animation: sb-orbpulse 2.6s ease-in-out infinite; }
  @keyframes sb-orbpulse {
    0%,100% { box-shadow: 0 0 16px -2px var(--orb), inset 0 0 14px -6px var(--orb); }
    50% { box-shadow: 0 0 34px 2px var(--orb), inset 0 0 18px -4px var(--orb); }
  }
  .sb-sync-btn {
    padding: 11px 26px; border-radius: 10px; border: 1px solid rgba(251,191,36,0.6); cursor: pointer;
    font-size: 13.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
    color: #1A1206; background: linear-gradient(120deg, ${AMBER_BRIGHT}, ${AMBER});
    box-shadow: 0 0 24px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.35);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .sb-sync-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 0 38px rgba(245,158,11,0.55), inset 0 1px 0 rgba(255,255,255,0.35); }
  .sb-sync-btn:disabled { cursor: not-allowed; filter: grayscale(0.7) brightness(0.6); box-shadow: none; }
  .sb-feed-row { animation: sb-rise 0.5s ease both; }
  @keyframes sb-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .sb-scan {
    position: relative; overflow: hidden;
  }
  .sb-scan::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background: repeating-linear-gradient(0deg, transparent 0 2px, rgba(255,255,255,0.012) 2px 4px);
  }
  @media (prefers-reduced-motion: reduce) {
    .sb-title, .sb-dot, .sb-orb-live, .sb-feed-row { animation: none !important; }
    .sb-bar > span { animation: none !important; }
  }
`;

export default function SuperBrainPage() {
  const [snap, setSnap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  useEffect(() => { load(); }, []);

  function load() {
    setLoading(true);
    apiFetch('/super-brain/snapshot')
      .then(setSnap)
      .catch(e => setError(e.message || 'Failed to load the Super Brain'))
      .finally(() => setLoading(false));
  }

  async function syncNow() {
    setSyncing(true); setSyncMsg(null);
    try {
      const r = await apiFetch('/super-brain/sync', { method: 'POST' });
      setSyncMsg({
        ok: true,
        text: `Pulled from ${r.peer || r.source}: ${r.imported.rates} rates, ${r.imported.quantities} quantity benchmarks, ${r.imported.patterns} patterns.`,
      });
      load();
    } catch (e) {
      setSyncMsg({ ok: false, text: e.message || 'Sync failed' });
    } finally {
      setSyncing(false);
    }
  }

  const shared = snap?.shared || [];
  const linked = shared.length > 0;
  const peerLabel = useMemo(() => {
    if (shared[0]) {
      return shared[0].source_app === 'aitradespilot' ? 'AI Trades Pilot'
        : shared[0].source_app === 'aiqs-portal' ? 'AI QS Portal' : shared[0].source_app;
    }
    return snap?.app === 'aitradespilot' ? 'AI QS Portal' : 'AI Trades Pilot';
  }, [snap, shared]);

  const total = useCountUp(snap?.totalKnowledge || 0);
  const layers = snap?.layers || [];
  const maxCount = Math.max(1, ...layers.map(l => l.count || 0));

  const muted = 'rgba(148,163,184,0.9)';
  const faint = 'rgba(148,163,184,0.55)';

  if (loading) {
    return (
      <div className="sb-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 420 }}>
        <style>{CSS}</style>
        <div style={{ textAlign: 'center', color: muted }}>
          <div className="sb-orb sb-orb-live" style={{ '--orb': AMBER, margin: '0 auto 16px' }}><BrainIcon size={22} /></div>
          <div style={{ letterSpacing: '0.2em', fontSize: 12, textTransform: 'uppercase' }}>Waking the Super Brain…</div>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="sb-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 420 }}>
        <style>{CSS}</style>
        <div style={{ textAlign: 'center', color: muted }}>
          <AlertCircleIcon size={28} style={{ color: '#EF4444' }} />
          <div style={{ marginTop: 10 }}>{error}</div>
          <div style={{ marginTop: 6, fontSize: 13 }}>The Super Brain is admin-only.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="sb-root sb-scan" style={{ padding: '0 0 60px' }}>
      <style>{CSS}</style>

      {/* ── HERO: the brain itself ── */}
      <div style={{ position: 'relative', maxWidth: 1100, margin: '0 auto', height: 560 }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <BrainCanvas totalKnowledge={snap.totalKnowledge} linked={linked} height="100%" />
        </div>
        {/* scrim so the title never fights the neurons for contrast */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 240, pointerEvents: 'none',
          background: 'linear-gradient(180deg, rgba(5,7,13,0) 0%, rgba(5,7,13,0.85) 55%, rgba(5,7,13,0.95) 100%)',
        }} />

        {/* status chips float on the cortex */}
        <div style={{ position: 'absolute', top: 26, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', padding: '0 20px' }}>
          <span className="sb-chip"><span className={linked ? 'sb-dot' : 'sb-dot sb-dot-off'} /> {snap.appLabel}</span>
          <span className={linked ? 'sb-chip sb-chip-cyan' : 'sb-chip'} style={!linked ? { opacity: 0.55 } : undefined}>
            <span className={linked ? 'sb-dot' : 'sb-dot sb-dot-off'} />
            {linked ? `Linked · ${peerLabel}` : snap.peerConfigured ? 'Link ready — first sync pending' : 'Link offline'}
          </span>
        </div>

        <div style={{ position: 'absolute', bottom: 18, left: 0, right: 0, textAlign: 'center', padding: '0 20px' }}>
          <h1 className="sb-title">SUPER BRAIN</h1>
          <div style={{ marginTop: 6, fontSize: 15, color: muted }}>
            <span style={{ fontSize: 34, fontWeight: 800, color: AMBER_BRIGHT, textShadow: `0 0 24px rgba(245,158,11,0.55)`, fontVariantNumeric: 'tabular-nums' }}>
              {total.toLocaleString()}
            </span>
            <span style={{ marginLeft: 10, letterSpacing: '0.14em', textTransform: 'uppercase', fontSize: 11.5 }}>pieces of knowledge · and growing</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12.5, color: faint, maxWidth: 620, margin: '8px auto 0', lineHeight: 1.6 }}>
            <span style={{ color: AMBER_BRIGHT }}>●</span> amber neurons — knowledge this app grew itself&nbsp;&nbsp;
            <span style={{ color: CYAN }}>●</span> cyan — learned from {peerLabel}. Aggregates only, never names, clients or memories.
          </div>
        </div>
      </div>

      {/* ── CROSS-APP EXCHANGE ── */}
      <div style={{ maxWidth: 980, margin: '26px auto 0', padding: '0 24px' }}>
        <div className="sb-card" style={{ padding: '22px 26px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Orb label={snap.appLabel} sub="this mind" color={AMBER} active />
            <div style={{ flex: 1, minWidth: 180 }}>
              <ExchangeStream active={linked} />
              <div style={{ textAlign: 'center', fontSize: 11.5, color: linked ? '#A5F3FC' : faint, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>
                {linked
                  ? `${shared[0].rates} rates · ${shared[0].quantities} quantities · ${shared[0].patterns} patterns · synced ${timeAgo(shared[0].imported_at)}`
                  : snap.peerConfigured ? 'no knowledge exchanged yet' : 'set SUPER_BRAIN_KEY + SUPER_BRAIN_PEER_URL to link'}
              </div>
            </div>
            <Orb label={peerLabel} sub="sibling mind" color={CYAN} active={linked} />
            <button className="sb-sync-btn" onClick={syncNow} disabled={syncing || !snap.peerConfigured}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          {syncMsg && (
            <div style={{
              marginTop: 14, padding: '9px 14px', borderRadius: 9, fontSize: 13,
              display: 'flex', alignItems: 'center', gap: 8,
              background: syncMsg.ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              border: `1px solid ${syncMsg.ok ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)'}`,
              color: syncMsg.ok ? '#34D399' : '#F87171',
            }}>
              {syncMsg.ok ? <CheckCircleIcon size={15} /> : <AlertCircleIcon size={15} />}
              {syncMsg.text}
            </div>
          )}
        </div>
      </div>

      {/* ── KNOWLEDGE LAYERS ── */}
      <div style={{ maxWidth: 980, margin: '34px auto 0', padding: '0 24px' }}>
        <h2 style={{ fontSize: 12, fontWeight: 800, color: faint, margin: '0 0 14px', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
          ◢ Knowledge layers
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {layers.map((l, idx) => {
            const Icon = LAYER_ICONS[l.key] || BrainIcon;
            const pct = Math.max(4, Math.round(((l.count || 0) / maxCount) * 100));
            return (
              <div key={l.key} className="sb-card" style={{ animationDelay: `${idx * 60}ms` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#E2E8F0', fontSize: 14, fontWeight: 700 }}>
                    <span style={{ color: AMBER, filter: 'drop-shadow(0 0 6px rgba(245,158,11,0.7))', display: 'flex' }}><Icon size={15} /></span>
                    {l.label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: AMBER_BRIGHT, textShadow: '0 0 14px rgba(245,158,11,0.45)', fontVariantNumeric: 'tabular-nums' }}>
                    {(l.count || 0).toLocaleString()}
                  </div>
                </div>
                <div className="sb-bar" style={{ marginTop: 10 }}><span style={{ width: `${pct}%` }} /></div>
                <div style={{ fontSize: 12.5, color: muted, marginTop: 10, lineHeight: 1.55 }}>{l.description}</div>
                <div style={{ fontSize: 11, color: faint, marginTop: 9, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', letterSpacing: '0.03em' }}>
                  {l.samples != null && <span>{Number(l.samples).toLocaleString()} samples</span>}
                  {l.avg_confidence != null && <span>conf {Math.round(l.avg_confidence * 100)}%</span>}
                  {l.users != null && <span>{l.users} users</span>}
                  {l.facts != null && <span>{l.facts} facts</span>}
                  {l.sources != null && <span>{l.sources} sources</span>}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: freshnessColor(l.last_activity), boxShadow: `0 0 6px ${freshnessColor(l.last_activity)}` }} />
                    {timeAgo(l.last_activity)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── NEURAL ACTIVITY ── */}
      <div style={{ maxWidth: 980, margin: '34px auto 0', padding: '0 24px' }}>
        <h2 style={{ fontSize: 12, fontWeight: 800, color: faint, margin: '0 0 14px', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
          ◢ Neural activity
        </h2>
        <div className="sb-card" style={{ padding: '8px 0' }}>
          {(snap.recentLearnings || []).length === 0 && (
            <div style={{ padding: '16px 22px', fontSize: 13, color: muted }}>
              Silence so far — the brain learns from confirmed BOQs, corrections and conversations.
            </div>
          )}
          {(snap.recentLearnings || []).map((r, i) => (
            <div key={i} className="sb-feed-row" style={{
              padding: '11px 22px', fontSize: 13, color: '#CBD5E1', lineHeight: 1.55,
              borderTop: i > 0 ? '1px solid rgba(148,163,184,0.08)' : 'none',
              display: 'flex', gap: 12, alignItems: 'baseline', animationDelay: `${i * 80}ms`,
            }}>
              <span style={{
                fontSize: 9.5, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', flexShrink: 0,
                color: r.kind === 'correction' ? '#34D399' : AMBER_BRIGHT,
                textShadow: r.kind === 'correction' ? '0 0 10px rgba(52,211,153,0.6)' : '0 0 10px rgba(245,158,11,0.6)',
              }}>
                {r.kind}
              </span>
              <span style={{ flex: 1 }}>{r.text}</span>
              <span style={{ fontSize: 11, color: faint, flexShrink: 0 }}>{timeAgo(r.at)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── SYNC HISTORY ── */}
      {(snap.syncHistory || []).length > 0 && (
        <div style={{ maxWidth: 980, margin: '34px auto 0', padding: '0 24px' }}>
          <h2 style={{ fontSize: 12, fontWeight: 800, color: faint, margin: '0 0 14px', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
            ◢ Exchange log
          </h2>
          <div className="sb-card" style={{ padding: '4px 0' }}>
            {snap.syncHistory.map((s, i) => (
              <div key={i} style={{
                padding: '10px 22px', fontSize: 12.5, color: muted,
                borderTop: i > 0 ? '1px solid rgba(148,163,184,0.08)' : 'none',
                display: 'flex', gap: 12, alignItems: 'center',
              }}>
                <span style={{ fontWeight: 800, letterSpacing: '0.05em', color: s.direction === 'in' ? CYAN : AMBER_BRIGHT }}>
                  {s.direction === 'in' ? '↓ RECEIVED' : '↑ SERVED'}
                </span>
                <span style={{ flex: 1 }}>
                  {s.peer_app || 'peer'}{s.direction === 'in' ? ` — ${s.rates_count} rates, ${s.quantities_count} quantities, ${s.patterns_count} patterns` : ''}
                </span>
                <span style={{ fontSize: 11, color: faint }}>{timeAgo(s.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
