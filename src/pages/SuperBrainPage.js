import React, { useState, useEffect, useRef, useMemo } from 'react';
import { apiFetch } from '../utils/api';
import {
  RefreshIcon, ZapIcon, SparklesIcon, LayersIcon,
  CheckCircleIcon, AlertCircleIcon, LinkIcon, BrainIcon,
} from '../components/Icons';

// ─── The Super Brain, rendered as an actual mind ────────────────────────────
//
// A rotating 3D point-cloud brain, hand-projected onto a 2D canvas — no
// dependencies. Two wrinkled cortical hemispheres, a cerebellum, depth fog,
// synapses firing in three dimensions, orbital data rings and a starfield.
// Drag to spin it; it drifts on its own otherwise. Hovering a knowledge
// layer card lights up that layer's region of the cortex.
//
// Performance is engineered, not hoped for: glow comes from pre-rendered
// radial-gradient sprites (never per-particle shadowBlur), synapses draw in
// six batched strokes, the backing store is capped at 1.5× DPR, bloom runs
// at quarter resolution, a frame-time governor sheds bloom and then
// particles on slow devices, and the whole loop stops when the brain is
// scrolled out of view or the tab is hidden.
//
// The visual is data-driven: neuron count scales with total knowledge, and
// once the cross-app link is live a share of neurons and pulses turn cyan —
// knowledge received from the sibling app. A successful sync fires a cyan
// burst through the whole cortex.

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
function useCountUp(target, ms = 1800) {
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

// ─── The 3D brain ───────────────────────────────────────────────────────────

function makeBrainPoints(count, linked) {
  const pts = [];
  const cortexN = Math.floor(count * 0.86);
  for (let i = 0; i < count; i++) {
    const cerebellum = i >= cortexN;
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const ux = s * Math.cos(t); const uy = u; const uz = s * Math.sin(t);

    let x; let y; let z;
    if (!cerebellum) {
      // Cortical wrinkles: layered harmonics displace the shell in and out.
      const w =
        0.075 * Math.sin(6 * ux + 3 * uz) * Math.cos(5 * uy) +
        0.055 * Math.sin(9 * uz + 2) * Math.sin(7 * ux + 1) +
        0.035 * Math.cos(11 * uy + 4 * ux);
      const r = 1 + w + (Math.random() - 0.5) * 0.03;
      x = ux * 1.32 * r; y = uy * 1.0 * r; z = uz * 1.06 * r;
      // Longitudinal fissure — the groove between hemispheres.
      x += Math.sign(x) * 0.08;
      // Flatten the underside the way a real brain sits.
      if (y < -0.55) y = -0.55 + (y + 0.55) * 0.45;
      // Frontal lobe tapers slightly.
      if (z > 0.6) { x *= 0.92; y *= 0.94; }
    } else {
      // Cerebellum: small, denser, finer wrinkles, tucked at the back.
      const w = 0.10 * Math.sin(16 * ux) * Math.sin(14 * uy + 3);
      const r = 1 + w;
      x = ux * 0.44 * r;
      y = uy * 0.30 * r - 0.62;
      z = uz * 0.38 * r - 0.78;
    }
    pts.push({
      x, y, z,
      phase: Math.random() * Math.PI * 2,
      size: cerebellum ? 1.0 + Math.random() * 0.9 : 1.1 + Math.random() * 1.5,
      shared: linked && Math.random() < 0.28,
      region: 0,
    });
  }
  return pts;
}

function nearestEdges(pts, k = 2, extra = 0.12) {
  const edges = [];
  const seen = new Set();
  const link = (i, j) => {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (i !== j && !seen.has(key)) { seen.add(key); edges.push([i, j]); }
  };
  for (let i = 0; i < pts.length; i++) {
    const dists = [];
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const dx = pts[i].x - pts[j].x; const dy = pts[i].y - pts[j].y; const dz = pts[i].z - pts[j].z;
      dists.push({ j, d: dx * dx + dy * dy + dz * dz });
    }
    dists.sort((a, b) => a.d - b.d);
    for (let n = 0; n < k; n++) link(i, dists[n].j);
  }
  for (let n = 0; n < Math.floor(pts.length * extra); n++) {
    link(Math.floor(Math.random() * pts.length), Math.floor(Math.random() * pts.length));
  }
  return edges;
}

// Anchor directions for the knowledge-layer regions, spread evenly over the
// cortex with a golden-angle spiral.
function makeAnchors(count) {
  const anchors = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * 2.399963229728653;
    anchors.push({ x: Math.cos(phi) * r * 1.32, y: y * 1.0, z: Math.sin(phi) * r * 1.06 });
  }
  return anchors;
}

// Glow sprite: a radial gradient baked once and stamped with drawImage —
// the entire reason this page runs at 60fps. Per-particle shadowBlur is
// 10–50× slower than one sprite stamp.
function makeGlowSprite(coreRGB, haloRGB) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${coreRGB},1)`);
  grad.addColorStop(0.18, `rgba(${haloRGB},0.6)`);
  grad.addColorStop(0.45, `rgba(${haloRGB},0.16)`);
  grad.addColorStop(1, `rgba(${haloRGB},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function BrainCanvas({ totalKnowledge, linked, burstKey, hoverRef, layerKeys }) {
  const ref = useRef(null);
  const apiRef = useRef(null);
  const keysSig = (layerKeys || []).join(',');

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const keys = keysSig ? keysSig.split(',') : [];

    const amberSprite = makeGlowSprite('255,241,209', '245,158,11');
    const cyanSprite = makeGlowSprite('224,252,255', '34,211,238');

    let raf = 0; let running = false; let visible = true;
    let W = 0; let H = 0;
    let pts = []; let edges = []; let pulses = []; let stars = [];
    let anchors = []; let edgesByRegion = [];
    // Projection targets, reallocated only on rebuild — zero per-frame GC.
    let PX = null; let PY = null; let PF = null; let PD = null;
    // Batched synapse segments: [amber|cyan][faint|mid|bright] → flat coords.
    const segs = [[[], [], []], [[], [], []]];
    let rotY = -0.6; let rotYTarget = -0.6;
    let tiltX = -0.30; let tiltXTarget = -0.30;
    let dragging = false; let lastPX = 0; let autoSpin = true;
    let flash = 0;
    let hovIdx = -1; let hovMix = 0;
    // Quality governor: 3 = bloom on, full density · 2 = no bloom · 1 = fewer
    // neurons too. Frame-time average decides; it only ever steps down.
    let quality = 3; let frameAcc = 0; let frameCnt = 0;
    const bloomCanvas = document.createElement('canvas');
    const bloomCtx = bloomCanvas.getContext('2d');
    let bloomOK = typeof ctx.filter === 'string';

    function build() {
      // 1.5× is visually indistinguishable from full retina here and halves
      // the pixels pushed per frame on 2× displays.
      const dpr = quality === 1 ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(W * dpr));
      canvas.height = Math.max(1, Math.floor(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Neurons grow with knowledge; the governor may thin them on slow devices.
      const budget = quality === 1 ? 0.55 : 1;
      const N = Math.floor(Math.min(480, 170 + Math.floor(Math.sqrt(totalKnowledge || 0) * 4.6)) * budget);
      pts = makeBrainPoints(N, linked);
      edges = nearestEdges(pts, 2, quality === 1 ? 0.05 : 0.12);
      pulses = [];
      PX = new Float32Array(N); PY = new Float32Array(N);
      PF = new Float32Array(N); PD = new Float32Array(N);
      bloomCanvas.width = Math.max(1, Math.floor(W / 4));
      bloomCanvas.height = Math.max(1, Math.floor(H / 4));
      stars = Array.from({ length: 110 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.4 + Math.random() * 0.9,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.8,
      }));

      anchors = makeAnchors(Math.max(1, keys.length));
      pts.forEach((p) => {
        let best = 0; let bestD = Infinity;
        anchors.forEach((a, ai) => {
          const d = (p.x - a.x) ** 2 + (p.y - a.y) ** 2 + (p.z - a.z) ** 2;
          if (d < bestD) { bestD = d; best = ai; }
        });
        p.region = best;
      });
      edgesByRegion = anchors.map(() => []);
      edges.forEach((e, ei) => {
        edgesByRegion[pts[e[0]].region].push(ei);
        if (pts[e[1]].region !== pts[e[0]].region) edgesByRegion[pts[e[1]].region].push(ei);
      });
    }

    function spawnPulse(color) {
      if (edges.length === 0) return;
      let edge;
      const regional = hovIdx >= 0 ? edgesByRegion[hovIdx] : null;
      if (regional && regional.length && Math.random() < 0.8) {
        edge = edges[regional[Math.floor(Math.random() * regional.length)]];
      } else {
        edge = edges[Math.floor(Math.random() * edges.length)];
      }
      pulses.push({
        a: edge[0], b: edge[1], t: 0,
        speed: 0.008 + Math.random() * 0.012,
        color: color || (linked && Math.random() < 0.35 ? CYAN : AMBER_BRIGHT),
      });
    }

    apiRef.current = {
      burst() {
        for (let i = 0; i < 40; i++) spawnPulse(CYAN);
        flash = 1;
      },
    };

    function project(p, cx0, cy0, scale) {
      const cy = Math.cos(rotY); const sy = Math.sin(rotY);
      const cxr = Math.cos(tiltX); const sxr = Math.sin(tiltX);
      const x1 = p.x * cy + p.z * sy;
      const z1 = -p.x * sy + p.z * cy;
      const y1 = p.y * cxr - z1 * sxr;
      const z2 = p.y * sxr + z1 * cxr;
      const f = 3.4 / (3.4 + z2 + 0.2);
      return { x: cx0 + x1 * f * scale, y: cy0 - y1 * f * scale, f, depth: z2 };
    }

    let lastSpawn = 0; let lastNow = performance.now();
    function draw(now) {
      // Lowest quality tier renders at 30fps — half the work for software
      // renderers, imperceptible for a background ambience piece.
      if (quality === 1 && now - lastNow < 30) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const t0 = performance.now();
      const dt = Math.min(50, now - lastNow); lastNow = now;
      ctx.clearRect(0, 0, W, H);

      // Hover state — which layer's region is lit, eased in and out.
      const hovKey = hoverRef && hoverRef.current ? hoverRef.current.key : null;
      const wantIdx = hovKey ? keys.indexOf(hovKey) : -1;
      if (wantIdx !== hovIdx) { hovIdx = wantIdx; hovMix = 0; }
      hovMix = Math.min(1, hovMix + 0.07 * (dt / 16.7));

      // Starfield.
      ctx.fillStyle = '#8FA3BF';
      for (let i = 0; i < stars.length; i++) {
        const st = stars[i];
        ctx.globalAlpha = reduceMotion ? 0.4 : 0.18 + 0.32 * (0.5 + 0.5 * Math.sin(st.phase + now / (1400 / st.speed)));
        ctx.fillRect(st.x, st.y, st.r, st.r);
      }
      ctx.globalAlpha = 1;

      const cx0 = W / 2;
      const cy0 = H * 0.40;
      const scale = Math.min(W * 0.24, H * 0.34);

      if (!reduceMotion) {
        if (autoSpin && !dragging) rotYTarget += 0.00022 * dt;
        rotY += (rotYTarget - rotY) * 0.08;
        tiltX += (tiltXTarget - tiltX) * 0.06;
      }

      // Orbital data rings — sprite dots, no shadows.
      ctx.globalCompositeOperation = 'lighter';
      const rings = [[1.75, 0.42, 22, now / 5200], [2.05, -0.3, 16, -now / 7400]];
      for (let ri = 0; ri < rings.length; ri++) {
        const rr = rings[ri][0]; const tilt = rings[ri][1]; const nDots = rings[ri][2];
        const orbit = reduceMotion ? 0 : rings[ri][3];
        ctx.strokeStyle = ri === 0 ? 'rgba(245,158,11,0.10)' : 'rgba(34,211,238,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 56; i++) {
          const a = (i / 56) * Math.PI * 2;
          const q = project({ x: Math.cos(a) * rr, y: Math.sin(a) * rr * Math.sin(tilt), z: Math.sin(a) * rr * Math.cos(tilt) }, cx0, cy0, scale);
          if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();
        for (let i = 0; i < nDots; i++) {
          const a = (i / nDots) * Math.PI * 2 + orbit;
          const q = project({ x: Math.cos(a) * rr, y: Math.sin(a) * rr * Math.sin(tilt), z: Math.sin(a) * rr * Math.cos(tilt) }, cx0, cy0, scale);
          const sprite = (i + ri) % 3 === 0 ? cyanSprite : amberSprite;
          const R = 4.5 * q.f;
          ctx.globalAlpha = 0.16 + 0.3 * q.f;
          ctx.drawImage(sprite, q.x - R, q.y - R, R * 2, R * 2);
        }
        ctx.globalAlpha = 1;
      }

      // Project every neuron into the reusable buffers.
      const cyR = Math.cos(rotY); const syR = Math.sin(rotY);
      const cxR = Math.cos(tiltX); const sxR = Math.sin(tiltX);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const x1 = p.x * cyR + p.z * syR;
        const z1 = -p.x * syR + p.z * cyR;
        const y1 = p.y * cxR - z1 * sxR;
        const z2 = p.y * sxR + z1 * cxR;
        const f = 3.4 / (3.4 + z2 + 0.2);
        PX[i] = cx0 + x1 * f * scale;
        PY[i] = cy0 - y1 * f * scale;
        PF[i] = f; PD[i] = z2;
      }

      // Synapses in six batched strokes: 2 colours × 3 brightness bands.
      for (let c = 0; c < 2; c++) { segs[c][0].length = 0; segs[c][1].length = 0; segs[c][2].length = 0; }
      for (let e = 0; e < edges.length; e++) {
        const i = edges[e][0]; const j = edges[e][1];
        const depth = (PD[i] + PD[j]) / 2;
        let a = Math.max(0, 0.20 - depth * 0.06);
        if (hovIdx >= 0) {
          const inRegion = pts[i].region === hovIdx || pts[j].region === hovIdx;
          a *= inRegion ? 1 + 1.2 * hovMix : 1 - 0.72 * hovMix;
        }
        if (a <= 0.03) continue;
        const color = (pts[i].shared || pts[j].shared) ? 1 : 0;
        const band = a < 0.09 ? 0 : a < 0.17 ? 1 : 2;
        segs[color][band].push(PX[i], PY[i], PX[j], PY[j]);
      }
      const bandAlpha = [0.06, 0.13, 0.24];
      ctx.lineWidth = 0.6;
      for (let c = 0; c < 2; c++) {
        for (let b = 0; b < 3; b++) {
          const arr = segs[c][b];
          if (!arr.length) continue;
          ctx.strokeStyle = c === 1
            ? `rgba(34,211,238,${bandAlpha[b]})`
            : `rgba(245,158,11,${bandAlpha[b]})`;
          ctx.beginPath();
          for (let k = 0; k < arr.length; k += 4) {
            ctx.moveTo(arr[k], arr[k + 1]); ctx.lineTo(arr[k + 2], arr[k + 3]);
          }
          ctx.stroke();
        }
      }

      // A soft aura over the hovered region's anchor.
      if (hovIdx >= 0 && anchors[hovIdx]) {
        const qa = project(anchors[hovIdx], cx0, cy0, scale);
        const g = ctx.createRadialGradient(qa.x, qa.y, 0, qa.x, qa.y, scale * 0.62);
        g.addColorStop(0, `rgba(251,191,36,${0.11 * hovMix * qa.f})`);
        g.addColorStop(1, 'rgba(251,191,36,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }

      // Neurons — one sprite stamp each. Near ones large, far ones fogged.
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const tw = reduceMotion ? 0.7 : 0.55 + 0.45 * Math.sin(p.phase + now / 900);
        const fog = Math.max(0.06, Math.min(1, 1.05 - (PD[i] + 1.4) * 0.42));
        let gain = 1;
        if (hovIdx >= 0) gain = p.region === hovIdx ? 1 + 1.0 * hovMix : 1 - 0.72 * hovMix;
        const alpha = Math.min(1, (0.3 + 0.55 * tw) * fog * gain);
        if (alpha <= 0.02) continue;
        const R = p.size * PF[i] * (0.75 + 0.4 * tw) * (gain > 1 ? 1 + 0.3 * hovMix : 1) * 3.4;
        ctx.globalAlpha = alpha;
        ctx.drawImage(p.shared ? cyanSprite : amberSprite, PX[i] - R, PY[i] - R, R * 2, R * 2);
      }
      ctx.globalAlpha = 1;

      // Thoughts in flight — sprite heads with short trails.
      if (!reduceMotion) {
        pulses = pulses.filter((pl) => pl.t <= 1);
        for (let n = 0; n < pulses.length; n++) {
          const pl = pulses[n];
          pl.t += pl.speed * (dt / 16.7);
          const ai = pl.a; const bi = pl.b;
          const x = PX[ai] + (PX[bi] - PX[ai]) * pl.t;
          const y = PY[ai] + (PY[bi] - PY[ai]) * pl.t;
          const f = PF[ai] + (PF[bi] - PF[ai]) * pl.t;
          const t0p = Math.max(0, pl.t - 0.14);
          ctx.strokeStyle = pl.color === CYAN ? 'rgba(34,211,238,0.3)' : 'rgba(251,191,36,0.3)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(PX[ai] + (PX[bi] - PX[ai]) * t0p, PY[ai] + (PY[bi] - PY[ai]) * t0p);
          ctx.lineTo(x, y);
          ctx.stroke();
          const R = 7 * f;
          ctx.drawImage(pl.color === CYAN ? cyanSprite : amberSprite, x - R, y - R, R * 2, R * 2);
        }
        const spawnEvery = hovIdx >= 0 ? 90 : 200;
        const maxPulses = hovIdx >= 0 ? 26 : 18;
        if (now - lastSpawn > spawnEvery && pulses.length < maxPulses) { spawnPulse(); lastSpawn = now; }
      }

      // Sync burst flash — a cyan halo swelling out of the cortex.
      if (flash > 0.01) {
        const g = ctx.createRadialGradient(cx0, cy0, scale * 0.4, cx0, cy0, scale * (1.6 + (1 - flash) * 1.2));
        g.addColorStop(0, `rgba(34,211,238,${0.14 * flash})`);
        g.addColorStop(1, 'rgba(34,211,238,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        flash *= 0.96;
      }

      ctx.globalCompositeOperation = 'source-over';

      // Bloom at quarter resolution, only while the device holds full quality.
      if (bloomOK && quality >= 3) {
        try {
          bloomCtx.clearRect(0, 0, bloomCanvas.width, bloomCanvas.height);
          bloomCtx.drawImage(canvas, 0, 0, bloomCanvas.width, bloomCanvas.height);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.55;
          ctx.filter = 'blur(5px) saturate(1.35)';
          ctx.drawImage(bloomCanvas, 0, 0, W, H);
          ctx.restore();
          ctx.filter = 'none';
        } catch (e) { bloomOK = false; }
      }

      // Frame-time governor: a rolling average over 60 frames; too slow →
      // drop bloom, still too slow → thin the neurons. Never steps back up,
      // so quality can't oscillate.
      frameAcc += performance.now() - t0; frameCnt++;
      if (frameCnt >= 60) {
        const avg = frameAcc / frameCnt;
        frameAcc = 0; frameCnt = 0;
        if (avg > 12 && quality === 3) { quality = 2; }
        else if (avg > 12 && quality === 2) { quality = 1; build(); }
      }

      if (!reduceMotion && visible) { raf = requestAnimationFrame(draw); running = true; }
      else { running = false; }
    }

    function start() {
      if (running || reduceMotion) { if (reduceMotion) draw(performance.now()); return; }
      lastNow = performance.now();
      running = true;
      raf = requestAnimationFrame(draw);
    }

    // ── Interaction: drag to spin, hover to lean in. ──
    function onPointerDown(e) { dragging = true; autoSpin = false; lastPX = e.clientX; }
    function onPointerMove(e) {
      const rect = canvas.getBoundingClientRect();
      if (dragging) {
        rotYTarget += (e.clientX - lastPX) * 0.006;
        lastPX = e.clientX;
      } else if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const my = (e.clientY - rect.top) / rect.height;
        tiltXTarget = -0.30 + (my - 0.45) * -0.18;
      }
    }
    function onPointerUp() { dragging = false; setTimeout(() => { autoSpin = true; }, 2200); }

    build();
    start();

    // Stop burning CPU the moment the brain scrolls out of view.
    let io = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        const nowVisible = entries[0] ? entries[0].isIntersecting : true;
        if (nowVisible && !visible) { visible = true; start(); }
        else if (!nowVisible) { visible = false; }
      }, { threshold: 0.02 });
      io.observe(canvas);
    }

    const onResize = () => build();
    window.addEventListener('resize', onResize);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      cancelAnimationFrame(raf);
      if (io) io.disconnect();
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      apiRef.current = null;
    };
  }, [totalKnowledge, linked, keysSig]);

  // A sync landed — fire the cyan burst.
  useEffect(() => {
    if (burstKey > 0 && apiRef.current) apiRef.current.burst();
  }, [burstKey]);

  return (
    <canvas
      ref={ref}
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab', touchAction: 'pan-y' }}
      aria-label="Rotating neural visualisation of the Super Brain"
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

// A short synth chime when a sync lands — pure WebAudio, no assets, and only
// ever triggered by the user's own click on Sync now.
function playSyncChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = new AC();
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, ac.currentTime + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 1.1);
    g.connect(ac.destination);
    const o1 = ac.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(340, ac.currentTime);
    o1.frequency.exponentialRampToValueAtTime(1020, ac.currentTime + 0.5);
    o1.connect(g);
    const o2 = ac.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(510, ac.currentTime);
    o2.frequency.exponentialRampToValueAtTime(1530, ac.currentTime + 0.5);
    const g2 = ac.createGain(); g2.gain.value = 0.3;
    o2.connect(g2); g2.connect(g);
    o1.start(); o2.start();
    o1.stop(ac.currentTime + 1.2); o2.stop(ac.currentTime + 1.2);
    setTimeout(() => { try { ac.close(); } catch (e) {} }, 1600);
  } catch (e) { /* the chime is a garnish, never a failure */ }
}

function Orb({ label, sub, color, active }) {
  return (
    <div style={{ textAlign: 'center', width: 128, flexShrink: 0 }}>
      <div className={active ? 'sb-orb sb-orb-live' : 'sb-orb'} style={{ '--orb': color, margin: '0 auto 10px' }}>
        <BrainIcon size={22} />
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#E2E8F0', letterSpacing: '0.02em' }}>{label}</div>
      <div style={{ fontSize: 10.5, color: 'rgba(148,163,184,0.8)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{sub}</div>
    </div>
  );
}

const CSS = `
  .sb-root { background: radial-gradient(1300px 800px at 50% -12%, #0E1930 0%, #070B14 55%, #04060B 100%); min-height: 100%; }
  .sb-title {
    font-size: clamp(32px, 5.4vw, 52px); font-weight: 800; letter-spacing: 0.16em; margin: 0;
    background: linear-gradient(100deg, #FDE68A 0%, ${AMBER} 38%, ${CYAN} 78%, ${VIOLET} 100%);
    background-size: 220% 100%;
    -webkit-background-clip: text; background-clip: text; color: transparent;
    animation: sb-hue 9s ease-in-out infinite alternate;
    filter: drop-shadow(0 0 26px rgba(245,158,11,0.28));
  }
  @keyframes sb-hue { from { background-position: 0% 0; } to { background-position: 100% 0; } }
  .sb-chip {
    display: inline-flex; align-items: center; gap: 7px; padding: 6px 13px; border-radius: 999px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
    border: 1px solid rgba(245,158,11,0.35); color: #FDE68A; background: rgba(10,15,28,0.75);
  }
  .sb-chip-cyan { border-color: rgba(34,211,238,0.4); color: #A5F3FC; }
  .sb-dot { width: 7px; height: 7px; border-radius: 50%; background: #34D399; box-shadow: 0 0 8px #34D399; animation: sb-blink 2.2s ease-in-out infinite; }
  .sb-dot-off { background: #64748B; box-shadow: none; animation: none; }
  @keyframes sb-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
  .sb-hud { position: absolute; width: 26px; height: 26px; pointer-events: none; opacity: 0.55; }
  .sb-hud::before { content: ''; position: absolute; inset: 0; border: 2px solid rgba(245,158,11,0.7); }
  .sb-hud-tl { top: 14px; left: 16px; } .sb-hud-tl::before { border-right: none; border-bottom: none; }
  .sb-hud-tr { top: 14px; right: 16px; } .sb-hud-tr::before { border-left: none; border-bottom: none; }
  .sb-hud-bl { bottom: 14px; left: 16px; } .sb-hud-bl::before { border-right: none; border-top: none; }
  .sb-hud-br { bottom: 14px; right: 16px; } .sb-hud-br::before { border-left: none; border-top: none; }
  .sb-card {
    position: relative; padding: 18px 20px; border-radius: 14px; overflow: hidden;
    background: linear-gradient(160deg, rgba(17,24,39,0.92), rgba(10,15,28,0.92));
    border: 1px solid rgba(245,158,11,0.14);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 12px 40px rgba(0,0,0,0.45);
    transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
    animation: sb-card-in 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  @keyframes sb-card-in { from { opacity: 0; transform: translateY(16px) scale(0.985); } to { opacity: 1; transform: none; } }
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
  .sb-scan { position: relative; overflow: hidden; }
  .sb-scan::after {
    content: ''; position: absolute; inset: 0; pointer-events: none;
    background: repeating-linear-gradient(0deg, transparent 0 2px, rgba(255,255,255,0.012) 2px 4px);
  }
  @media (prefers-reduced-motion: reduce) {
    .sb-title, .sb-dot, .sb-orb-live, .sb-feed-row, .sb-card { animation: none !important; }
    .sb-bar > span { animation: none !important; }
  }
`;

export default function SuperBrainPage() {
  const [snap, setSnap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [burstKey, setBurstKey] = useState(0);
  // Which layer card the cursor is on — read by the canvas every frame, so a
  // ref keeps hover out of React's render loop entirely.
  const hoverRef = useRef({ key: null });

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
      setBurstKey(k => k + 1);
      playSyncChime();
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

      {/* ── HERO: the mind itself ── */}
      <div style={{ position: 'relative', maxWidth: 1160, margin: '0 auto', height: 620 }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <BrainCanvas
            totalKnowledge={snap.totalKnowledge}
            linked={linked}
            burstKey={burstKey}
            hoverRef={hoverRef}
            layerKeys={layers.map(l => l.key)}
          />
        </div>
        {/* HUD corner brackets */}
        <span className="sb-hud sb-hud-tl" /><span className="sb-hud sb-hud-tr" />
        <span className="sb-hud sb-hud-bl" /><span className="sb-hud sb-hud-br" />
        {/* scrim so the title never fights the neurons for contrast */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, height: 250, pointerEvents: 'none',
          background: 'linear-gradient(180deg, rgba(4,6,11,0) 0%, rgba(4,6,11,0.85) 55%, rgba(4,6,11,0.96) 100%)',
        }} />

        {/* status chips float on the cortex */}
        <div style={{ position: 'absolute', top: 26, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', padding: '0 20px', pointerEvents: 'none' }}>
          <span className="sb-chip"><span className={linked ? 'sb-dot' : 'sb-dot sb-dot-off'} /> {snap.appLabel}</span>
          <span className={linked ? 'sb-chip sb-chip-cyan' : 'sb-chip'} style={!linked ? { opacity: 0.55 } : undefined}>
            <span className={linked ? 'sb-dot' : 'sb-dot sb-dot-off'} />
            {linked ? `Linked · ${peerLabel}` : snap.peerConfigured ? 'Link ready — first sync pending' : 'Link offline'}
          </span>
        </div>

        <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, textAlign: 'center', padding: '0 20px', pointerEvents: 'none' }}>
          <h1 className="sb-title">SUPER BRAIN</h1>
          <div style={{ marginTop: 6, fontSize: 15, color: muted }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: AMBER_BRIGHT, textShadow: '0 0 26px rgba(245,158,11,0.55)', fontVariantNumeric: 'tabular-nums' }}>
              {total.toLocaleString()}
            </span>
            <span style={{ marginLeft: 10, letterSpacing: '0.14em', textTransform: 'uppercase', fontSize: 11.5 }}>pieces of knowledge · and growing</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12.5, color: faint, maxWidth: 640, margin: '8px auto 0', lineHeight: 1.6 }}>
            <span style={{ color: AMBER_BRIGHT }}>●</span> amber neurons — knowledge this app grew itself&nbsp;&nbsp;
            <span style={{ color: CYAN }}>●</span> cyan — learned from {peerLabel}. Aggregates only, never names, clients or memories.
            <span style={{ display: 'block', marginTop: 4, fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.7 }}>drag the brain to spin it · hover a knowledge layer to light up its region</span>
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
              <div
                key={l.key}
                className="sb-card"
                style={{ animationDelay: `${idx * 60}ms` }}
                onMouseEnter={() => { hoverRef.current.key = l.key; }}
                onMouseLeave={() => { if (hoverRef.current.key === l.key) hoverRef.current.key = null; }}
              >
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
