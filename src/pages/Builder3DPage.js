import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  { id: 'leanto', label: 'Lean-to (mono-pitch)' },
  { id: 'flat', label: 'Flat' },
];

const SHAPES = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'L', label: 'L-shaped' },
  { id: 'T', label: 'T-shaped' },
  { id: 'U', label: 'U-shaped' },
];

// Per-module building parameters (markup is project-level, not per module).
const MODULE_DEFAULTS = {
  shape: 'rect', length: 9, width: 6, wallHeight: 2.6, storeys: 1, roofPitch: 35,
  roofType: 'hip', wing: 0.45, windows: 7, doors: 2, wallType: 'cavity', roofCovering: 'concrete_tile',
};

const MODULE_TYPES = [
  { id: 'extension', label: '+ Extension', length: 4, width: 3, storeys: 1, windows: 2, doors: 1, roofType: 'gable' },
  { id: 'garage', label: '+ Garage', length: 6, width: 6, storeys: 1, windows: 1, doors: 1, roofType: 'gable' },
  { id: 'porch', label: '+ Porch', length: 2, width: 1.5, storeys: 1, windows: 0, doors: 1, roofType: 'gable' },
];

let MODULE_SEQ = 0;
function newModule(type = 'house', overrides = {}) {
  MODULE_SEQ += 1;
  const name = type === 'house' ? 'House' : type[0].toUpperCase() + type.slice(1);
  return { id: 'm' + Date.now().toString(36) + (MODULE_SEQ), name, type, offsetX: 0, offsetZ: 0, ...MODULE_DEFAULTS, ...overrides };
}

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

// A grey roof-tile texture (courses of tiles with a slight per-tile shade).
function makeTileTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7f8488'; ctx.fillRect(0, 0, 128, 128);
  const tw = 24, th = 14, gap = 2;
  for (let row = 0, y = 0; y < 128; row++, y += th + gap) {
    const offset = row % 2 ? tw / 2 : 0;
    for (let x = -tw; x < 128; x += tw + gap) {
      const s = 120 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${s},${s + 4},${s + 8})`;
      ctx.fillRect(x + offset, y, tw, th);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Place an axis-box in an edge-local frame (x along the edge, y up, z = wall
// thickness). `origin` is the edge's start corner at ground level.
function placeBox(group, origin, ex, ey, ez, u, v, w, h, d, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.matrixAutoUpdate = false;
  const px = origin.x + ex.x * u + ey.x * v;
  const py = origin.y + ex.y * u + ey.y * v;
  const pz = origin.z + ex.z * u + ey.z * v;
  mesh.matrix.makeBasis(ex, ey, ez);
  mesh.matrix.setPosition(px, py, pz);
  group.add(mesh);
  return mesh;
}

// A framed casement window with a lintel over and a projecting cill under, in a
// cut opening centred at (u, v) on a wall edge. `mats` carries the materials.
function buildWindow(group, origin, ex, ey, ez, u, v, w, h, mats) {
  const fw = 0.08, d = 0.16;
  placeBox(group, origin, ex, ey, ez, u - (w / 2 - fw / 2), v, fw, h, d, mats.frame);
  placeBox(group, origin, ex, ey, ez, u + (w / 2 - fw / 2), v, fw, h, d, mats.frame);
  placeBox(group, origin, ex, ey, ez, u, v + (h / 2 - fw / 2), w, fw, d, mats.frame);
  placeBox(group, origin, ex, ey, ez, u, v - (h / 2 - fw / 2), w, fw, d, mats.frame);
  placeBox(group, origin, ex, ey, ez, u, v, fw * 0.6, h, d * 0.7, mats.frame);
  placeBox(group, origin, ex, ey, ez, u, v, w, fw * 0.6, d * 0.7, mats.frame);
  placeBox(group, origin, ex, ey, ez, u, v, w - 1.7 * fw, h - 1.7 * fw, 0.04, mats.glass);
  // Lintel over + projecting cill under.
  placeBox(group, origin, ex, ey, ez, u, v + h / 2 + 0.09, w + 0.24, 0.15, 0.34, mats.lintel);
  placeBox(group, origin, ex, ey, ez, u, v - h / 2 - 0.04, w + 0.18, 0.07, 0.42, mats.cill);
}

// A panelled door with frame, handle and a lintel over, in a cut opening.
function buildDoor(group, origin, ex, ey, ez, u, v, w, h, mats) {
  const fw = 0.1, d = 0.2;
  placeBox(group, origin, ex, ey, ez, u - (w / 2 - fw / 2), v, fw, h, d, mats.frame);
  placeBox(group, origin, ex, ey, ez, u + (w / 2 - fw / 2), v, fw, h, d, mats.frame);
  placeBox(group, origin, ex, ey, ez, u, v + (h / 2 - fw / 2), w, fw, d, mats.frame);
  placeBox(group, origin, ex, ey, ez, u, v, w - 1.4 * fw, h - fw, 0.06, mats.door);
  placeBox(group, origin, ex, ey, ez, u + (w / 2 - fw * 2.4), v, 0.05, 0.18, 0.12, mats.frame);
  placeBox(group, origin, ex, ey, ez, u, v + h / 2 + 0.09, w + 0.26, 0.15, 0.34, mats.lintel);
}

// Horizontal band (e.g. DPC strip) around an outline edge.
function addBand(group, a, b, y, h, depth, mat) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 1e-3) return;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, h, depth), mat);
  mesh.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
  mesh.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
  group.add(mesh);
}

// A brick wall along edge a→b with real cut window/door openings (extruded
// shape with holes), then the glazing/doors dropped into those holes.
function buildWall(group, a, b, H, t, mats, openings) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) return;
  const ex = new THREE.Vector3(dx / len, 0, dz / len);
  const ey = new THREE.Vector3(0, 1, 0);
  const ez = new THREE.Vector3().crossVectors(ex, ey).normalize();

  const shape = new THREE.Shape();
  shape.moveTo(0, 0); shape.lineTo(len, 0); shape.lineTo(len, H); shape.lineTo(0, H); shape.lineTo(0, 0);
  const placed = [];
  for (const op of openings || []) {
    const x0 = op.u - op.w / 2, x1 = op.u + op.w / 2, y0 = op.v - op.h / 2, y1 = op.v + op.h / 2;
    if (x0 < 0.2 || x1 > len - 0.2 || y0 < 0.15 || y1 > H - 0.2) continue; // keep a margin of brick
    const hole = new THREE.Path();
    hole.moveTo(x0, y0); hole.lineTo(x1, y0); hole.lineTo(x1, y1); hole.lineTo(x0, y1); hole.lineTo(x0, y0);
    shape.holes.push(hole);
    placed.push(op);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  geo.translate(0, 0, -t / 2);
  const mesh = new THREE.Mesh(geo, mats.brick);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.makeBasis(ex, ey, ez);
  mesh.matrix.setPosition(a.x, 0, a.z);
  group.add(mesh);

  const origin = new THREE.Vector3(a.x, 0, a.z);
  for (const op of placed) {
    if (op.type === 'door') buildDoor(group, origin, ex, ey, ez, op.u, op.v, op.w, op.h, mats);
    else buildWindow(group, origin, ex, ey, ez, op.u, op.v, op.w, op.h, mats);
  }
}

// Build one rectangle's finished roof (solid tiles, eaves overhang, fascia,
// bargeboards and a ridge cap). `r` is centred at {x,z} with size {w,d}.
function buildRectRoofSolid(group, r, H, pitchDeg, roofType, tileMat, fasciaMat, ridgeMat, brickMat, gutterMat, rooflights, glassMat, frameMat) {
  const isHip = roofType === 'hip';
  const alongX = r.w >= r.d;
  const longLen = Math.max(r.w, r.d);
  const shortLen = Math.min(r.w, r.d);
  const ov = 0.4; // eaves/verge overhang
  const hl = longLen / 2, hs = shortLen / 2;
  const hsE = hs + ov;
  const P = (u, v, y) => new THREE.Vector3(
    alongX ? r.x + u : r.x + v,
    y,
    alongX ? r.z + v : r.z + u,
  );

  // Flat roof — a deck just above the wall head with fascia + gutter all round.
  if (roofType === 'flat') {
    const y = H + 0.15;
    const hlF = hl + ov;
    addPoly(group, [P(-hlF, hsE, y), P(hlF, hsE, y), P(hlF, -hsE, y), P(-hlF, -hsE, y)], tileMat);
    addBeam(group, P(-hlF, hsE, y), P(hlF, hsE, y), 0.16, fasciaMat);
    addBeam(group, P(-hlF, -hsE, y), P(hlF, -hsE, y), 0.16, fasciaMat);
    addBeam(group, P(hlF, -hsE, y), P(hlF, hsE, y), 0.16, fasciaMat);
    addBeam(group, P(-hlF, -hsE, y), P(-hlF, hsE, y), 0.16, fasciaMat);
    if (gutterMat) addBeam(group, P(-hlF, hsE + 0.08, y - 0.16), P(hlF, hsE + 0.08, y - 0.16), 0.1, gutterMat);
    return;
  }

  // Lean-to (mono-pitch) — slopes up from the low (−Z) eave to a high (+Z) eave,
  // so it tucks neatly against a taller building. No ridge.
  if (roofType === 'leanto') {
    const rise = shortLen * Math.tan((pitchDeg * Math.PI) / 180);
    const yHigh = H + rise, yLow = H - 0.05;
    const hlF = hl + ov;
    addPoly(group, [P(-hlF, hsE, yHigh), P(hlF, hsE, yHigh), P(hlF, -hsE, yLow), P(-hlF, -hsE, yLow)], tileMat);
    addPoly(group, [P(hl, hs, H), P(hl, -hs, H), P(hl, -hs, yLow), P(hl, hs, yHigh)], brickMat); // brick infill ends
    addPoly(group, [P(-hl, -hs, H), P(-hl, hs, H), P(-hl, hs, yHigh), P(-hl, -hs, yLow)], brickMat);
    addBeam(group, P(-hlF, -hsE, yLow), P(hlF, -hsE, yLow), 0.16, fasciaMat);
    addBeam(group, P(-hlF, hsE, yHigh), P(hlF, hsE, yHigh), 0.16, fasciaMat);
    if (gutterMat) addBeam(group, P(-hlF, -hsE - 0.08, yLow - 0.16), P(hlF, -hsE - 0.08, yLow - 0.16), 0.1, gutterMat);
    return;
  }

  const rise = (shortLen / 2) * Math.tan((pitchDeg * Math.PI) / 180);
  const ridgeY = H + rise;
  const ridgeHalf = isHip ? Math.max(longLen / 2 - shortLen / 2, 0) : longLen / 2;
  const hlE = isHip ? hl + ov : hl;    // verge overhang only matters for hips
  const eaveY = H - 0.05;
  const rPos = P(ridgeHalf, 0, ridgeY);
  const rNeg = P(-ridgeHalf, 0, ridgeY);

  // Main slopes (tiled).
  addPoly(group, [P(-hlE, hsE, eaveY), P(hlE, hsE, eaveY), rPos, rNeg], tileMat);
  addPoly(group, [P(hlE, -hsE, eaveY), P(-hlE, -hsE, eaveY), rNeg, rPos], tileMat);

  if (isHip) {
    addPoly(group, [P(hlE, hsE, eaveY), P(hlE, -hsE, eaveY), rPos], tileMat);
    addPoly(group, [P(-hlE, -hsE, eaveY), P(-hlE, hsE, eaveY), rNeg], tileMat);
  } else {
    // Gable end walls (brick triangle, at the wall line) + bargeboards on the rake.
    addPoly(group, [P(hl, hs, H), P(hl, -hs, H), P(hl, 0, ridgeY)], brickMat);
    addPoly(group, [P(-hl, -hs, H), P(-hl, hs, H), P(-hl, 0, ridgeY)], brickMat);
    addBeam(group, P(hl, hsE, eaveY), rPos, 0.12, fasciaMat);
    addBeam(group, P(hl, -hsE, eaveY), rPos, 0.12, fasciaMat);
    addBeam(group, P(-hl, hsE, eaveY), rNeg, 0.12, fasciaMat);
    addBeam(group, P(-hl, -hsE, eaveY), rNeg, 0.12, fasciaMat);
  }

  // Fascia along the two long eaves + a gutter just below it + ridge cap.
  addBeam(group, P(-hlE, hsE, eaveY), P(hlE, hsE, eaveY), 0.16, fasciaMat);
  addBeam(group, P(-hlE, -hsE, eaveY), P(hlE, -hsE, eaveY), 0.16, fasciaMat);
  if (gutterMat) {
    addBeam(group, P(-hlE, hsE + 0.08, eaveY - 0.16), P(hlE, hsE + 0.08, eaveY - 0.16), 0.1, gutterMat);
    addBeam(group, P(-hlE, -hsE - 0.08, eaveY - 0.16), P(hlE, -hsE - 0.08, eaveY - 0.16), 0.1, gutterMat);
  }
  addBeam(group, rNeg, rPos, 0.16, ridgeMat);
  if (isHip) {
    // Hip ridge lines from corners to ridge ends.
    addBeam(group, P(hlE, hsE, eaveY), rPos, 0.12, ridgeMat);
    addBeam(group, P(hlE, -hsE, eaveY), rPos, 0.12, ridgeMat);
    addBeam(group, P(-hlE, hsE, eaveY), rNeg, 0.12, ridgeMat);
    addBeam(group, P(-hlE, -hsE, eaveY), rNeg, 0.12, ridgeMat);
  }

  // Roof windows (Velux), flush on the front (+Z) slope.
  if (rooflights > 0 && glassMat) {
    const ridgeP = P(0, 0, ridgeY), eaveP = P(0, hsE, eaveY), along0 = P(0, 0, ridgeY), along1 = P(1, 0, ridgeY);
    const aAlong = new THREE.Vector3().subVectors(along1, along0).normalize();
    const aDown = new THREE.Vector3().subVectors(eaveP, ridgeP).normalize();
    const normal = new THREE.Vector3().crossVectors(aAlong, aDown).normalize();
    if (normal.z < 0) normal.negate();
    const slopeMid = 0.45; // fraction from ridge toward eave
    const usable = Math.max(ridgeHalf * 2, 1);
    const count = Math.min(rooflights, Math.max(1, Math.floor(usable / 1.6)));
    for (let i = 1; i <= count; i++) {
      const u = -ridgeHalf + (usable * i) / (count + 1);
      const v = hsE * slopeMid;
      const yy = ridgeY + (eaveY - ridgeY) * slopeMid;
      const base = P(u, v, yy);
      const mk = (w, h, d, mat, off) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.matrixAutoUpdate = false;
        m.matrix.makeBasis(aAlong, aDown, normal);
        const pos = base.clone().addScaledVector(normal, off);
        m.matrix.setPosition(pos.x, pos.y, pos.z);
        group.add(m);
      };
      mk(1.0, 1.2, 0.08, frameMat || glassMat, 0.02);
      mk(0.82, 1.0, 0.06, glassMat, 0.06);
    }
  }
}

const ROOF_COLOURS = { concrete_tile: 0x8b9094, clay_tile: 0xa1542f, slate: 0x3a4048 };

// A brick chimney stack with capping and pots, rising from a rectangle's ridge.
function buildChimney(group, r, H, pitchDeg, brickMat, potMat) {
  const alongX = r.w >= r.d;
  const longLen = Math.max(r.w, r.d), shortLen = Math.min(r.w, r.d);
  const ridgeY = H + (shortLen / 2) * Math.tan((pitchDeg * Math.PI) / 180);
  const u = longLen * 0.3;
  const cx = r.x + (alongX ? u : 0);
  const cz = r.z + (alongX ? 0 : u);
  const top = ridgeY + 1.1, base = H - 0.3, ch = top - base;
  const stack = new THREE.Mesh(new THREE.BoxGeometry(0.7, ch, 0.7), brickMat);
  stack.position.set(cx, (base + top) / 2, cz);
  group.add(stack);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.12, 0.84), potMat);
  cap.position.set(cx, top + 0.06, cz);
  group.add(cap);
  [-0.16, 0.16].forEach((o) => {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.4, 12), potMat);
    pot.position.set(cx + (alongX ? o : 0), top + 0.3, cz + (alongX ? 0 : o));
    group.add(pot);
  });
}

// Render the whole building from the server-supplied geometry block, so what's
// drawn is exactly what was priced. brickTex/tileTex are shared canvas textures.
function buildHouse(geo, brickTex, tileTex) {
  const group = new THREE.Group();
  const { outline, rects, roofPitch, roofType } = geo;
  const storeyH = geo.wallHeight;
  const H = storeyH * geo.storeys;
  const t = 0.3;

  const mats = {
    brick: new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.92 }),
    frame: new THREE.MeshStandardMaterial({ color: 0xf3f3ef, roughness: 0.55 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9ec7da, roughness: 0.05, metalness: 0.25, transparent: true, opacity: 0.55 }),
    door: new THREE.MeshStandardMaterial({ color: 0x274055, roughness: 0.5 }),
    lintel: new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.9 }),
    cill: new THREE.MeshStandardMaterial({ color: 0xd9d7cc, roughness: 0.85 }),
  };
  const tileMat = new THREE.MeshStandardMaterial({ map: tileTex, color: ROOF_COLOURS[geo.roofCovering] || ROOF_COLOURS.concrete_tile, roughness: 0.85, side: THREE.DoubleSide });
  const fasciaMat = new THREE.MeshStandardMaterial({ color: 0xeeeee8, roughness: 0.6 });
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.8 });
  const gutterMat = new THREE.MeshStandardMaterial({ color: 0x33373b, roughness: 0.7 });
  const dpcMat = new THREE.MeshStandardMaterial({ color: 0x3f7d4e, roughness: 0.9 });
  const footingMat = new THREE.MeshStandardMaterial({ color: 0xb4b4b0, roughness: 1 });
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 1 });

  const n = outline.length;
  const edges = outline.map((a, i) => {
    const b = outline[(i + 1) % n];
    return { a, b, len: Math.hypot(b.x - a.x, b.z - a.z), openings: [] };
  });
  const perim = edges.reduce((s, e) => s + e.len, 0) || 1;

  // Assign doors to the longest edges, then spread windows along all edges in
  // proportion to length, stacked per storey.
  [...edges].sort((x, y) => y.len - x.len).slice(0, geo.doors).forEach((e) => {
    e.openings.push({ u: e.len / 2, v: 1.02, w: 0.9, h: 2.0, type: 'door' });
  });
  let wLeft = geo.windows;
  edges.forEach((e) => {
    const count = Math.round(geo.windows * (e.len / perim));
    for (let k = 1; k <= count && wLeft > 0; k++, wLeft--) {
      const storey = (k - 1) % geo.storeys;
      e.openings.push({ u: (e.len * k) / (count + 1), v: storey * storeyH + storeyH * 0.55, w: 1.2, h: 1.2, type: 'window' });
    }
  });

  // Walls with cut openings, a projecting concrete footing at the base, then a
  // green DPC band above it.
  edges.forEach((e) => {
    buildWall(group, e.a, e.b, H, t, mats, e.openings);
    addBand(group, e.a, e.b, 0.06, 0.34, t + 0.28, footingMat); // footing, proud of the wall
    addBand(group, e.a, e.b, 0.26, 0.06, t + 0.06, dpcMat);     // DPC course
  });
  rects.forEach((r) => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.15, r.d), slabMat);
    slab.position.set(r.x, -0.05, r.z);
    group.add(slab);
  });

  // Finished roof per rectangle (roof windows only on the main block).
  rects.forEach((r, idx) => buildRectRoofSolid(group, r, H, roofPitch, roofType, tileMat, fasciaMat, ridgeMat, mats.brick, gutterMat, idx === 0 ? (geo.rooflights || 0) : 0, mats.glass, mats.frame));

  // Chimney on the main block of a house.
  if ((geo.type || 'house') === 'house' && rects[0]) {
    const potMat = new THREE.MeshStandardMaterial({ color: 0xb5651d, roughness: 0.9 });
    buildChimney(group, rects[0], H, roofPitch, mats.brick, potMat);
  }

  // Downpipes at the two front corners (largest z), eave to ground.
  const cen = outline.reduce((acc, p) => ({ x: acc.x + p.x / n, z: acc.z + p.z / n }), { x: 0, z: 0 });
  [...outline].sort((p, q) => q.z - p.z).slice(0, 2).forEach((c) => {
    let nx = c.x - cen.x, nz = c.z - cen.z; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, H, 10), gutterMat);
    pipe.position.set(c.x + nx * 0.12, H / 2, c.z + nz * 0.12);
    group.add(pipe);
  });

  // One foundation annotation label (house only, to avoid clutter).
  if ((geo.type || 'house') === 'house') {
    const xs = outline.map((p) => p.x), zs = outline.map((p) => p.z);
    const fLabel = makeLabel('Strip foundation 600 × 1000mm');
    fLabel.position.set((Math.min(...xs) + Math.max(...xs)) / 2, 0.45, Math.max(...zs) + 1.1);
    group.add(fLabel);
  }

  // Shadows on everything.
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

// A floating text label (sprite) for dimension annotations.
function makeLabel(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = 'bold 44px sans-serif';
  const tw = ctx.measureText(text).width;
  c.width = Math.ceil(tw) + 32;
  c.height = 64;
  const cx = c.getContext('2d');
  cx.font = 'bold 44px sans-serif';
  cx.fillStyle = 'rgba(255,255,255,0.92)';
  cx.strokeStyle = '#1d4ed8';
  cx.lineWidth = 3;
  const r = 10;
  cx.beginPath();
  cx.moveTo(r, 2); cx.arcTo(c.width - 2, 2, c.width - 2, c.height - 2, r);
  cx.arcTo(c.width - 2, c.height - 2, 2, c.height - 2, r);
  cx.arcTo(2, c.height - 2, 2, 2, r); cx.arcTo(2, 2, c.width - 2, 2, r);
  cx.closePath(); cx.fill(); cx.stroke();
  cx.fillStyle = '#1d4ed8'; cx.textBaseline = 'middle';
  cx.fillText(text, 16, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(c.width * 0.006, c.height * 0.006, 1);
  return sp;
}

// Dimension annotations (overall length, width and ridge height) drawn as blue
// witness/dimension lines with labels — the measured lines in the reference.
function buildDimensions(geo) {
  const group = new THREE.Group();
  const { outline } = geo;
  const xs = outline.map((p) => p.x), zs = outline.map((p) => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const L = maxX - minX, W = maxZ - minZ;
  const H = geo.wallHeight * geo.storeys;
  const rise = (Math.min(L, W) / 2) * Math.tan((geo.roofPitch * Math.PI) / 180);
  const ridgeH = H + rise;
  const d = 1.4; // offset of the dimension line from the building
  const fmt = (m) => `${m.toFixed(2)} m`;
  const mat = new THREE.LineBasicMaterial({ color: 0x1d4ed8 });
  const segs = [];
  const seg = (a, b) => segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // Length (along X), in front (+Z).
  const zf = maxZ + d;
  seg(V(minX, 0.02, maxZ), V(minX, 0.02, zf));
  seg(V(maxX, 0.02, maxZ), V(maxX, 0.02, zf));
  seg(V(minX, 0.02, zf), V(maxX, 0.02, zf));
  const lLbl = makeLabel(fmt(L)); lLbl.position.set((minX + maxX) / 2, 0.4, zf); group.add(lLbl);

  // Width (along Z), to the side (+X).
  const xf = maxX + d;
  seg(V(maxX, 0.02, minZ), V(xf, 0.02, minZ));
  seg(V(maxX, 0.02, maxZ), V(xf, 0.02, maxZ));
  seg(V(xf, 0.02, minZ), V(xf, 0.02, maxZ));
  const wLbl = makeLabel(fmt(W)); wLbl.position.set(xf, 0.4, (minZ + maxZ) / 2); group.add(wLbl);

  // Height (to ridge), vertical at the front-right corner.
  seg(V(xf, 0, zf), V(xf, ridgeH, zf));
  const hLbl = makeLabel(fmt(ridgeH)); hLbl.position.set(xf, ridgeH / 2, zf); group.add(hLbl);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
  group.add(new THREE.LineSegments(g, mat));
  return group;
}

export default function Builder3DPage() {
  const { t } = useTheme();
  const { user } = useAuth();
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const houseRef = useRef(null);
  const dimsRef = useRef(null);
  const brickRef = useRef(null);
  const tileRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);

  // A project is a list of building modules (House + Extension + Garage…) plus
  // project-level markup. The controls edit the active module.
  const firstModule = useMemo(() => newModule('house'), []);
  const [modules, setModules] = useState([firstModule]);
  const [activeId, setActiveId] = useState(firstModule.id);
  const [ohpPct, setOhpPct] = useState(15);
  const [vatPct, setVatPct] = useState(20);
  const active = modules.find((m) => m.id === activeId) || modules[0];

  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState('');
  const [modelName, setModelName] = useState('My building');
  const [busy, setBusy] = useState('');
  const [boqSources, setBoqSources] = useState([]);
  const [deriveNotes, setDeriveNotes] = useState([]);
  const [panelTab, setPanelTab] = useState('estimate');
  const [showDims, setShowDims] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const pageRef = useRef(null);

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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // Absolute-position the canvas so it fills the container but never
    // contributes to layout sizing — otherwise its intrinsic width can blow the
    // grid out and push the estimate column off-screen.
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.display = 'block';
    mount.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 2.5, 0);
    cameraRef.current = camera;
    controlsRef.current = controls;

    // Sky + soft daylight: a hemisphere fill (sky/ground tint) plus a single
    // shadow-casting sun, like an architectural render.
    scene.background = new THREE.Color(0xcfe3f2);
    scene.fog = new THREE.Fog(0xcfe3f2, 70, 160);
    scene.add(new THREE.HemisphereLight(0xdfecf7, 0x6b6256, 0.85));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    sun.position.set(16, 26, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    // Grassy ground that catches the building's shadow.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x8ea974, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(80, 80, 0xb9c6b0, 0xa8b89f);
    grid.material.opacity = 0.25; grid.material.transparent = true;
    scene.add(grid);

    brickRef.current = makeBrickTexture();
    tileRef.current = makeTileTexture();

    let raf;
    const animate = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(animate); };
    animate();

    // Keep the renderer matched to the container, not the window. A plain
    // window 'resize' listener misses grid/flex relayouts (e.g. a banner
    // appearing), which can leave an oversized canvas that blows the grid out
    // and pushes the estimate column off-screen. ResizeObserver tracks the
    // element itself.
    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, true);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [isAdmin]);

  // ── rebuild all modules from the priced project (single source of truth) ──
  const projModules = quote?.modules;
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !brickRef.current || !tileRef.current || !projModules) return;
    if (houseRef.current) {
      scene.remove(houseRef.current);
      houseRef.current.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose());
      });
    }
    const root = new THREE.Group();
    projModules.forEach((mod) => {
      if (!mod.geometry) return;
      const g = buildHouse(mod.geometry, brickRef.current, tileRef.current);
      g.position.set(mod.offset?.x || 0, 0, mod.offset?.z || 0);
      root.add(g);
    });
    scene.add(root);
    houseRef.current = root;
  }, [projModules]);

  // ── dimension annotations (toggleable, per module) ──
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (dimsRef.current) {
      scene.remove(dimsRef.current);
      dimsRef.current.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      dimsRef.current = null;
    }
    if (projModules && showDims) {
      const root = new THREE.Group();
      projModules.forEach((mod) => {
        if (!mod.geometry) return;
        const d = buildDimensions(mod.geometry);
        d.position.set(mod.offset?.x || 0, 0, mod.offset?.z || 0);
        root.add(d);
      });
      scene.add(root);
      dimsRef.current = root;
    }
  }, [projModules, showDims]);

  // ── debounced pricing call (prices the whole project) ──
  const price = useCallback(async (mods, ohp, vat) => {
    setLoading(true); setError(null);
    try {
      const res = await apiFetch('/builder3d/price-multi', { method: 'POST', body: JSON.stringify({ modules: mods, ohpPct: ohp, vatPct: vat }) });
      setQuote(res);
    } catch (e) {
      setError(e.message || 'Pricing failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => price(modules, ohpPct, vatPct), 250);
    return () => clearTimeout(id);
  }, [modules, ohpPct, vatPct, price]);

  // Auto-frame the model on first load and whenever the set of modules changes
  // (added/removed) — not on every param tweak, so it won't fight manual orbit.
  const fitSigRef = useRef('');
  useEffect(() => {
    if (!quote?.modules) return;
    const sig = modules.map((m) => m.id).join(',');
    if (sig !== fitSigRef.current) {
      fitSigRef.current = sig;
      const id = setTimeout(() => fitView(), 80);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [quote, modules, fitView]);

  // Stack the three columns when the page is too narrow for them side by side.
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 980));
    ro.observe(el);
    return () => ro.disconnect();
  }, [isAdmin]);

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

  // ── module management ──
  const updateActive = (patch) => setModules((ms) => ms.map((m) => (m.id === activeId ? { ...m, ...patch } : m)));
  const addModule = (type) => {
    const tpl = MODULE_TYPES.find((x) => x.id === type) || {};
    const house = modules[0] || firstModule;
    const w = tpl.width || 3;
    const mod = newModule(type, { ...tpl, offsetX: 0, offsetZ: -((house.width || 6) / 2 + w / 2) });
    delete mod.label;
    setModules((ms) => [...ms, mod]);
    setActiveId(mod.id);
  };
  const deleteModule = (id) => {
    setModules((ms) => {
      if (ms.length <= 1) return ms;
      const next = ms.filter((m) => m.id !== id);
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  };

  const deriveFromBoq = async (sourceId) => {
    const src = boqSources.find((s) => s.id === sourceId);
    setBusy('derive'); setError(null); setDeriveNotes([]);
    try {
      const out = await apiFetch('/builder3d/derive', { method: 'POST', body: JSON.stringify({ sourceId }) });
      const mod = newModule('house', { ...out.params });
      setModules([mod]);
      setActiveId(mod.id);
      if (out.params.ohpPct != null) setOhpPct(out.params.ohpPct);
      if (out.params.vatPct != null) setVatPct(out.params.vatPct);
      setModelId('');
      setModelName((src?.name || 'BOQ building') + ' (from BOQ)');
      setDeriveNotes(out.notes || []);
    } catch (e) {
      setError(e.message || 'Could not derive from BOQ');
    } finally { setBusy(''); }
  };

  const projectPayload = () => ({ name: modelName, params: { version: 2, modules, ohpPct, vatPct } });

  const saveModel = async (asNew) => {
    setBusy('save'); setError(null);
    try {
      if (modelId && !asNew) {
        const res = await apiFetch('/builder3d/models/' + modelId, { method: 'PUT', body: JSON.stringify(projectPayload()) });
        setModelName(res.name);
      } else {
        const res = await apiFetch('/builder3d/models', { method: 'POST', body: JSON.stringify(projectPayload()) });
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
    const p = found.params || {};
    if (Array.isArray(p.modules) && p.modules.length) {
      setModules(p.modules);
      setActiveId(p.modules[0].id || p.modules[0].name);
      setOhpPct(p.ohpPct ?? 15);
      setVatPct(p.vatPct ?? 20);
    } else {
      // Back-compat: an old single-params save.
      const mod = newModule('house', { ...MODULE_DEFAULTS, ...p });
      setModules([mod]); setActiveId(mod.id);
      setOhpPct(p.ohpPct ?? 15); setVatPct(p.vatPct ?? 20);
    }
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
        body: JSON.stringify({ name: modelName, modules, ohpPct, vatPct, snapshot }),
      });
      if (!r.ok) {
        let msg = 'PDF export failed (' + r.status + ')';
        try { const j = await r.json(); if (j.error) msg = j.error; } catch (e) { /* non-JSON */ }
        throw new Error(msg);
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (modelName || 'estimate').replace(/[^a-z0-9_-]+/gi, '_') + '.pdf';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e.message || 'PDF export failed');
      window.alert('Export failed: ' + (e.message || 'unknown error'));
    } finally { setBusy(''); }
  };

  // Frame the whole project: centre + zoom the camera on the combined bounding
  // box of every module. Also composes the PDF snapshot nicely.
  const fitView = useCallback(() => {
    const cam = cameraRef.current, ctr = controlsRef.current;
    const mods = quote?.modules;
    if (!cam || !ctr || !mods?.length) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 3;
    mods.forEach((mod) => {
      const g = mod.geometry; if (!g?.outline) return;
      const ox = mod.offset?.x || 0, oz = mod.offset?.z || 0;
      const xs = g.outline.map((p) => p.x), zs = g.outline.map((p) => p.z);
      minX = Math.min(minX, ox + Math.min(...xs)); maxX = Math.max(maxX, ox + Math.max(...xs));
      minZ = Math.min(minZ, oz + Math.min(...zs)); maxZ = Math.max(maxZ, oz + Math.max(...zs));
      const L = Math.max(...xs) - Math.min(...xs), W = Math.max(...zs) - Math.min(...zs);
      const h = g.wallHeight * g.storeys + (Math.min(L, W) / 2) * Math.tan((g.roofPitch * Math.PI) / 180);
      maxY = Math.max(maxY, h + (g.type === 'house' ? 1.5 : 0));
    });
    if (!isFinite(minX)) return;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, cy = maxY / 2;
    const radius = Math.max(maxX - minX, maxZ - minZ, maxY) * 0.5 || 6;
    const dist = radius / Math.tan((cam.fov * Math.PI) / 360) * 1.5 + radius;
    ctr.target.set(cx, cy, cz);
    cam.position.set(cx + dist * 0.7, cy + dist * 0.6, cz + dist * 0.9);
    cam.lookAt(cx, cy, cz);
    ctr.update();
  }, [quote]);

  const STRING_KEYS = ['wallType', 'roofCovering', 'roofType', 'shape'];
  const set = (key) => (e) => {
    const v = e.target.value;
    updateActive({ [key]: STRING_KEYS.includes(key) ? v : Number(v) });
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
      <input type="number" value={active[key]} onChange={set(key)} min={opts.min} max={opts.max} step={opts.step || 1}
        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text, fontSize: 14 }} />
    </label>
  );

  return (
    <div ref={pageRef} style={{ padding: 20, color: t.text, height: narrow ? 'auto' : 'calc(100vh - 40px)', minHeight: narrow ? '100vh' : undefined, display: 'flex', flexDirection: 'column' }}>
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
        <button onClick={fitView} style={btn(t, t.surface, t.text)}>Fit view</button>
        <button onClick={exportPdf} disabled={busy === 'pdf'} style={btn(t, '#10B981', '#fff')}>{busy === 'pdf' ? 'Exporting…' : 'Export PDF'}</button>
      </div>

      {deriveNotes.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: t.surface, border: '1px solid ' + t.border, borderRadius: 8, fontSize: 12, color: t.textSecondary }}>
          <strong style={{ color: t.text }}>Derived from BOQ</strong> — approximate. {deriveNotes.join(' · ')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '240px minmax(0, 1fr) 300px', gap: 14, flex: narrow ? undefined : 1, minHeight: 0 }}>
        {/* ── Controls ── */}
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, overflowY: 'auto' }}>
          {/* Build modules — House + Extension + Garage… */}
          <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: t.textSecondary, marginBottom: 8 }}>Build modules</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
            {modules.map((mod) => {
              const sub = quote?.modules?.find((x) => x.name === mod.name)?.cost;
              return (
                <div key={mod.id} onClick={() => setActiveId(mod.id)} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, cursor: 'pointer',
                  padding: '7px 9px', borderRadius: 8, fontSize: 13,
                  border: '1px solid ' + (mod.id === activeId ? t.accent : t.border),
                  background: mod.id === activeId ? (t.accent + '22') : t.surface,
                }}>
                  <span style={{ fontWeight: 600, color: t.text }}>{mod.name}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {sub != null && <span style={{ fontSize: 11, color: t.textSecondary }}>{gbp(sub)}</span>}
                    {modules.length > 1 && (
                      <button onClick={(e) => { e.stopPropagation(); deleteModule(mod.id); }} title="Remove module"
                        style={{ border: 'none', background: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
            {MODULE_TYPES.map((mt) => (
              <button key={mt.id} onClick={() => addModule(mt.id)} style={{ ...btn(t, t.surface, t.text), padding: '5px 8px', fontSize: 12 }}>{mt.label}</button>
            ))}
          </div>

          <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: t.textSecondary, marginBottom: 12 }}>{active.name}</div>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>Footprint shape</span>
            <select value={active.shape} onChange={set('shape')} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text }}>
              {SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          {numberField('Length (m)', 'length', { min: 2, max: 60, step: 0.5 })}
          {numberField('Width (m)', 'width', { min: 2, max: 60, step: 0.5 })}
          {active.shape !== 'rect' && (
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>Wing size ({Math.round(active.wing * 100)}%)</span>
              <input type="range" min={0.2} max={0.7} step={0.05} value={active.wing} onChange={set('wing')} style={{ width: '100%' }} />
            </label>
          )}
          {numberField('Wall height (m)', 'wallHeight', { min: 2, max: 6, step: 0.1 })}
          {numberField('Storeys', 'storeys', { min: 1, max: 4 })}
          {numberField('Roof pitch (°)', 'roofPitch', { min: 5, max: 60 })}
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>Roof type</span>
            <select value={active.roofType} onChange={set('roofType')} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text }}>
              {ROOF_TYPES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          {numberField('Windows', 'windows', { min: 0, max: 60 })}
          {numberField('External doors', 'doors', { min: 0, max: 20 })}
          {numberField('Roof windows (Velux)', 'rooflights', { min: 0, max: 20 })}

          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>Wall type</span>
            <select value={active.wallType} onChange={set('wallType')} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text }}>
              {WALL_TYPES.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>Roof covering</span>
            <select value={active.roofCovering} onChange={set('roofCovering')} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text }}>
              {ROOF_COVERINGS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          {active.type !== 'house' && (
            <>
              {numberField('Position X (m)', 'offsetX', { step: 0.5 })}
              {numberField('Position Z (m)', 'offsetZ', { step: 0.5 })}
            </>
          )}

          <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: t.textSecondary, margin: '8px 0 12px' }}>Markup (project)</div>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>OH&P (%)</span>
            <input type="number" value={ohpPct} min={0} max={60} onChange={(e) => setOhpPct(Number(e.target.value))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text, fontSize: 14 }} />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: t.textSecondary, display: 'block', marginBottom: 4 }}>VAT (%)</span>
            <input type="number" value={vatPct} min={0} max={25} onChange={(e) => setVatPct(Number(e.target.value))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid ' + t.border, background: t.surface, color: t.text, fontSize: 14 }} />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: t.text, cursor: 'pointer' }}>
            <input type="checkbox" checked={showDims} onChange={(e) => setShowDims(e.target.checked)} />
            Show dimensions
          </label>
        </div>

        {/* ── 3D viewport ── */}
        <div ref={mountRef} style={{ position: 'relative', background: '#eef2f7', borderRadius: 12, border: '1px solid ' + t.border, overflow: 'hidden', minHeight: 0, minWidth: 0, height: narrow ? 440 : undefined }} />

        {/* ── Estimate / Summary sidebar ── */}
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {['estimate', 'summary'].map((tab) => (
                <button key={tab} onClick={() => setPanelTab(tab)} style={{
                  padding: '4px 10px', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  border: '1px solid ' + (panelTab === tab ? t.accent : t.border),
                  background: panelTab === tab ? t.accent : 'transparent',
                  color: panelTab === tab ? '#fff' : t.textSecondary,
                }}>{tab === 'estimate' ? 'Estimate' : 'Summary'}</button>
              ))}
            </div>
            {loading && <span style={{ fontSize: 11, color: t.textSecondary }}>pricing…</span>}
          </div>

          {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{error}</div>}

          {panelTab === 'estimate' && (
            <>
              {quote?.groups?.map((g) => (
                <div key={g.category} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: t.textSecondary, marginBottom: 6 }}>{g.category}</div>
                  {g.items.map((it) => (
                    <div key={it.code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0', borderBottom: '1px solid ' + t.border }}>
                      <span style={{ flex: 1, paddingRight: 8 }}>
                        {it.label}
                        <span style={{ color: t.textSecondary, display: 'block', fontSize: 11 }}>{it.qty} {it.unit} @ {gbp(it.rate)}</span>
                        {it.live && (
                          <a href={it.live.source_url} target="_blank" rel="noreferrer" style={{ display: 'block', fontSize: 10.5, color: '#0a7d28', textDecoration: 'none', marginTop: 1 }}>
                            ● live {it.live.supplier} £{it.live.price}/{it.live.unit}{it.live.priceable ? '' : ' (benchmark)'}
                          </a>
                        )}
                      </span>
                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{gbp(it.total)}</span>
                    </div>
                  ))}
                </div>
              ))}

              {totals && (
                <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '2px solid ' + t.border }}>
                  <Row t={t} label="Trade cost" value={gbp(totals.cost)} />
                  <Row t={t} label={`OH&P (${ohpPct}%)`} value={gbp(totals.profit)} />
                  <Row t={t} label="Subtotal" value={gbp(totals.subtotal)} bold />
                  <Row t={t} label={`VAT (${vatPct}%)`} value={gbp(totals.vat)} />
                  <Row t={t} label="Total" value={gbp(totals.total)} big />
                  {quote.missing?.length > 0 && (
                    <div style={{ fontSize: 10.5, color: t.textSecondary, marginTop: 8 }}>
                      {quote.missing.length} element(s) had no matching rate and were skipped.
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {panelTab === 'summary' && quote?.measurements?.map((g) => (
            <div key={g.group} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: '#fff', background: t.accent, padding: '4px 8px', borderRadius: 6, marginBottom: 4 }}>{g.group}</div>
              {g.rows.map((r) => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 2px', borderBottom: '1px solid ' + t.border }}>
                  <span style={{ color: t.textSecondary }}>{r.label}</span>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.value} {r.unit}</span>
                </div>
              ))}
            </div>
          ))}
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
