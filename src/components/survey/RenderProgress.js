import React, { useEffect, useRef, useState } from 'react';
import { resolveUrl } from '../../utils/api';
import { SparklesIcon } from '../Icons';

// ═══ Watching the finished room appear ═══════════════════════════════════════
// Full-screen while a render runs. The survey photo sits in the frame,
// blurred, with a light sweeping across it and a percentage climbing; as the
// image service sends its rough passes the picture underneath becomes the
// render and sharpens, and at 100% it snaps into focus before the overlay
// goes. The number eases towards the server's estimate, so it never jumps or
// sits still.
//
//   state: { before: url, preview: dataUrl|null, target: 0–100, note, done }

export default function RenderProgress({ state }) {
  const [shown, setShown] = useState(0);
  const raf = useRef(0);
  const target = state ? (state.done ? 100 : Math.min(97, state.target || 0)) : 0;
  useEffect(() => {
    let alive = true;
    const step = () => {
      if (!alive) return;
      setShown((s) => {
        const gap = target - s;
        if (Math.abs(gap) < 0.15) return target;
        return s + gap * (target >= 100 ? 0.25 : 0.06);
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { alive = false; cancelAnimationFrame(raf.current); };
  }, [target]);
  if (!state) return null;
  const pct = Math.round(shown);
  const blur = state.done ? 0 : Math.max(0, (100 - shown) / 100 * 18);
  const src = state.preview || resolveUrl(state.before);
  return (
    <div className="sr-gen" role="status" aria-live="polite" aria-label={'Painting the finished room, ' + pct + '%'}>
      <div className="sr-gen__card">
        <div className={'sr-gen__frame' + (state.done ? ' sr-gen__frame--done' : '')}>
          <img className="sr-gen__img" src={src} alt="" style={{ filter: 'blur(' + blur.toFixed(1) + 'px) saturate(' + (1 + (100 - shown) / 100 * 0.25).toFixed(2) + ')' }} />
          {!state.done && <div className="sr-gen__sweep" aria-hidden="true" />}
          {!state.done && <div className="sr-gen__grain" aria-hidden="true" />}
          <div className="sr-gen__pct"><span className="sr-gen__num">{pct}</span><span className="sr-gen__unit">%</span></div>
          <div className="sr-gen__bar" aria-hidden="true"><i style={{ width: shown + '%' }} /></div>
        </div>
        <div className="sr-gen__title"><SparklesIcon size={15} /> {state.done ? 'Finished' : 'Painting the finished room'}</div>
        <div className="sr-gen__note">{state.done ? 'Slide to compare it with the room as it is.' : (state.note || 'Reading the photo…')}</div>
      </div>
    </div>
  );
}
