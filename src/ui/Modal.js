import React, { useEffect } from 'react';
import { IconButton } from './Button';

// Modal dialog — centred on desktop, bottom sheet on phones (see ui.css).
// Escape and clicking the backdrop close it.
//
//   {open && (
//     <Modal title="Rename project" onClose={…}
//       footer={<><Button variant="secondary" onClick={…}>Cancel</Button>
//               <Button onClick={save}>Save</Button></>}>
//       …body…
//     </Modal>
//   )}
export default function Modal({ title, onClose, footer, maxWidth = 520, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="ui-modal-overlay" onClick={onClose}>
      <div
        className="ui-modal" style={{ maxWidth }}
        role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        onClick={e => e.stopPropagation()}
      >
        {(title || onClose) && (
          <div className="ui-modal__header">
            <h2 className="ui-modal__title">{title}</h2>
            {onClose && <IconButton onClick={onClose} aria-label="Close">✕</IconButton>}
          </div>
        )}
        <div className="ui-modal__body">{children}</div>
        {footer && <div className="ui-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
