import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import MaterialThumb from './MaterialThumb';

// Materials-catalogue typeahead for the BOQ/quote builder's Description cell.
// Two-step: type → matching materials (with price range), click a material →
// its supplier variants (cheapest→dearest, cheapest/dearest/stale flagged),
// click a variant → onPick(...) fills Description / Unit / Materials rate and
// stores the source_url for audit. A picked material can be re-opened inline to
// switch supplier without leaving the row.
//
// onPick({ description, unit, materials, rate, source_url, supplier,
//          material_id, material_name, price_entry_id })

const DEBOUNCE_MS = 200;

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

export default function MaterialAutocomplete({
  value,
  unit,
  materialId,
  onChange,
  onPick,
  placeholder = 'Description — type to search materials',
  style,
}) {
  const { t } = useTheme();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('materials'); // 'materials' | 'variants'
  const [results, setResults] = useState([]);
  const [activeMat, setActiveMat] = useState(null); // { material, prices }
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const [anchor, setAnchor] = useState(null);

  const updateAnchor = useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setAnchor({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 360) });
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

  const search = useCallback(async (q) => {
    if (!q || q.trim().length < 2) { setResults([]); setLoading(false); return; }
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const data = await apiFetch('/materials/search?q=' + encodeURIComponent(q.trim()), { signal: ctrl.signal });
      if (!ctrl.signal.aborted) { setResults(data.results || []); }
    } catch (e) {
      if (!ctrl.signal.aborted) setResults([]);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!open || mode !== 'materials') return undefined;
    debounceRef.current = setTimeout(() => search(value), DEBOUNCE_MS);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [value, open, mode, search]);

  useEffect(() => {
    function onDoc(e) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const openVariants = async (mat) => {
    setLoading(true);
    setMode('variants');
    try {
      const data = await apiFetch('/materials/' + mat.id + '?sort=asc');
      setActiveMat({ material: data.material, prices: data.prices || [] });
    } catch (e) {
      setActiveMat({ material: mat, prices: [] });
    } finally {
      setLoading(false);
    }
  };

  const pickVariant = (material, entry) => {
    onPick({
      description: material.canonical_name,
      unit: entry.unit || material.default_unit || unit || 'item',
      materials: entry.price,
      rate: entry.price,
      source_url: entry.source_url || null,
      supplier: entry.supplier_name,
      material_id: material.id,
      material_name: material.canonical_name,
      price_entry_id: entry.id,
    });
    setOpen(false);
    setMode('materials');
    setActiveMat(null);
  };

  const reopenForSwitch = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!materialId) return;
    setOpen(true);
    updateAnchor();
    openVariants({ id: materialId });
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          ref={inputRef}
          value={value || ''}
          onChange={e => { onChange(e.target.value); setMode('materials'); setOpen(true); }}
          onFocus={() => { setOpen(true); updateAnchor(); }}
          placeholder={placeholder}
          autoComplete="off"
          style={{
            flex: 1, minWidth: 0, boxSizing: 'border-box',
            background: 'transparent', border: '1px solid transparent', color: t.textMuted,
            borderRadius: 4, padding: '4px 6px', fontSize: 12, outline: 'none',
          }}
        />
        {materialId && (
          <button
            type="button"
            title="Switch supplier variant"
            onMouseDown={reopenForSwitch}
            style={{
              flexShrink: 0, background: t.surface, border: '1px solid ' + t.border, color: t.accent,
              borderRadius: 4, padding: '2px 6px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >⇄ supplier</button>
        )}
      </div>

      {open && anchor && (
        <div style={{
          position: 'fixed', top: anchor.top, left: anchor.left, width: anchor.width, zIndex: 1000,
          background: t.card, border: '1px solid ' + t.border, borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)', maxHeight: 320, overflowY: 'auto',
        }}>
          {/* Variants view */}
          {mode === 'variants' && activeMat && (
            <div>
              <div style={{ padding: '8px 10px', borderBottom: '1px solid ' + t.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeMat.material.canonical_name}
                </div>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); setMode('materials'); }}
                  style={{ background: 'transparent', border: 'none', color: t.textMuted, cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}>
                  ← back
                </button>
              </div>
              {loading && <div style={{ padding: 10, color: t.textMuted, fontSize: 12 }}>Loading variants…</div>}
              {!loading && activeMat.prices.length === 0 && (
                <div style={{ padding: 10, color: t.textMuted, fontSize: 12 }}>No supplier prices yet for this material.</div>
              )}
              {activeMat.prices.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); pickVariant(activeMat.material, p); }}
                  style={{
                    display: 'flex', gap: 8, alignItems: 'flex-start', width: '100%', textAlign: 'left', background: 'transparent',
                    color: t.text, border: 'none', borderTop: '1px solid ' + t.border, padding: '8px 10px', cursor: 'pointer',
                  }}
                >
                  <MaterialThumb src={p.image_url || activeMat.material.image_url} alt={activeMat.material.canonical_name} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {p.supplier_name}
                      {p.is_cheapest && <span style={{ marginLeft: 6, fontSize: 10, color: '#fff', background: t.success || '#16a34a', borderRadius: 4, padding: '1px 5px' }}>cheapest</span>}
                      {p.is_most_expensive && <span style={{ marginLeft: 6, fontSize: 10, color: '#fff', background: t.danger || '#dc2626', borderRadius: 4, padding: '1px 5px' }}>dearest</span>}
                    </div>
                    <div style={{ fontSize: 13, color: t.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      £{Number(p.price).toFixed(2)} / {p.unit || activeMat.material.default_unit}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>verified {fmtDate(p.captured_at)}</span>
                    <span>· {p.in_stock ? 'in stock' : 'out of stock'}</span>
                    {p.is_stale && <span style={{ color: t.warning, fontWeight: 600 }}>· STALE &gt;30d</span>}
                    {p.source_url && (
                      <a href={p.source_url} target="_blank" rel="noopener noreferrer"
                        onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
                        style={{ color: t.accent }}>· Verify ↗</a>
                    )}
                  </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Materials view */}
          {mode === 'materials' && (
            <div>
              {loading && results.length === 0 && (
                <div style={{ padding: 10, color: t.textMuted, fontSize: 12 }}>Searching materials…</div>
              )}
              {!loading && results.length === 0 && value && value.length >= 2 && (
                <div style={{ padding: 10, color: t.textMuted, fontSize: 12 }}>
                  No catalogue match — type freely, or add it in the Materials page.
                </div>
              )}
              {results.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); openVariants(m); }}
                  style={{
                    display: 'flex', gap: 8, alignItems: 'flex-start', width: '100%', textAlign: 'left', background: 'transparent',
                    color: t.text, border: 'none', borderTop: '1px solid ' + t.border, padding: '8px 10px', cursor: 'pointer',
                  }}
                >
                  <MaterialThumb src={m.image_url} alt={m.canonical_name} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.canonical_name}
                    </div>
                    <div style={{ fontSize: 12, color: t.accent, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {m.price_count > 0
                        ? (m.min_price === m.max_price
                            ? '£' + Number(m.min_price).toFixed(2)
                            : '£' + Number(m.min_price).toFixed(2) + '–£' + Number(m.max_price).toFixed(2))
                        : 'no prices'}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2, display: 'flex', gap: 8 }}>
                    <span>{m.category || 'Uncategorised'}</span>
                    {m.price_count > 0 && <span>· {m.price_count} supplier{m.price_count === 1 ? '' : 's'}</span>}
                    {m.stale_count > 0 && <span style={{ color: t.warning }}>· {m.stale_count} stale</span>}
                  </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
