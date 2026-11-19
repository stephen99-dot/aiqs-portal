import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { sceneOf } from '../../utils/surveyGeometry';

// ═══ The surveyed room in 3D ═════════════════════════════════════════════════
// Built from the same scene as the plan sketch: the floor outline, each wall
// a thin box standing on its line (so a scanned room keeps its bays and
// chimney breasts), the openings cut in as door and window panels, and the
// furniture the scanner saw as pale blocks. Drag to orbit, pinch or scroll
// to zoom; it turns slowly on its own until touched. To scale, not a render:
// a thing to turn the phone round and show a customer.

const WALL = 0xEFEAE4; const FLOOR = 0xC8A87C; const DOOR = 0x8B5E3C; const GLASS = 0x7FB2E5; const LINE = 0x5A6577; const STUFF = 0xD9D4CC;

export default function Room3D({ room, height = 320 }) {
  const mountRef = useRef(null);
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;
    const sc = sceneOf(room);
    const H = (sc && sc.height_m) || 2.4;
    const scene = new THREE.Scene();
    scene.background = null;
    const w = el.clientWidth || 320;
    const camera = new THREE.PerspectiveCamera(45, w / height, 0.1, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, height);
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(6, 10, 4); sun.castShadow = true; scene.add(sun);

    const group = new THREE.Group();
    scene.add(group);
    if (sc) {
      const L = sc.bounds.w; const W = sc.bounds.h;
      // Plan (x right, y down) → world (x right, z towards the viewer), centred.
      const X = (p) => p.x - L / 2; const Z = (p) => -(p.y - W / 2);
      if (sc.floor && sc.floor.length >= 3) {
        // A Shape in the XY plane turned down by 90° lands with world z = −shape y,
        // so the shape takes −Z to come out under the walls, not mirrored.
        const shape = new THREE.Shape(sc.floor.map((p) => new THREE.Vector2(X(p), -Z(p))));
        const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.9, side: THREE.DoubleSide }));
        floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);
      }
      const t = 0.08;
      for (const seg of sc.segments) {
        const a = seg.a; const b = seg.b;
        const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
        // A box along +x turned by θ about the vertical points to (cos θ, 0, −sin θ);
        // the wall runs (dx, 0, −dy) in world, so θ = atan2(dy, dx).
        const ang = Math.atan2(dy, dx);
        const wallH = seg.height_m || H;
        const ops = (seg.openings || []).slice().sort((x, y) => x.from - y.from);
        // Wall runs between openings, full height; above and below the openings, part height.
        const box = (f, to, y0, y1) => {
          const sl = (to - f) * len; if (sl <= 0.001 || y1 - y0 <= 0.001) return;
          const m = new THREE.Mesh(new THREE.BoxGeometry(sl, y1 - y0, t), new THREE.MeshStandardMaterial({ color: WALL, roughness: 0.95 }));
          const cf = (f + to) / 2;
          m.position.set(X({ x: a.x + dx * cf }), (y0 + y1) / 2, Z({ y: a.y + dy * cf }));
          m.rotation.y = ang; m.castShadow = true; m.receiveShadow = true; group.add(m);
        };
        let cur = 0;
        for (const o of ops) {
          if (o.from > cur) box(cur, o.from, 0, wallH);
          const oh = Math.min(o.height_m || 2, wallH - 0.05);
          const sill = o.kind === 'window' ? Math.max(0.3, Math.min(wallH - oh - 0.1, (wallH - oh) * 0.55)) : 0;
          if (sill > 0) box(o.from, o.to, 0, sill);
          if (sill + oh < wallH) box(o.from, o.to, sill + oh, wallH);
          const panel = new THREE.Mesh(new THREE.BoxGeometry((o.to - o.from) * len * 0.96, oh * 0.96, t * 0.5), new THREE.MeshStandardMaterial({ color: o.kind === 'window' ? GLASS : o.kind === 'door' ? DOOR : 0x000000, transparent: o.kind !== 'door', opacity: o.kind === 'window' ? 0.55 : o.kind === 'opening' ? 0.08 : 1, roughness: 0.4 }));
          const cf = (o.from + o.to) / 2;
          panel.position.set(X({ x: a.x + dx * cf }), sill + oh / 2, Z({ y: a.y + dy * cf }));
          panel.rotation.y = ang; group.add(panel);
          cur = Math.max(cur, o.to);
        }
        if (cur < 1) box(cur, 1, 0, wallH);
      }
      // Furniture the scanner saw: pale blocks on their footprints.
      for (const o of sc.objects || []) {
        if (!o.corners || o.corners.length < 3) continue;
        const shape = new THREE.Shape(o.corners.map((p) => new THREE.Vector2(X(p), -Z(p))));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.min(o.height_m || 0.75, H - 0.2), bevelEnabled: false });
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: STUFF, roughness: 0.9, transparent: true, opacity: 0.85 }));
        m.rotation.x = -Math.PI / 2; m.castShadow = true; m.receiveShadow = true; group.add(m);
      }
      // Top edge of the outline so the walls read at a glance.
      if (sc.floor && sc.floor.length >= 3) {
        const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(sc.floor.map((p) => new THREE.Vector3(X(p), H, Z(p)))), new THREE.LineBasicMaterial({ color: LINE }));
        group.add(edge);
      }
      const r = Math.max(L, W, H) * 1.35;
      camera.position.set(r * 0.9, r * 0.8, r * 0.9);
    } else {
      camera.position.set(4, 3, 4);
    }
    camera.lookAt(0, H / 2, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, H / 2, 0); controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.8; controls.maxPolarAngle = Math.PI / 2.05;
    controls.addEventListener('start', () => { controls.autoRotate = false; });
    let raf = 0; let alive = true;
    const loop = () => { if (!alive) return; controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    loop();
    const ro = new ResizeObserver(() => { const nw = el.clientWidth || 320; camera.aspect = nw / height; camera.updateProjectionMatrix(); renderer.setSize(nw, height); });
    ro.observe(el);
    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [room, height]);
  return <div ref={mountRef} className="r3d" style={{ height }} aria-label="3D view of the room" />;
}
