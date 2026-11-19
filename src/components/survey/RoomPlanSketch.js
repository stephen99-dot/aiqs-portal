import React from 'react';
import { sceneOf, quantities } from '../../utils/surveyGeometry';

// ═══ The room in plan, drawn live from its dimensions ═══════════════════════
// Floor tinted, walls as thick lines with the openings left out, doors as
// swings, windows as glazing lines, the wall letters outside, the overall
// sizes and the floor area. A scanned room is drawn from its scan: every wall
// where the scanner put it, the doors and windows on them, and the furniture
// as light outlines. Pure SVG from the theme tokens, so it is right in both
// modes and at any size. `onWallClick(label)` makes the letters tappable
// (assigning an opening to a wall).

export default function RoomPlanSketch({ room, width = 320, height = 240, mini = false, selectedWall, onWallClick, style }) {
  const scene = sceneOf(room);
  const q = quantities(room);
  if (!scene) {
    return (
      <div className="sk-empty" style={{ width, height, ...style }}>
        {room.shape === 'custom' && q.complete
          ? <><strong>{q.wall_count} walls measured</strong><span>{q.perimeter_m} m perimeter · {q.floor_m2} m²</span></>
          : <><strong>No size yet</strong><span>Type the length and width, or run the AI survey</span></>}
      </div>
    );
  }
  const pad = mini ? 10 : 40;
  const scale = Math.min((width - pad * 2) / Math.max(scene.bounds.w, 0.1), (height - pad * 2) / Math.max(scene.bounds.h, 0.1));
  const ox = (width - scene.bounds.w * scale) / 2;
  const oy = (height - scene.bounds.h * scale) / 2;
  const P = (p) => ({ x: ox + p.x * scale, y: oy + p.y * scale });
  const centre = P(scene.centroid);
  const wallStroke = mini ? 3 : 5;
  const els = [];
  // Furniture first, under the walls.
  (scene.objects || []).forEach((o, i) => {
    const c = (o.corners || []).map(P);
    if (c.length < 3) return;
    const d = c.map((p, k) => (k ? 'L' : 'M') + p.x + ' ' + p.y).join(' ') + ' Z';
    const wOn = o.width_m * scale;
    const cc = P(o.centre);
    els.push(<g key={'ob' + i}><path d={d} fill="var(--bg-card)" stroke="var(--border)" strokeWidth={0.8} />{!mini && wOn > 34 && <text x={cc.x} y={cc.y + 3} textAnchor="middle" fontSize={7} fill="var(--text-muted)">{o.category}</text>}</g>);
  });
  scene.segments.forEach((seg, i) => {
    const a = P(seg.a); const b = P(seg.b);
    const ops = (seg.openings || []).slice().sort((x, y) => x.from - y.from);
    const runs = []; let cur = 0;
    for (const o of ops) { if (o.from > cur) runs.push([cur, o.from]); cur = Math.max(cur, o.to); }
    if (cur < 1) runs.push([cur, 1]);
    const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
    // The normal that points into the room — towards the centroid, whichever
    // way round the wall was listed.
    let nx = -dy / len; let ny = dx / len;
    const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
    if ((centre.x - mx) * nx + (centre.y - my) * ny < 0) { nx = -nx; ny = -ny; }
    runs.forEach(([f, t], ri) => {
      els.push(<line key={'w' + i + '-' + ri} x1={a.x + dx * f} y1={a.y + dy * f} x2={a.x + dx * t} y2={a.y + dy * t} stroke="var(--text-primary)" strokeWidth={wallStroke} strokeLinecap="butt" />);
    });
    ops.forEach((o, oi) => {
      const s = { x: a.x + dx * o.from, y: a.y + dy * o.from }; const e = { x: a.x + dx * o.to, y: a.y + dy * o.to };
      const span = Math.hypot(e.x - s.x, e.y - s.y);
      const k = 'o' + i + '-' + oi;
      if (o.kind === 'window') {
        els.push(<g key={k}><line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke="var(--info)" strokeWidth={mini ? 2 : 2.5} /><line x1={s.x + nx * 2.5} y1={s.y + ny * 2.5} x2={e.x + nx * 2.5} y2={e.y + ny * 2.5} stroke="var(--text-primary)" strokeWidth={0.8} /><line x1={s.x - nx * 2.5} y1={s.y - ny * 2.5} x2={e.x - nx * 2.5} y2={e.y - ny * 2.5} stroke="var(--text-primary)" strokeWidth={0.8} /></g>);
      } else if (o.kind === 'door') {
        const ex = s.x + nx * span; const ey = s.y + ny * span;
        const sweep = nx * (e.x - s.x) + ny * (e.y - s.y) >= 0 ? 1 : 0;
        const d = `M ${ex} ${ey} A ${span} ${span} 0 0 ${(dx * ny - dy * nx) > 0 ? 1 - sweep : sweep} ${e.x} ${e.y}`;
        els.push(<g key={k}><line x1={s.x} y1={s.y} x2={ex} y2={ey} stroke="var(--text-primary)" strokeWidth={mini ? 1 : 1.4} /><path d={d} fill="none" stroke="var(--text-muted)" strokeWidth={0.8} strokeDasharray="3 3" /></g>);
      } else {
        els.push(<g key={k}><line x1={s.x + nx * 3} y1={s.y + ny * 3} x2={s.x - nx * 3} y2={s.y - ny * 3} stroke="var(--text-primary)" strokeWidth={0.8} /><line x1={e.x + nx * 3} y1={e.y + ny * 3} x2={e.x - nx * 3} y2={e.y - ny * 3} stroke="var(--text-primary)" strokeWidth={0.8} /></g>);
      }
    });
    // Wall letter just outside the wall; stubs too short to label are skipped.
    if (!mini && seg.label && len > 16) {
      const lx = mx - nx * 14; const ly = my - ny * 14;
      const active = selectedWall === seg.label;
      els.push(
        <g key={'l' + i} className={'sk-wall' + (onWallClick ? ' sk-wall--click' : '') + (active ? ' sk-wall--active' : '')} onClick={onWallClick ? () => onWallClick(seg.label) : undefined} role={onWallClick ? 'button' : undefined} aria-label={onWallClick ? 'Wall ' + seg.label : undefined}>
          <circle cx={lx} cy={ly} r={9} fill={active ? 'var(--accent)' : 'var(--bg-card)'} stroke={active ? 'var(--accent)' : 'var(--border-light)'} strokeWidth={1} />
          <text x={lx} y={ly + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill={active ? 'var(--accent-text)' : 'var(--text-muted)'} fontFamily="var(--font-mono)">{seg.label}</text>
        </g>
      );
    }
  });
  const floorPts = (scene.floor || []).map(P);
  const floorPath = floorPts.length >= 3 ? floorPts.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join(' ') + ' Z' : null;
  const cx = ox + scene.bounds.w * scale / 2;
  const area = scene.kind === 'plan' ? (q.floor_m2 || scene.floor_m2) : q.floor_m2;
  return (
    <svg className="sk" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={style} role="img" aria-label={'Plan of ' + (room.name || 'the room')}>
      {floorPath && <path d={floorPath} fill="var(--accent-glow)" stroke="none" />}
      {els}
      {!mini && (
        <>
          <text x={cx} y={oy - 29} textAnchor="middle" fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-mono)">{scene.length_m.toFixed(2)} m</text>
          <text x={ox - 30} y={oy + scene.bounds.h * scale / 2} textAnchor="middle" fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-mono)" transform={`rotate(-90 ${ox - 30} ${oy + scene.bounds.h * scale / 2})`}>{scene.width_m.toFixed(2)} m</text>
        </>
      )}
      <text x={centre.x} y={centre.y + (mini ? 4 : 5)} textAnchor="middle" fontSize={mini ? 11 : 14} fontWeight={800} fill="var(--text-primary)" fontFamily="var(--font-mono)">{area} m²</text>
      {!mini && (q.doors + q.windows > 0 || scene.kind === 'plan') && <text x={centre.x} y={centre.y + 20} textAnchor="middle" fontSize={9} fill="var(--text-muted)">{scene.kind === 'plan' ? 'LiDAR · ' + scene.segments.length + ' walls · ' : ''}{q.doors} door{q.doors === 1 ? '' : 's'} · {q.windows} window{q.windows === 1 ? '' : 's'}</text>}
    </svg>
  );
}
