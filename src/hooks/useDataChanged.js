import { useEffect, useRef } from 'react';

// ═══ useDataChanged — re-load a page when MAX (or anything else) changes
// data behind its back ══════════════════════════════════════════════════════
// The MAX panel dispatches `aiqs:data-changed` with the scopes it touched
// ('estimates', 'rates', …). A page passes its loader and, optionally, the
// scopes it cares about; with none given it reloads on any change. The loader
// is read through a ref so the listener is bound once.
//
//   useDataChanged(refresh, ['estimates']);

export const DATA_CHANGED_EVENT = 'aiqs:data-changed';

export function announceDataChanged(scopes) {
  try {
    window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT, { detail: { scopes: Array.isArray(scopes) ? scopes : [] } }));
  } catch (e) { /* very old browsers: nothing to refresh */ }
}

export default function useDataChanged(reload, scopes) {
  const fn = useRef(reload);
  fn.current = reload;
  const want = Array.isArray(scopes) ? scopes.join('|') : '';
  useEffect(() => {
    const wanted = want ? want.split('|') : null;
    const onChange = (e) => {
      const got = (e && e.detail && Array.isArray(e.detail.scopes)) ? e.detail.scopes : [];
      if (wanted && got.length && !got.some((s) => wanted.includes(s))) return;
      try { const r = fn.current && fn.current(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch (err) { /* the page shows its own error */ }
    };
    window.addEventListener(DATA_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, onChange);
  }, [want]);
}
