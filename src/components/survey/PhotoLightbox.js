import React, { useEffect, useState } from 'react';
import { resolveUrl } from '../../utils/api';
import { XIcon, ChevronRightIcon, ArrowLeftIcon, TrashIcon, CheckIcon } from '../Icons';

const KINDS = [['corner', 'Corner'], ['wall', 'Wall'], ['floor', 'Floor'], ['ceiling', 'Ceiling'], ['detail', 'Detail'], ['general', 'General']];

// ═══ Full-screen photo viewer with the caption, the kind and what the AI saw ═
export default function PhotoLightbox({ photos, index, onClose, onChange, onSave, onDelete, readOnly }) {
  const photo = photos[index];
  const [caption, setCaption] = useState(photo ? photo.caption || '' : '');
  const [kind, setKind] = useState(photo ? photo.kind || 'general' : 'general');
  useEffect(() => { if (photo) { setCaption(photo.caption || ''); setKind(photo.kind || 'general'); } }, [photo]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight') onChange(index + 1); else if (e.key === 'ArrowLeft') onChange(index - 1); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [index, onChange, onClose]);
  if (!photo) return null;
  const dirty = caption !== (photo.caption || '') || kind !== (photo.kind || 'general');
  return (
    <div className="lb" role="dialog" aria-label="Photo" onClick={onClose}>
      <div className="lb__top" onClick={(e) => e.stopPropagation()}>
        <span className="lb__count">{index + 1} / {photos.length}</span>
        <button type="button" className="lb__btn" onClick={onClose} aria-label="Close"><XIcon size={20} /></button>
      </div>
      <button type="button" className="lb__nav lb__nav--prev" disabled={index <= 0} onClick={(e) => { e.stopPropagation(); onChange(index - 1); }} aria-label="Previous"><ArrowLeftIcon size={22} /></button>
      <img className="lb__img" src={resolveUrl(photo.url)} alt={photo.caption || 'Room photo'} onClick={(e) => e.stopPropagation()} />
      <button type="button" className="lb__nav lb__nav--next" disabled={index >= photos.length - 1} onClick={(e) => { e.stopPropagation(); onChange(index + 1); }} aria-label="Next"><ChevronRightIcon size={22} /></button>
      <div className="lb__foot" onClick={(e) => e.stopPropagation()}>
        {photo.ai_notes && <div className="lb__ai">AI saw: {photo.ai_notes}</div>}
        {!readOnly && (
          <div className="lb__edit">
            <select className="lb__select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="What the photo shows">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <input className="lb__caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption — e.g. north wall, by the window" />
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" disabled={!dirty} onClick={() => onSave(photo, { caption, kind })}><CheckIcon size={13} /> Save</button>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm lb__del" onClick={() => onDelete(photo)}><TrashIcon size={13} /> Delete</button>
          </div>
        )}
      </div>
    </div>
  );
}
