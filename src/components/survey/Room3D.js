import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { outlineOf, layoutOpenings, wallsOf, num, DEFAULT_HEIGHT } from '../../utils/surveyGeometry';

// ═══ The surveyed room in 3D ═════════════════════════════════════════════════
// Built from the same numbers as the plan sketch: the floor outline extruded
// to the ceiling height, each wall a thin box, the openings cut in as door and
// window panels at their place on the wall. Drag to orbit, pinch or scroll to
// zoom; it turns slowly on its own until touched. To scale, not a render — a
// thing to turn the phone round and show a customer.

const WALL = 0xEFEAE4; const FLOOR = 0xC8A87C; const DOOR = 0x8B5E3C; const GLASS = 0x7FB2E5; const LINE = 0x5A6577;

export default function Room3D({ room, height = 320 }) {
  const mountRef = useRef(null);
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return undefined;
    const outline = outlineOf(room);
    const H = num(room.height_m) || DEFAULT_HEIGHT;
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
    if (outline) {
      const L = outline.bounds.w; const W = outline.bounds.h;
      // Floor as the outline polygon (y up; plan y → -z so it reads the same way round as the sketch).
      const shape = new THREE.Shape(outline.points.map((p) => new THREE.Vector2(p.x - L / 2, -(p.y - W / 2))));
      const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.9 }));
      floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; group.add(floor);
      const walls = wallsOf(room);
      const layout = layoutOpenings(room);
      const pts = outline.points;
      const t = 0.08;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]; const b = pts[(i + 1) % pts.length];
        const label = walls[i] ? walls[i].label : null;
        const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
        const ang = Math.atan2(-dy, dx);
        const ops = layout.filter((o) => o.wall === label).sort((x, y) => x.from - y.from);
        // Wall segments between openings, full height; above/below the openings, part height.
        const seg = (f, to, y0, y1) => {
          const sl = (to - f) * len; if (sl <= 0.001 || y1 - y0 <= 0.001) return;
          const m = new THREE.Mesh(new THREE.BoxGeometry(sl, y1 - y0, t), new THREE.MeshStandardMaterial({ color: WALL, roughness: 0.95 }));
          const cf = (f + to) / 2;
          m.position.set(a.x + dx * cf - L / 2, (y0 + y1) / 2, -(a.y + dy * cf - W / 2));
          m.rotation.y = ang; m.castShadow = true; m.receiveShadow = true; group.add(m);
        };
        let cur = 0;
        for (const o of ops) {
          if (o.from > cur) seg(cur, o.from, 0, H);
          const oh = Math.min(o.opening.height_m, H - 0.05);
          const sill = o.opening.kind === 'window' ? Math.max(0.3, Math.min(H - oh - 0.1, (H - oh) * 0.55)) : 0;
          if (sill > 0) seg(o.from, o.to, 0, sill);
          if (sill + oh < H) seg(o.from, o.to, sill + oh, H);
          const panel = new THREE.Mesh(new THREE.BoxGeometry((o.to - o.from) * len * 0.96, oh * 0.96, t * 0.5), new THREE.MeshStandardMaterial({ color: o.opening.kind === 'window' ? GLASS : o.opening.kind === 'door' ? DOOR : 0x000000, transparent: o.opening.kind !== 'door', opacity: o.opening.kind === 'window' ? 0.55 : o.opening.kind === 'opening' ? 0.08 : 1, roughness: 0.4 }));
          const cf = (o.from + o.to) / 2;
          panel.position.set(a.x + dx * cf - L / 2, sill + oh / 2, -(a.y + dy * cf - W / 2));
          panel.rotation.y = ang; group.add(panel);
          cur = Math.max(cur, o.to);
        }
        if (cur < 1) seg(cur, 1, 0, H);
      }
      // Top edge outline so the walls read at a glance.
      const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x - L / 2, H, -(p.y - W / 2)))), new THREE.LineBasicMaterial({ color: LINE }));
      group.add(edge);
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
