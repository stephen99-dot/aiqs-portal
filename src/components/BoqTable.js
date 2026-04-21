import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { useTheme } from '../context/ThemeContext';

// Plain-English labels for provenance badges on rates and quantities.
// These map to the rate_source / qty_source values emitted by server/deterministicPricer.js
// and server/chat.js (PUT /takeoff/:id).
const RATE_SOURCE_LABELS = {
  override:             { label: 'Override',          color: '#7C3AED', bg: 'rgba(124,58,237,0.12)', desc: 'Rate manually overridden on this line' },
  client_verified:      { label: 'Your rate',         color: '#10B981', bg: 'rgba(16,185,129,0.12)', desc: 'From your rate library' },
  base_library:         { label: "SPON's / base",     color: '#64748B', bg: 'rgba(100,116,139,0.12)', desc: 'Standard UK rate from the base library' },
  ai_estimated:         { label: 'AI estimated',      color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', desc: 'AI estimated — no base rate for this key' },
  fallback_estimated:   { label: 'Fallback estimate', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', desc: 'Conservative fallback based on unit type' },
  fallback_corrected:   { label: 'Auto-corrected',    color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', desc: 'Rate looked too high; auto-corrected to fallback' },
};

const QTY_SOURCE_LABELS = {
  ai_extracted: { label: 'AI',     color: '#3B82F6', bg: 'rgba(59,130,246,0.12)', desc: 'Extracted by AI from drawings' },
  user_edited:  { label: 'Edited', color: '#10B981', bg: 'rgba(16,185,129,0.12)', desc: 'You edited this quantity' },
  intake:       { label: 'Intake', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', desc: 'From your project intake answers' },
};

function Badge({ spec }) {
  if (!spec) return null;
  return (
    <span
      title={spec.desc}
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 10,
        fontSize: 10,
        fontWeight: 600,
        background: spec.bg,
        color: spec.color,
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
      }}
    >
      {spec.label}
    </span>
  );
}

function fmtMoney(n, currency) {
  const sym = currency === 'EUR' ? '€' : '£';
  if (n == null || isNaN(n)) return sym + '0';
  return sym + Math.round(n).toLocaleString('en-GB');
}

function fmtQty(n) {
  if (n == null || isNaN(n)) return '0';
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

export default function BoqTable({ sessionId, takeoffId, onChange, onRegenerate, compact = false }) {
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const [loading, setLoading]   = useState(true);
  const [data, setData]         = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [editingVal, setEditingVal] = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [expanded, setExpanded] = useState({});

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch('/takeoff/' + sessionId + '/priced');
      setData(d);
      // Expand all sections by default in non-compact mode
      if (!compact) {
        const all = {};
        (d.priced?.sections || []).forEach(s => { all[s.name] = true; });
        setExpanded(all);
      }
    } catch (e) {
      if (e.status === 404) setData(null); // No takeoff yet — render nothing
      else setError(e.message || 'Failed to load BOQ');
    } finally {
      setLoading(false);
    }
  }, [sessionId, compact]);

  useEffect(() => { load(); }, [load]);

  async function saveEdit(itemKey) {
    if (!data || !takeoffId) return;
    const num = parseFloat(editingVal);
    if (!Number.isFinite(num) || num < 0) { setEditingKey(null); return; }

    // Build new items array from existing raw items, replacing qty for the edited key
    const next = (data.items_raw || []).map(it => it.key === itemKey ? { ...it, qty: num, qty_source: 'user_edited' } : it);

    setSaving(true);
    try {
      const res = await apiFetch('/takeoff/' + takeoffId, {
        method: 'PUT',
        body: JSON.stringify({ items: next }),
      });
      setData(prev => ({
        ...prev,
        items_raw: res.items_raw || next,
        priced: res.priced || prev.priced,
      }));
      if (onChange) onChange(res);
    } catch (e) {
      alert(e.message || 'Failed to save edit');
    } finally {
      setSaving(false);
      setEditingKey(null);
    }
  }

  if (!sessionId) return null;
  if (loading) return (
    <div style={{ padding: 16, fontSize: 12, color: isDark ? '#64748B' : '#94A3B8' }}>Loading BOQ...</div>
  );
  if (error) return (
    <div style={{ padding: 12, fontSize: 12, color: '#EF4444', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8 }}>
      {error}
    </div>
  );
  if (!data || !data.priced) return null;

  const c = isDark ? {
    border: 'rgba(255,255,255,0.08)',
    bg: '#0F1520',
    rowBg: 'transparent',
    rowHover: 'rgba(255,255,255,0.03)',
    text: '#E2E8F0', textMuted: '#94A3B8', textSub: '#64748B',
    accent: '#F59E0B',
    sectionBg: 'rgba(245,158,11,0.05)',
    totalBg: 'rgba(16,185,129,0.06)',
    editBg: 'rgba(245,158,11,0.08)',
  } : {
    border: 'rgba(0,0,0,0.08)',
    bg: '#FFFFFF',
    rowBg: 'transparent',
    rowHover: 'rgba(0,0,0,0.02)',
    text: '#1E293B', textMuted: '#64748B', textSub: '#94A3B8',
    accent: '#D97706',
    sectionBg: 'rgba(245,158,11,0.04)',
    totalBg: 'rgba(16,185,129,0.04)',
    editBg: 'rgba(245,158,11,0.06)',
  };

  const { sections = [], summary = {} } = data.priced || {};
  const currency = summary.currency || 'GBP';

  return (
    <div style={{
      background: c.bg,
      border: '1px solid ' + c.border,
      borderRadius: 10,
      overflow: 'hidden',
      marginTop: compact ? 8 : 14,
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid ' + c.border,
        display: 'flex', alignItems: 'center', gap: 10,
        background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: c.text }}>Bill of Quantities</span>
        <span style={{ fontSize: 11, color: c.textMuted }}>
          {sections.reduce((s, sec) => s + (sec.items?.length || 0), 0)} items · click a quantity to edit
        </span>
        {saving && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: c.accent, fontWeight: 600 }}>Saving...</span>
        )}
      </div>

      {/* Sections */}
      <div style={{ maxHeight: compact ? 360 : 600, overflowY: 'auto' }}>
        {sections.map(sec => {
          const isOpen = expanded[sec.name];
          return (
            <div key={sec.name}>
              <div
                onClick={() => setExpanded(p => ({ ...p, [sec.name]: !p[sec.name] }))}
                style={{
                  padding: '9px 14px',
                  background: c.sectionBg,
                  borderBottom: '1px solid ' + c.border,
                  display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, color: c.text,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}
              >
                <span style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s', fontSize: 9, color: c.textMuted }}>▶</span>
                <span>{sec.name}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, color: c.text, fontSize: 12 }}>
                  {fmtMoney(sec.subtotal, currency)}
                </span>
                <span style={{ fontSize: 10, fontWeight: 500, color: c.textMuted, width: 40, textAlign: 'right' }}>
                  {sec.items?.length || 0} items
                </span>
              </div>

              {isOpen && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)' }}>
                      <th style={{ textAlign: 'left',  padding: '6px 10px', color: c.textSub, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Item</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px',  color: c.textSub, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', width: 90 }}>Qty</th>
                      <th style={{ textAlign: 'left',  padding: '6px 8px',  color: c.textSub, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', width: 50 }}>Unit</th>
                      <th style={{ textAlign: 'right', padding: '6px 8px',  color: c.textSub, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', width: 80 }}>Rate</th>
                      <th style={{ textAlign: 'right', padding: '6px 10px', color: c.textSub, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', width: 90 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sec.items.map(item => {
                      const rateSpec = RATE_SOURCE_LABELS[item.rate_source];
                      const qtySpec  = QTY_SOURCE_LABELS[item.qty_source];
                      const isEditing = editingKey === item.key;
                      return (
                        <tr key={item.key + '-' + (item.item_ref || '')} style={{ borderBottom: '1px solid ' + c.border }}>
                          <td style={{ padding: '7px 10px', color: c.text, lineHeight: 1.4, verticalAlign: 'top' }}>
                            <div>{item.description || item.key}</div>
                          </td>
                          <td
                            style={{
                              textAlign: 'right', padding: '7px 8px', color: c.text,
                              fontVariantNumeric: 'tabular-nums', cursor: 'pointer',
                              background: isEditing ? c.editBg : undefined,
                              whiteSpace: 'nowrap',
                            }}
                            onClick={() => {
                              if (isEditing) return;
                              setEditingKey(item.key);
                              setEditingVal(String(item.qty));
                            }}
                          >
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                autoFocus
                                value={editingVal}
                                onChange={e => setEditingVal(e.target.value)}
                                onBlur={() => saveEdit(item.key)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveEdit(item.key);
                                  else if (e.key === 'Escape') setEditingKey(null);
                                }}
                                style={{
                                  width: 72, textAlign: 'right',
                                  background: 'transparent',
                                  border: '1px solid ' + c.accent,
                                  borderRadius: 4,
                                  color: c.text, fontSize: 12,
                                  padding: '2px 5px', outline: 'none',
                                  fontFamily: 'inherit',
                                }}
                              />
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                                {qtySpec && <Badge spec={qtySpec} />}
                                <span>{fmtQty(item.qty)}</span>
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '7px 8px', color: c.textMuted, fontSize: 11 }}>{item.unit}</td>
                          <td style={{ textAlign: 'right', padding: '7px 8px', color: c.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                              {rateSpec && <Badge spec={rateSpec} />}
                              <span>{fmtMoney(item.rate, currency)}</span>
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', padding: '7px 10px', color: c.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {fmtMoney(item.total, currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div style={{ padding: '12px 14px', background: c.totalBg, borderTop: '1px solid ' + c.border, fontSize: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 4, columnGap: 12 }}>
          <span style={{ color: c.textMuted }}>Construction total</span>
          <span style={{ color: c.text, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{fmtMoney(summary.construction_total, currency)}</span>

          {summary.contingency_pct != null && (
            <>
              <span style={{ color: c.textMuted }}>Contingency ({summary.contingency_pct}%)</span>
              <span style={{ color: c.text, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{fmtMoney(summary.contingency, currency)}</span>
            </>
          )}
          {summary.ohp_pct != null && (
            <>
              <span style={{ color: c.textMuted }}>Overheads &amp; profit ({summary.ohp_pct}%)</span>
              <span style={{ color: c.text, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{fmtMoney(summary.ohp, currency)}</span>
            </>
          )}
          {summary.vat_rate != null && (
            <>
              <span style={{ color: c.textMuted }}>VAT ({summary.vat_rate}%)</span>
              <span style={{ color: c.text, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{fmtMoney(summary.vat, currency)}</span>
            </>
          )}

          <span style={{ color: c.text, fontWeight: 700, fontSize: 13, paddingTop: 4, borderTop: '1px solid ' + c.border, marginTop: 2 }}>
            Grand total
          </span>
          <span style={{ color: c.text, fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums', textAlign: 'right', paddingTop: 4, borderTop: '1px solid ' + c.border, marginTop: 2 }}>
            {fmtMoney(summary.grand_total, currency)}
          </span>
        </div>

        {/* Provenance legend */}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + c.border, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: c.textSub, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Sources:</span>
          {Object.values({ ...QTY_SOURCE_LABELS, ...RATE_SOURCE_LABELS }).map((spec, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Badge spec={spec} />
            </span>
          ))}
        </div>

        {/* Audit panel — exactly what fed the pricer, so the user can see
            why this total is what it is. Deterministic given these inputs. */}
        <details style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + c.border, fontSize: 11 }}>
          <summary style={{ cursor: 'pointer', color: c.textSub, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10, userSelect: 'none' }}>
            How this total was calculated
          </summary>
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 4, columnGap: 10, fontSize: 11, color: c.textMuted }}>
            <span>Takeoff ID</span>
            <span style={{ color: c.text, fontFamily: 'ui-monospace, monospace' }}>{data.takeoff?.id || '—'}</span>
            <span>Project type</span>
            <span style={{ color: c.text }}>{data.takeoff?.project_type || summary.project_label || '—'}</span>
            <span>Location</span>
            <span style={{ color: c.text }}>{data.takeoff?.location || '—'}{summary.location_factor != null ? ` · factor ${(summary.location_factor * 100).toFixed(0)}%` : ''}</span>
            <span>Currency</span>
            <span style={{ color: c.text }}>{currency}{summary.vat_rate != null ? ` · VAT ${summary.vat_rate}%` : ''}</span>
            <span>Items</span>
            <span style={{ color: c.text }}>{(data.items_raw || []).length} raw · {sections.reduce((s, sec) => s + (sec.items?.length || 0), 0)} priced</span>
            <span>Margins</span>
            <span style={{ color: c.text }}>Contingency {summary.contingency_pct}% · OH&P {summary.ohp_pct}%</span>
          </div>
          {data.priced?.warnings && data.priced.warnings.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: c.textSub, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 4 }}>
                Auto-corrections & caps ({data.priced.warnings.length})
              </div>
              <div style={{ fontSize: 11, color: c.textMuted, lineHeight: 1.5, maxHeight: 140, overflowY: 'auto' }}>
                {data.priced.warnings.map((w, i) => (
                  <div key={i} style={{ padding: '3px 0', borderBottom: i < data.priced.warnings.length - 1 ? '1px solid ' + c.border : 'none' }}>· {w}</div>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 10, color: c.textSub, lineHeight: 1.5 }}>
            Pricing is deterministic — given the same items, location, and intake answers, the total will always be identical. AI extraction is pinned to temperature 0 so re-running on the same drawings should give the same quantities.
          </div>
        </details>

        {onRegenerate && (
          <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              onClick={onRegenerate}
              style={{
                padding: '7px 14px', borderRadius: 7,
                background: 'linear-gradient(135deg,#F59E0B,#D97706)',
                border: 'none', color: '#0A0F1C',
                fontSize: 12, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Regenerate documents
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
