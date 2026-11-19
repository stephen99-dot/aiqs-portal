import React, { useState } from 'react';
import { resolveUrl } from '../../utils/api';

// ═══ Before / after ══════════════════════════════════════════════════════════
// The survey photo and the finished-room render on top of each other with a
// divider to drag: left of it the room as it is, right of it the room done.
// A plain range input drives it, so it works with a thumb, a mouse and the
// keyboard, and needs no library.

export default function BeforeAfter({ before, after, height = 260 }) {
  const [pos, setPos] = useState(55);
  if (!before || !after) return null;
  return (
    <div className="ba" style={{ height }}>
      <img className="ba__img" src={resolveUrl(before.url)} alt={before.caption || 'The room now'} draggable={false} />
      <div className="ba__after" style={{ width: pos + '%' }}>
        <img className="ba__img ba__img--after" src={resolveUrl(after.url)} alt={after.caption || 'The finished room'} draggable={false} style={{ width: (100 / Math.max(pos, 0.01)) * 100 + '%' }} />
      </div>
      <div className="ba__line" style={{ left: pos + '%' }} aria-hidden="true"><span className="ba__knob">⇔</span></div>
      <span className="ba__tag ba__tag--after">After</span>
      <span className="ba__tag ba__tag--before">Before</span>
      <input className="ba__range" type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Slide between the room now and the finished room" />
    </div>
  );
}
