import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch, getToken } from '../utils/api';

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

const ROOF_TYPES = [
  { id: 'hip', label: 'Hipped' },
  { id: 'gable', label: 'Gable' },
];

const SHAPES = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'L', label: 'L-shaped' },
  { id: 'T', label: 'T-shaped' },
  { id: 'U', label: 'U-shaped' },
];

const DEFAULTS = {
  length: 9, width: 6, wallHeight: 2.6, storeys: 1, roofPitch: 35, roofType: 'hip',
  shape: 'rect', wing: 0.45,
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

// Add a flat polygon (triangle or trapezoid) from an ordered list of points,
// fan-triangulated. Used for the roof slopes and gable end walls.
function addPoly(group, points, mat) {
  const geo = new THREE.BufferGeometry();
  const verts = [];
  for (let i = 1; i < points.length - 1; i++) {
    verts.push(points[0].x, points[0].y, points[0].z);
    verts.push(points[i].x, points[i].y, points[i].z);
    verts.push(points[i + 1].x, points[i + 1].y, points[i + 1].z);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, mat));
}

// A brick-faced wall box laid along the edge a→b. The brick texture is cloned
// per wall so it tiles to the wall's own length/height instead of stretching.
function addWall(group, a, b, H, thickness, brickTex) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 1e-3) return;
  const tex = brickTex.clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.max(1, len / 2), Math.max(1, H / 2));
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, H, thickness), mat);
  mesh.position.set((a.x + b.x) / 2, H / 2, (a.z + b.z) / 2);
  mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
  group.add(mesh);
}

// Build one rectangle's roof (ridge along its long axis). `r` is centred at
// {x,z} with size {w,d}. Handles hip and gable; gable ends are filled brick.
function buildRectRoof(group, r, H, pitchDeg, roofType, timber, roofMat, brickMat) {
  const isHip = roofType === 'hip';
  const alongX = r.w >= r.d;
  const longLen = Math.max(r.w, r.d);
  const shortLen = Math.min(r.w, r.d);
  const rise = (shortLen / 2) * Math.tan((pitchDeg * Math.PI) / 180);
  const ridgeY = H + rise;
  const ridgeHalf = isHip ? Math.max(longLen / 2 - shortLen / 2, 0) : longLen / 2;
  const hl = longLen / 2, hs = shortLen / 2;
  // local (u along long axis, v across) -> world point
  const P = (u, v, y) => new THREE.Vector3(
    alongX ? r.x + u : r.x + v,
    y,
    alongX ? r.z + v : r.z + u,
  );
  const rPos = P(ridgeHalf, 0, ridgeY);
  const rNeg = P(-ridgeHalf, 0, ridgeY);

  addBeam(group, rNeg, rPos, 0.14, timber); // ridge board
  // Wall plates round the rectangle.
  addBeam(group, P(-hl, hs, H), P(hl, hs, H), 0.1, timber);
  addBeam(group, P(-hl, -hs, H), P(hl, -hs, H), 0.1, timber);
  addBeam(group, P(hl, -hs, H), P(hl, hs, H), 0.1, timber);
  addBeam(group, P(-hl, -hs, H), P(-hl, hs, H), 0.1, timber);
  // Common rafters at ~0.6m centres.
  const span = ridgeHalf * 2;
  const bays = Math.max(2, Math.round((span || longLen) / 0.6));
  for (let i = 0; i <= bays; i++) {
    const u = -ridgeHalf + (span * i) / bays;
    addBeam(group, P(u, hs, H), P(u, 0, ridgeY), 0.07, timber);
    addBeam(group, P(u, -hs, H), P(u, 0, ridgeY), 0.07, timber);
  }
  // Main slopes.
  addPoly(group, [P(-hl, hs, H), P(hl, hs, H), rPos, rNeg], roofMat);
  addPoly(group, [P(hl, -hs, H), P(-hl, -hs, H), rNeg, rPos], roofMat);
  if (isHip) {
    addBeam(group, P(hl, hs, H), rPos, 0.08, timber);
    addBeam(group, P(hl, -hs, H), rPos, 0.08, timber);
    addBeam(group, P(-hl, hs, H), rNeg, 0.08, timber);
    addBeam(group, P(-hl, -hs, H), rNeg, 0.08, timber);
    addPoly(group, [P(hl, hs, H), P(hl, -hs, H), rPos], roofMat);
    addPoly(group, [P(-hl, -hs, H), P(-hl, hs, H), rNeg], roofMat);
  } else {
    addPoly(group, [P(hl, hs, H), P(hl, -hs, H), rPos], brickMat);
    addPoly(group, [P(-hl, -hs, H), P(-hl, hs, H), rNeg], brickMat);
  }
}

// Place a window/door panel on an outline edge, offset outward (away from the
// footprint centroid) so it sits proud of the brick.
function placeOnEdge(group, e, cen, frac, y, w, h, mat) {
  const px = e.a.x + (e.b.x - e.a.x) * frac;
  const pz = e.a.z + (e.b.z - e.a.z) * frac;
  let nx = px - cen.x, nz = pz - cen.z;
  const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), mat);
  mesh.position.set(px + nx * 0.16, y, pz + nz * 0.16);
  mesh.rotation.y = -Math.atan2(e.b.z - e.a.z, e.b.x - e.a.x);
  group.add(mesh);
}

// Render the whole building from the server-supplied geometry block, so what's
// drawn is exactly what was priced.
function buildHouse(geo, brickTex) {
  const group = new THREE.Group();
  const { outline, rects, roofPitch, roofType } = geo;
  const H = geo.wallHeight * geo.storeys;
  const t = 0.3;

  const brickMat = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.95 });
  const timber = new THREE.MeshStandardMaterial({ color: 0xc9a36a, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d6, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.75 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.7 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6b5847, roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide });

  // Walls round the outline + floor slabs per rectangle.
  const n = outline.length;
  for (let i = 0; i < n; i++) addWall(group, outline[i], outline[(i + 1) % n], H, t, brickTex);
  rects.forEach((r) => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.15, r.d), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 1 }));
    slab.position.set(r.x, -0.075, r.z);
    group.add(slab);
  });

  // A roof per rectangle.
  rects.forEach((r) => buildRectRoof(group, r, H, roofPitch, roofType, timber, roofMat, brickMat));

  // Openings: edges + centroid for outward offset.
  const cen = outline.reduce((a, p) => ({ x: a.x + p.x / n, z: a.z + p.z / n }), { x: 0, z: 0 });
  const edges = outline.map((a, i) => {
    const b = outline[(i + 1) % n];
    return { a, b, len: Math.hypot(b.x - a.x, b.z - a.z) };
  });
  const perim = edges.reduce((s, e) => s + e.len, 0) || 1;
  // Doors on the longest edges.
  [...edges].sort((x, y) => y.len - x.len).slice(0, geo.doors).forEach((e) => {
    placeOnEdge(group, e, cen, 0.5, 1.0, 0.9, 2.0, doorMat);
  });
  // Windows distributed along the outline in proportion to edge length.
  edges.forEach((e) => {
    const count = Math.round(geo.windows * (e.len / perim));
    for (let k = 1; k <= count; k++) placeOnEdge(group, e, cen, k / (count + 1), H * 0.55, 1.1, 1.1, glass);
  });

  return group;
}

export default function Builder3DPage() {
  const { t } = useTheme();
  const { user } = useAuth();
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const houseRef = useRef(null);
  const brickRef = useRef(null);
  const rendererRef = useRef(null);

  const [params, setParams] = useState(DEFAULTS);
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState('');
  const [modelName, setModelName] = useState('My building');
  const [busy, setBusy] = useState('');
  const [boqSources, setBoqSources] = useState([]);
  const [deriveNotes, setDeriveNotes] = useState([]);

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

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

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

  // ── rebuild the house from the priced geometry (single source of truth) ──
  const geometry = quote?.geometry;
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !brickRef.current || !geometry) return;
    if (houseRef.current) {
      scene.remove(houseRef.current);
      houseRef.current.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material?.map) o.material.map.dispose(); });
    }
    const house = buildHouse(geometry, brickRef.current);
    scene.add(house);
    houseRef.current = house;
  }, [geometry]);

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
    const id = setTimeout(() => price(params), 250);
    return () => clearTimeout(id);
  }, [params, price]);

  // ── saved models ──
  const loadModels = useCallback(async () => {
    try {
      const res = await apiFetch('/builder3d/models');
      setModels(res.models || []);
    } catch (e) { /* non-fatal */ }
  }, []);
  useEffect(() => { if (isAdmin) loadModels(); }, [isAdmin, loadModels]);

  // ── connect an existing BOQ ──
  const loadBoqSources = useCallback(async () => {
    try {
      const res = await apiFetch('/builder3d/boq-sources');
      setBoqSources(res.sources || []);
    } catch (e) { /* non-fatal */ }
  }, []);
  useEffect(() => { if (isAdmin) loadBoqSources(); }, [isAdmin, loadBoqSources]);

  const deriveFromBoq = async (sourceId) => {
    const src = boqSources.find((s) => s.id === sourceId);
    setBusy('derive'); setError(null); setDeriveNotes([]);
    try {
      const out = await apiFetch('/builder3d/derive', { method: 'POST', body: JSON.stringify({ sourceId }) });
      setParams({ ...DEFAULTS, ...out.params });
      setModelId('');
      setModelName((src?.name || 'BOQ building') + ' (from BOQ)');
      setDeriveNotes(out.notes || []);
    } catch (e) {
      setError(e.message || 'Could not derive from BOQ');
    } finally { setBusy(''); }
  };

  const saveModel = async (asNew) => {
    setBusy('save'); setError(null);
    try {
      if (modelId && !asNew) {
        const res = await apiFetch('/builder3d/models/' + modelId, { method: 'PUT', body: JSON.stringify({ name: modelName, params }) });
        setModelName(res.name);
      } else {
        const res = await apiFetch('/builder3d/models', { method: 'POST', body: JSON.stringify({ name: modelName, params }) });
        setModelId(res.id);
      }
      await loadModels();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally { setBusy(''); }
  };

  const loadModel = (id) => {
    const found = models.find((x) => x.id === id);
    if (!found) { setModelId(''); return; }
    setModelId(found.id);
    setModelName(found.name);
    setParams({ ...DEFAULTS, ...found.params });
  };

  const deleteModel = async () => {
    if (!modelId) return;
    if (!window.confirm('Delete "' + modelName + '"?')) return;
    setBusy('delete');
    try {
      await apiFetch('/builder3d/models/' + modelId, { method: 'DELETE' });
      setModelId('');
      await loadModels();
    } catch (e) { setError(e.message || 'Delete failed'); } finally { setBusy(''); }
  };

  const exportPdf = async () => {
    setBusy('pdf'); setError(null);
    try {
      // Grab the current 3D view as a PNG to embed in the PDF. preserveDrawingBuffer
      // (set on the renderer) keeps the canvas readable here.
      let snapshot = null;
      try {
        const renderer = rendererRef.current;
        if (renderer) snapshot = renderer.domElement.toDataURL('image/png');
      } catch (e) { /* canvas not ready — export without the image */ }
      const r = await fetch('/api/builder3d/pdf', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, params, snapshot }),
      });
      if (!r.ok) throw new Error('PDF export failed');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (modelName || 'estimate').replace(/[^a-z0-9_-]+/gi, '_') + '.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e.message || 'PDF export failed');
    } finally { setBusy(''); }
  };

  const STRING_KEYS = ['wallType', 'roofCovering', 'roofType', 'shape'];
  const set = (key) => (e) => {
    const v = e.target.value;
    setParams((p) => ({ ...p, [key]: STRING_KEYS.includes(key) ? v : Number(v) }));
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
          Parametric building → live priced take-off against the UK Master Rates library. Rectangular / L / T / U footprints, hipped or gable roof.
        </div>
      </div>

      {/* ── Model toolbar: name, save/load/delete, export ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          placeholder="Model name"
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text, fontSize: 13, minWidth: 180 }}
        />
        <button onClick={() => saveModel(false)} disabled={busy === 'save'} style={btn(t, t.accent, '#fff')}>{modelId ? 'Save' : 'Save'}</button>
        <button onClick={() => saveModel(true)} disabled={busy === 'save'} style={btn(t, t.surface, t.text)}>Save as new</button>
        <select
          value={modelId}
          onChange={(e) => loadModel(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text, fontSize: 13 }}
        >
          <option value="">Load saved model…</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {modelId && <button onClick={deleteModel} disabled={busy === 'delete'} style={btn(t, t.surface, '#c0392b')}>Delete</button>}
        <select
          value=""
          onChange={(e) => { if (e.target.value) deriveFromBoq(e.target.value); }}
          disabled={busy === 'derive' || boqSources.length === 0}
          title={boqSources.length === 0 ? 'No BOQs with line items found' : 'Build a model from an existing BOQ'}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text, fontSize: 13 }}
        >
          <option value="">{busy === 'derive' ? 'Deriving…' : 'Derive from BOQ…'}</option>
          {boqSources.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.itemCount} items)</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={exportPdf} disabled={busy === 'pdf'} style={btn(t, '#10B981', '#fff')}>{busy === 'pdf' ? 'Exporting…' : 'Export PDF'}</button>
      </div>

      {deriveNotes.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: t.surface, border: '1px solid ' + t.border, borderRadius: 8, fontSize: 12, color: t.textSecondary }}>
          <strong style={{ color: t.text }}>Derived from BOQ</strong> — approximate. {deriveNotes.join(' · ')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 320px', gap: 14, flex: 1, minHeight: 0 }}>
        {/* ── Controls ── */}
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, overflowY: 'auto' }}>
          <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: t.textSecondary, marginBottom: 12 }}>Building</div>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>Footprint shape</span>
            <select value={params.shape} onChange={set('shape')} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text }}>
              {SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          {numberField('Length (m)', 'length', { min: 2, max: 60, step: 0.5 })}
          {numberField('Width (m)', 'width', { min: 2, max: 60, step: 0.5 })}
          {params.shape !== 'rect' && (
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>Wing size ({Math.round(params.wing * 100)}%)</span>
              <input type="range" min={0.2} max={0.7} step={0.05} value={params.wing} onChange={set('wing')} style={{ width: '100%' }} />
            </label>
          )}
          {numberField('Wall height (m)', 'wallHeight', { min: 2, max: 6, step: 0.1 })}
          {numberField('Storeys', 'storeys', { min: 1, max: 4 })}
          {numberField('Roof pitch (°)', 'roofPitch', { min: 5, max: 60 })}
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>Roof type</span>
            <select value={params.roofType} onChange={set('roofType')} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text }}>
              {ROOF_TYPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
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

function btn(t, bg, color) {
  return {
    padding: '7px 12px', borderRadius: 8, border: '1px solid ' + t.border,
    background: bg, color, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  };
}

function Row({ t, label, value, bold, big }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: big ? 18 : 13, fontWeight: big || bold ? 700 : 400, color: big ? t.accent : t.text }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
