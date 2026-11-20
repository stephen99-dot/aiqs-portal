import React, { useState, useRef, useEffect, useCallback } from 'react';
import { resolveUrl } from '../../utils/api';

// ═══ Before / after ══════════════════════════════════════════════════════════
// The survey photo and the finished-room render on top of each other with a
// divider to drag: left of it the room done, right of it the room as it is.
//
// The frame takes the render's own proportions, and both pictures are
// centre-cropped into it. The server sent the image service that same centre
// crop of the photo, so the two line up; a fixed-height frame cropped them
// differently and the "after" slid about against the "before".
//
// The divider follows a finger or a mouse anywhere on the picture (pointer
// events, with the page still free to scroll up and down), and the handle is
// a slider for the keyboard. The old invisible range input only moved on an
// iPhone when the thumb itself was touched.

export default function BeforeAfter({ before, after, maxHeight = 420 }) {
  const [pos, setPos] = useState(55);
  const [ratio, setRatio] = useState(after && after.width && after.height ? after.width / after.height : 4 / 3);
  const box = useRef(null);
  const dragging = useRef(false);

  const setFromX = useCallback((clientX) => {
    const el = box.current; if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  }, []);

  // Moves and the release are watched on the window: an iPhone drops pointer
  // capture when the finger leaves the element, a mouse leaves it all the time.
  useEffect(() => {
    const move = (e) => { if (dragging.current) { setFromX(e.clientX); } };
    const up = () => { dragging.current = false; };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [setFromX]);

  if (!before || !after) return null;
  const down = (e) => { if (e.button != null && e.button !== 0) return; dragging.current = true; setFromX(e.clientX); };
  const key = (e) => {
    const step = e.shiftKey ? 10 : 4;
    if (e.key === 'ArrowLeft') { setPos((p) => Math.max(0, p - step)); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setPos((p) => Math.min(100, p + step)); e.preventDefault(); }
    if (e.key === 'Home') { setPos(0); e.preventDefault(); }
    if (e.key === 'End') { setPos(100); e.preventDefault(); }
  };
  return (
    <div ref={box} className="ba" style={{ aspectRatio: String(ratio), maxWidth: Math.round(maxHeight * ratio) + 'px' }} onPointerDown={down}>
      <img className="ba__img" src={resolveUrl(before.url)} alt={before.caption || 'The room now'} draggable={false} />
      <img className="ba__img ba__img--after" src={resolveUrl(after.url)} alt={after.caption || 'The finished room'} draggable={false} style={{ clipPath: 'inset(0 ' + (100 - pos) + '% 0 0)' }}
        onLoad={(e) => { const im = e.currentTarget; if (im.naturalWidth && im.naturalHeight && !(after.width && after.height)) setRatio(im.naturalWidth / im.naturalHeight); }} />
      <div className="ba__line" style={{ left: pos + '%' }} aria-hidden="true" />
      <button type="button" className="ba__handle" style={{ left: pos + '%' }} role="slider" aria-label="Slide between the finished room and the room now" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)} onKeyDown={key}>
        <span className="ba__knob">⇔</span>
      </button>
      <span className="ba__tag ba__tag--after">After</span>
      <span className="ba__tag ba__tag--before">Before</span>
    </div>
  );
}
