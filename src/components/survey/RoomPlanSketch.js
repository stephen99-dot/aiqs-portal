import React from 'react';
import { outlineOf, layoutOpenings, wallsOf, quantities, num } from '../../utils/surveyGeometry';

// ═══ The room in plan, drawn live from its dimensions ═══════════════════════
// Floor tinted, walls as thick lines with the openings left out, doors as
// swings, windows as glazing lines, the wall letters outside, the overall
// sizes and the floor area. Pure SVG from the theme tokens, so it is right in
// both modes and at any size. `onWallClick(label)` makes the letters tappable
// (assigning an opening to a wall).

export default function RoomPlanSketch({ room, width = 320, height = 240, mini = false, selectedWall, onWallClick, style }) {
  const outline = outlineOf(room);
  const q = quantities(room);
  if (!outline) {
    return (
      <div className="sk-empty" style={{ width, height, ...style }}>
        {room.shape === 'custom' && q.complete
          ? <><strong>{q.wall_count} walls measured</strong><span>{q.perimeter_m} m perimeter · {q.floor_m2} m²</span></>
          : <><strong>No size yet</strong><span>Type the length and width, or run the AI survey</span></>}
      </div>
    );
  }
  const pad = mini ? 10 : 40;
  const scale = Math.min((width - pad * 2) / outline.bounds.w, (height - pad * 2) / outline.bounds.h);
  const ox = (width - outline.bounds.w * scale) / 2;
  const oy = (height - outline.bounds.h * scale) / 2;
  const P = (p) => ({ x: ox + p.x * scale, y: oy + p.y * scale });
  const pts = outline.points.map(P);
  const walls = wallsOf(room);
  const layout = layoutOpenings(room);
  const wallStroke = mini ? 3 : 5;
  const els = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    const label = walls[i] ? walls[i].label : null;
    const ops = layout.filter((l) => l.wall === label).sort((x, y) => x.from - y.from);
    const runs = []; let cur = 0;
    for (const o of ops) { if (o.from > cur) runs.push([cur, o.from]); cur = Math.max(cur, o.to); }
    if (cur < 1) runs.push([cur, 1]);
    const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len; const ny = dx / len;
    runs.forEach(([f, t], ri) => {
      els.push(<line key={'w' + i + '-' + ri} x1={a.x + dx * f} y1={a.y + dy * f} x2={a.x + dx * t} y2={a.y + dy * t} stroke="var(--text-primary)" strokeWidth={wallStroke} strokeLinecap="butt" />);
    });
    ops.forEach((o, oi) => {
      const s = { x: a.x + dx * o.from, y: a.y + dy * o.from }; const e = { x: a.x + dx * o.to, y: a.y + dy * o.to };
      const span = Math.hypot(e.x - s.x, e.y - s.y);
      const k = 'o' + i + '-' + oi;
      if (o.opening.kind === 'window') {
        els.push(<g key={k}><line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke="var(--info)" strokeWidth={mini ? 2 : 2.5} /><line x1={s.x + nx * 2.5} y1={s.y + ny * 2.5} x2={e.x + nx * 2.5} y2={e.y + ny * 2.5} stroke="var(--text-primary)" strokeWidth={0.8} /><line x1={s.x - nx * 2.5} y1={s.y - ny * 2.5} x2={e.x - nx * 2.5} y2={e.y - ny * 2.5} stroke="var(--text-primary)" strokeWidth={0.8} /></g>);
      } else if (o.opening.kind === 'door') {
        const ex = s.x + nx * span; const ey = s.y + ny * span;
        const d = `M ${ex} ${ey} A ${span} ${span} 0 0 ${nx * (e.x - s.x) + ny * (e.y - s.y) >= 0 ? 1 : 0} ${e.x} ${e.y}`;
        els.push(<g key={k}><line x1={s.x} y1={s.y} x2={ex} y2={ey} stroke="var(--text-primary)" strokeWidth={mini ? 1 : 1.4} /><path d={d} fill="none" stroke="var(--text-muted)" strokeWidth={0.8} strokeDasharray="3 3" /></g>);
      } else {
        els.push(<g key={k}><line x1={s.x + nx * 3} y1={s.y + ny * 3} x2={s.x - nx * 3} y2={s.y - ny * 3} stroke="var(--text-primary)" strokeWidth={0.8} /><line x1={e.x + nx * 3} y1={e.y + ny * 3} x2={e.x - nx * 3} y2={e.y - ny * 3} stroke="var(--text-primary)" strokeWidth={0.8} /></g>);
      }
    });
    if (!mini && label) {
      const mx = (a.x + b.x) / 2 - nx * 14; const my = (a.y + b.y) / 2 - ny * 14;
      const active = selectedWall === label;
      els.push(
        <g key={'l' + i} className={'sk-wall' + (onWallClick ? ' sk-wall--click' : '') + (active ? ' sk-wall--active' : '')} onClick={onWallClick ? () => onWallClick(label) : undefined} role={onWallClick ? 'button' : undefined} aria-label={onWallClick ? 'Wall ' + label : undefined}>
          <circle cx={mx} cy={my} r={9} fill={active ? 'var(--accent)' : 'var(--bg-card)'} stroke={active ? 'var(--accent)' : 'var(--border-light)'} strokeWidth={1} />
          <text x={mx} y={my + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill={active ? 'var(--accent-text)' : 'var(--text-muted)'} fontFamily="var(--font-mono)">{label}</text>
        </g>
      );
    }
  }
  const floorPath = pts.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + p.y).join(' ') + ' Z';
  const cx = ox + outline.bounds.w * scale / 2; const cy = oy + outline.bounds.h * scale / 2;
  return (
    <svg className="sk" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={style} role="img" aria-label={'Plan of ' + (room.name || 'the room')}>
      <path d={floorPath} fill="var(--accent-glow)" stroke="none" />
      {els}
      {!mini && (
        <>
          <text x={cx} y={oy - 29} textAnchor="middle" fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-mono)">{num(room.length_m).toFixed(2)} m</text>
          <text x={ox - 30} y={cy} textAnchor="middle" fontSize={10} fill="var(--text-muted)" fontFamily="var(--font-mono)" transform={`rotate(-90 ${ox - 30} ${cy})`}>{num(room.width_m).toFixed(2)} m</text>
        </>
      )}
      <text x={cx} y={cy + (mini ? 4 : 5)} textAnchor="middle" fontSize={mini ? 11 : 14} fontWeight={800} fill="var(--text-primary)" fontFamily="var(--font-mono)">{q.floor_m2} m²</text>
      {!mini && q.doors + q.windows > 0 && <text x={cx} y={cy + 20} textAnchor="middle" fontSize={9} fill="var(--text-muted)">{q.doors} door{q.doors === 1 ? '' : 's'} · {q.windows} window{q.windows === 1 ? '' : 's'}</text>}
    </svg>
  );
}
