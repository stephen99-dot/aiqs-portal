import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, IconButton } from '../../ui';
import { setWatched, videoUrl, packageLabel } from '../../utils/learn';
import { CheckIcon, ArrowRightIcon } from '../Icons';

// ═══ The player: one video, tick it off, on to the next ═════════════════════
// Finishing a video ticks it off by itself; the tick can be undone. "Try it
// now" goes to the page the video is about.

export default function VideoModal({ video, videos = [], onClose }) {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(video);
  const [done, setDone] = useState(!!(video && video.watched_at));
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  useEffect(() => { setCurrent(video); setDone(!!(video && video.watched_at)); }, [video]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  if (!current) return null;
  const mark = async (w) => {
    setDone(w); setSaving(true);
    try { await setWatched(current.key, w); } catch (e) { setDone(!w); }
    finally { setSaving(false); }
  };
  const idx = videos.findIndex((v) => v.key === current.key);
  const next = (idx >= 0 ? videos.slice(idx + 1).find((v) => !v.watched_at) : null) || (idx >= 0 ? videos[idx + 1] : null) || null;
  const pkg = packageLabel(current);

  return (
    <div className="ui-modal-overlay learn-overlay" onClick={onClose}>
      <div className="learn-player" role="dialog" aria-modal="true" aria-label={current.title} onClick={(e) => e.stopPropagation()}>
        <div className="learn-player__frame">
          <video key={current.key} ref={ref} className="learn-player__video" src={videoUrl(current.src)} poster={videoUrl(current.poster)} controls autoPlay playsInline preload="metadata" onEnded={() => { if (!done) mark(true); }} />
        </div>
        <div className="learn-player__body">
          <div className="learn-player__head">
            <div style={{ minWidth: 0 }}>
              <div className="learn-player__kicker">{pkg ? pkg + ' · ' : ''}{current.seconds ? '~' + current.seconds + ' s' : 'How-to'}</div>
              <h2 className="learn-player__title">{current.title}</h2>
              <p className="learn-player__blurb">{current.blurb}</p>
            </div>
            <IconButton onClick={onClose} aria-label="Close">✕</IconButton>
          </div>
          <div className="learn-player__actions">
            <button type="button" className={'learn-tick' + (done ? ' learn-tick--on' : '')} onClick={() => mark(!done)} disabled={saving} aria-pressed={done}><span className="learn-tick__box"><CheckIcon size={12} color="currentColor" /></span>{done ? 'Watched' : 'Mark as watched'}</button>
            <span className="learn-player__spacer" />
            {current.page && <Button variant="secondary" onClick={() => { onClose(); navigate(current.page); }}>Try it now <ArrowRightIcon size={14} color="currentColor" /></Button>}
            {next && <Button onClick={() => { setCurrent(next); setDone(!!next.watched_at); }}>Next: {next.title} <ArrowRightIcon size={14} color="currentColor" /></Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
