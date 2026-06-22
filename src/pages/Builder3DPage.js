import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

// ─────────────────────────────────────────────────────────────────────────────
// 3D Builder (Phase 1) — admin-only proof of concept.
//
// Define a rectangular building with a few sliders; a parametric three.js model
// renders brick walls + an exposed-rafter gable roof, and the server prices the
// derived quantities against the UK Master Rates library into the estimate
// sidebar on the right (the PriceAJob-style layout).
// ─────────────────────────────────────────────────────────────────────────────

const WALL_TYPES = [
  { id: 'cavity', label: 'Cavity (full-fill insulated)' },
  { id: 'cavity_brick', label: 'Cavity (brick/block)' },
  { id: 'facing_brick', label: 'Solid facing brick' },
];
const ROOF_COVERINGS = [
  { id: 'concrete_tile', label: 'Concrete tiles' },
  { id: 'clay_tile', label: 'Clay tiles' },
  { id: 'slate', label: 'Natural slate' },
];

const DEFAULTS = {
  length: 9, width: 6, wallHeight: 2.6, storeys: 1, roofPitch: 35,
  windows: 7, doors: 2, wallType: 'cavity', roofCovering: 'concrete_tile',
  ohpPct: 15, vatPct: 20,
};

function gbp(n) {
  return '£' + Math.round(n || 0).toLocaleString('en-GB');
}

// A procedural brick texture so the walls read as brickwork without shipping an
// image asset.
function makeBrickTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a4b38'; ctx.fillRect(0, 0, 256, 256);
  const bw = 64, bh = 24, mortar = 4;
  for (let row = 0, y = 0; y < 256; row++, y += bh + mortar) {
    const offset = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < 256; x += bw + mortar) {
      const shade = 150 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${shade},${Math.floor(shade * 0.55)},${Math.floor(shade * 0.42)})`;
      ctx.fillRect(x + offset, y, bw, bh);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Build a box-section "beam" between two points — used for rafters, the ridge
// board and the wall plates so the roof structure looks like real carpentry.
function addBeam(group, p1, p2, thickness, mat) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  if (len < 1e-4) return;
  const geo = new THREE.BoxGeometry(len, thickness, thickness * 1.6);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize());
  group.add(mesh);
}

function buildHouse(p, brickTex) {
  const group = new THREE.Group();
  const L = p.length, W = p.width;
  const H = p.wallHeight * p.storeys;
  const t = 0.3; // wall thickness

  const brickMat = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.95 });
  brickTex.repeat.set(L / 2, H / 2);
  const timber = new THREE.MeshStandardMaterial({ color: 0xc9a36a, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d6, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.75 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.7 });

  // Four walls as boxes forming a shell.
  const walls = [
    { w: L, d: t, x: 0, z: W / 2 - t / 2 },   // front (+Z)
    { w: L, d: t, x: 0, z: -W / 2 + t / 2 },  // back (-Z)
    { w: t, d: W, x: L / 2 - t / 2, z: 0 },   // right (+X)
    { w: t, d: W, x: -L / 2 + t / 2, z: 0 },  // left (-X)
  ];
  walls.forEach((s) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, H, s.d), brickMat);
    m.position.set(s.x, H / 2, s.z);
    group.add(m);
  });

  // Floor slab.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(L, 0.15, W), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 1 }));
  slab.position.set(0, -0.075, 0);
  group.add(slab);

  // Windows along the front + back long walls; doors on the front.
  const perWall = Math.ceil(p.windows / 2);
  const placeRow = (count, z, normalSign) => {
    if (count <= 0) return;
    const spacing = L / (count + 1);
    for (let i = 1; i <= count; i++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 0.08), glass);
      win.position.set(-L / 2 + spacing * i, H * 0.55, z + normalSign * (t / 2 + 0.02));
      group.add(win);
    }
  };
  placeRow(perWall, W / 2 - t / 2, 1);
  placeRow(p.windows - perWall, -W / 2 + t / 2, -1);

  if (p.doors > 0) {
    const dspacing = L / (p.doors + 1);
    for (let i = 1; i <= p.doors; i++) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.0, 0.1), doorMat);
      door.position.set(-L / 2 + dspacing * i, 1.0, W / 2 - t / 2 + 0.03);
      group.add(door);
    }
  }

  // Gable roof: ridge runs along X (the model long axis), slopes face ±Z.
  const rise = (W / 2) * Math.tan((p.roofPitch * Math.PI) / 180);
  const ridgeY = H + rise;
  // Ridge board.
  addBeam(group, new THREE.Vector3(-L / 2, ridgeY, 0), new THREE.Vector3(L / 2, ridgeY, 0), 0.14, timber);
  // Wall plates.
  addBeam(group, new THREE.Vector3(-L / 2, H, W / 2), new THREE.Vector3(L / 2, H, W / 2), 0.1, timber);
  addBeam(group, new THREE.Vector3(-L / 2, H, -W / 2), new THREE.Vector3(L / 2, H, -W / 2), 0.1, timber);
  // Rafters at ~0.6m centres, both slopes.
  const bays = Math.max(2, Math.round(L / 0.6));
  for (let i = 0; i <= bays; i++) {
    const x = -L / 2 + (L * i) / bays;
    addBeam(group, new THREE.Vector3(x, H, W / 2), new THREE.Vector3(x, ridgeY, 0), 0.07, timber);
    addBeam(group, new THREE.Vector3(x, H, -W / 2), new THREE.Vector3(x, ridgeY, 0), 0.07, timber);
  }

  group.position.y = 0;
  return group;
}

export default function Builder3DPage() {
  const { t } = useTheme();
  const { user } = useAuth();
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const houseRef = useRef(null);
  const brickRef = useRef(null);

  const [params, setParams] = useState(DEFAULTS);
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isAdmin = user?.role === 'admin';

  // ── three.js scene setup (once) ──
  useEffect(() => {
    if (!isAdmin) return undefined;
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef2f7);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 500);
    camera.position.set(12, 9, 14);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 2.5, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(10, 18, 8);
    scene.add(sun);
    const grid = new THREE.GridHelper(60, 60, 0xc2cbd6, 0xd8dee7);
    scene.add(grid);

    brickRef.current = makeBrickTexture();

    let raf;
    const animate = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(animate); };
    animate();

    const onResize = () => {
      if (!mount.clientWidth) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [isAdmin]);

  // ── rebuild the house whenever the geometry params change ──
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !brickRef.current) return;
    if (houseRef.current) {
      scene.remove(houseRef.current);
      houseRef.current.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    const house = buildHouse(params, brickRef.current);
    scene.add(house);
    houseRef.current = house;
  }, [params.length, params.width, params.wallHeight, params.storeys, params.roofPitch, params.windows, params.doors]);

  // ── debounced pricing call ──
  const price = useCallback(async (p) => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch('/builder3d/price', { method: 'POST', body: JSON.stringify(p) });
      setQuote(res);
    } catch (e) {
      setError(e.message || 'Pricing failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => price(params), 350);
    return () => clearTimeout(id);
  }, [params, price]);

  const set = (key) => (e) => {
    const v = e.target.value;
    setParams((p) => ({ ...p, [key]: key === 'wallType' || key === 'roofCovering' ? v : Number(v) }));
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: 32, color: t.text }}>
        <h1 style={{ fontSize: 24 }}>3D Builder</h1>
        <p style={{ color: t.textSecondary }}>This tool is currently admin-only while it's being built.</p>
      </div>
    );
  }

  const totals = quote?.totals;

  const numberField = (label, key, opts = {}) => (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>{label}</span>
      <input type="number" value={params[key]} onChange={set(key)} min={opts.min} max={opts.max} step={opts.step || 1}
        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text, fontSize: 14 }} />
    </label>
  );

  return (
    <div style={{ padding: 20, color: t.text, height: 'calc(100vh - 40px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>
          3D Builder <span style={{ fontSize: 12, fontWeight: 600, background: t.accent, color: '#fff', padding: '2px 8px', borderRadius: 999, marginLeft: 8 }}>Admin preview</span>
        </h1>
        <div style={{ color: t.textSecondary, fontSize: 13, marginTop: 4 }}>
          Parametric building → live priced take-off against the UK Master Rates library. Phase 1: rectangular footprint, gable roof.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 320px', gap: 14, flex: 1, minHeight: 0 }}>
        {/* ── Controls ── */}
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, overflowY: 'auto' }}>
          <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: t.textSecondary, marginBottom: 12 }}>Building</div>
          {numberField('Length (m)', 'length', { min: 2, max: 60, step: 0.5 })}
          {numberField('Width (m)', 'width', { min: 2, max: 60, step: 0.5 })}
          {numberField('Wall height (m)', 'wallHeight', { min: 2, max: 6, step: 0.1 })}
          {numberField('Storeys', 'storeys', { min: 1, max: 4 })}
          {numberField('Roof pitch (°)', 'roofPitch', { min: 5, max: 60 })}
          {numberField('Windows', 'windows', { min: 0, max: 60 })}
          {numberField('External doors', 'doors', { min: 0, max: 20 })}

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>Wall type</span>
            <select value={params.wallType} onChange={set('wallType')} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text }}>
              {WALL_TYPES.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>Roof covering</span>
            <select value={params.roofCovering} onChange={set('roofCovering')} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text }}>
              {ROOF_COVERINGS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>

          <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: t.textSecondary, margin: '8px 0 12px' }}>Markup</div>
          {numberField('OH&P (%)', 'ohpPct', { min: 0, max: 60 })}
          {numberField('VAT (%)', 'vatPct', { min: 0, max: 25 })}
        </div>

        {/* ── 3D viewport ── */}
        <div ref={mountRef} style={{ background: '#eef2f7', borderRadius: 12, border: '1px solid ' + t.border, overflow: 'hidden', minHeight: 0 }} />

        {/* ── Estimate sidebar ── */}
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Estimate</div>
            {loading && <span style={{ fontSize: 11, color: t.textSecondary }}>pricing…</span>}
          </div>

          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{error}</div>}

          {quote?.groups?.map((g) => (
            <div key={g.category} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: t.textSecondary, marginBottom: 6 }}>{g.category}</div>
              {g.items.map((it) => (
                <div key={it.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0', borderBottom: '1px solid ' + t.border }}>
                  <span style={{ flex: 1, paddingRight: 8 }}>
                    {it.label}
                    <span style={{ color: t.textSecondary, display: 'block', fontSize: 11 }}>{it.qty} {it.unit} @ {gbp(it.rate)}</span>
                  </span>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{gbp(it.total)}</span>
                </div>
              ))}
            </div>
          ))}

          {totals && (
            <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '2px solid ' + t.border }}>
              <Row t={t} label="Trade cost" value={gbp(totals.cost)} />
              <Row t={t} label={`OH&P (${params.ohpPct}%)`} value={gbp(totals.profit)} />
              <Row t={t} label="Subtotal" value={gbp(totals.subtotal)} bold />
              <Row t={t} label={`VAT (${params.vatPct}%)`} value={gbp(totals.vat)} />
              <Row t={t} label="Total" value={gbp(totals.total)} big />
              {quote.missing?.length > 0 && (
                <div style={{ fontSize: 10.5, color: t.textSecondary, marginTop: 8 }}>
                  {quote.missing.length} element(s) had no matching rate and were skipped.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ t, label, value, bold, big }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: big ? 18 : 13, fontWeight: big || bold ? 700 : 400, color: big ? t.accent : t.text }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
