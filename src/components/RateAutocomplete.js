import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';

// Typeahead over the seeded `rates` table. Drop into a line editor's "item" field.
// On select, calls onPick({ description, unit, rate, labour, materials, code, trade })
// so the parent can fill the rest of the row and clear the est_rate flag.

const DEBOUNCE_MS = 200;

export default function RateAutocomplete({
  value,
  unit,
  onChange,
  onPick,
  placeholder = 'Item — start typing to search rates',
  style,
}) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const [anchor, setAnchor] = useState(null);

  const updateAnchor = useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setAnchor({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 320) });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updateAnchor();
    const onScroll = () => updateAnchor();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, updateAnchor]);

  const search = useCallback(async (q, u) => {
    if (!q || q.trim().length < 2) {
      setResults([]); setLoading(false); return;
    }
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: q.trim() });
      if (u) params.set('unit', u);
      const data = await apiFetch('/estimator/rates/search?' + params.toString(), { signal: ctrl.signal });
      if (!ctrl.signal.aborted) {
        setResults(data.results || []);
        setActiveIdx(-1);
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setResults([]);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!open) return undefined;
    debounceRef.current = setTimeout(() => search(value, unit), DEBOUNCE_MS);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [value, unit, open, search]);

  // Close on outside click
  useEffect(() => {
    function onDoc(e) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (r) => {
    if (!r) return;
    onPick(r);
    setOpen(false);
    setResults([]);
  };

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      if (activeIdx >= 0 && activeIdx < results.length) { e.preventDefault(); pick(results[activeIdx]); }
    } else if (e.key === 'Escape') { setOpen(false); }
  };

  const showDropdown = open && (results.length > 0 || (value && value.length >= 2 && (loading || !loading)));

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      <input
        ref={inputRef}
        value={value || ''}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); updateAnchor(); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        style={{
          width: '100%', boxSizing: 'border-box',
          background: 'transparent', border: '1px solid transparent', color: t.text,
          borderRadius: 4, padding: '4px 6px', fontSize: 13, fontWeight: 600, outline: 'none',
        }}
      />
      {showDropdown && anchor && (
        <div style={{
          position: 'fixed', top: anchor.top, left: anchor.left, width: anchor.width, zIndex: 1000,
          background: t.card, border: '1px solid ' + t.border, borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)', maxHeight: 280, overflowY: 'auto',
        }}>
          {loading && results.length === 0 && (
            <div style={{ padding: 10, color: t.textMuted, fontSize: 12 }}>Searching…</div>
          )}
          {!loading && results.length === 0 && value && value.length >= 2 && (
            <div style={{ padding: 10, color: t.textMuted, fontSize: 12 }}>
              No rate library match — type freely; the line will be tagged as estimated.
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={(r.code || '') + i}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(r); }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: i === activeIdx ? t.surface : 'transparent',
                color: t.text, border: 'none', padding: '8px 10px', cursor: 'pointer',
                borderTop: i === 0 ? 'none' : '1px solid ' + t.border,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: 13, color: t.text, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.description}
                </div>
                <div style={{ fontSize: 12, color: t.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  £{Number(r.rate).toFixed(2)} / {r.unit}
                </div>
              </div>
              <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2, display: 'flex', gap: 10 }}>
                <span>{r.trade}</span>
                {r.code && <span>· {r.code}</span>}
                {r.labour ? <span>· labour £{Number(r.labour).toFixed(2)}</span> : null}
                {r.materials ? <span>· materials £{Number(r.materials).toFixed(2)}</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
