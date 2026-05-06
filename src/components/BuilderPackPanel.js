import React, { useState, useEffect } from 'react';
import { apiFetch, getToken } from '../utils/api';

/**
 * Builder Pack panel — granular, builder-friendly outputs from a priced BOQ.
 * TESTING / BETA: this whole flow is in test, surfaces are clearly marked so
 * no-one mistakes it for production output.
 *
 * What it shows on screen:
 *   • Trade-by-trade table (labour / materials / total / % share)
 *   • Project rollup (labour vs materials split)
 * What it downloads:
 *   • One XLSX with three tabs — Trade Summary, Materials Schedule, Labour Schedule
 *   • Optional builder margin (across the board) and materials markup (materials only)
 */
export default function BuilderPackPanel({ projectId, hasBoq, currency = 'GBP' }) {
  const [breakdown, setBreakdown] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [builderMargin, setBuilderMargin] = useState(0);
  const [materialsMarkup, setMaterialsMarkup] = useState(0);

  useEffect(() => {
    if (!hasBoq || !open || breakdown) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    apiFetch(`/projects/${projectId}/builder-breakdown`)
      .then((data) => { if (!cancelled) setBreakdown(data); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load breakdown'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hasBoq, open, projectId, breakdown]);

  const sym = currency === 'EUR' ? '€' : '£';
  const fmt = (v) => sym + (v || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const labourMult = 1 + builderMargin / 100;
  const matMult = 1 + builderMargin / 100 + materialsMarkup / 100;

  const adjustedSections = breakdown
    ? breakdown.sections.map((s) => {
        const labour = (s.subtotal.labour || 0) * labourMult;
        const materials = (s.subtotal.materials || 0) * matMult;
        return { ...s, adj: { labour, materials, total: labour + materials } };
      })
    : [];
  const adjustedGrand = adjustedSections.reduce(
    (acc, s) => ({
      labour: acc.labour + s.adj.labour,
      materials: acc.materials + s.adj.materials,
      total: acc.total + s.adj.total,
    }),
    { labour: 0, materials: 0, total: 0 }
  );

  async function download() {
    setDownloading(true);
    setError('');
    try {
      const token = getToken();
      const resp = await fetch(`/api/projects/${projectId}/builder-pack`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ builder_margin: builderMargin, materials_markup: materialsMarkup }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(err.error || 'Download failed');
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `BuilderPack_TESTING_${projectId}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  if (!hasBoq) return null;

  return (
    <div style={{
      marginTop: 16,
      borderRadius: 12,
      border: '1px solid rgba(245,158,11,0.35)',
      background: 'linear-gradient(135deg, rgba(245,158,11,0.05), rgba(236,72,153,0.04))',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          width: '100%', padding: '14px 18px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{
          width: 34, height: 34, borderRadius: 8, flexShrink: 0,
          background: 'linear-gradient(135deg, #F59E0B, #D97706)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#0A0F1C', fontWeight: 800, fontSize: 14,
        }}>BP</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              Builder Pack
            </span>
            <span style={{
              fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em',
              padding: '2px 7px', borderRadius: 4,
              background: 'rgba(239,68,68,0.12)', color: '#EF4444',
              border: '1px solid rgba(239,68,68,0.3)',
              textTransform: 'uppercase',
            }}>Testing · Beta</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Trade-by-trade rollup, materials schedule and labour schedule. Add your own margin before downloading.
          </div>
        </div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div style={{ padding: '4px 18px 18px' }}>
          {/* TESTING strip */}
          <div style={{
            padding: '8px 12px', borderRadius: 7, marginBottom: 14,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
            fontSize: 11.5, color: '#B91C1C', lineHeight: 1.5,
          }}>
            <strong>This is a TESTING feature.</strong>{' '}
            Values are derived from the priced BOQ but the layout is still being refined —
            don't issue these to subcontractors without a QS sign-off.
          </div>

          {loading && (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
              Reading your BOQ…
            </div>
          )}

          {error && (
            <div style={{
              padding: '10px 12px', borderRadius: 8, marginBottom: 12,
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              color: '#EF4444', fontSize: 13,
            }}>{error}</div>
          )}

          {breakdown && (
            <>
              {/* Margin controls */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
                padding: 14, borderRadius: 10, marginBottom: 14,
                background: 'var(--bg)', border: '1px solid var(--border)',
              }}>
                {[
                  { key: 'bm', label: 'Builder margin (all rates)', val: builderMargin, set: setBuilderMargin, hint: 'Your blanket uplift on labour and materials' },
                  { key: 'mm', label: 'Materials markup (extra)', val: materialsMarkup, set: setMaterialsMarkup, hint: 'Additional uplift on materials only' },
                ].map(({ key, label, val, set, hint }) => (
                  <div key={key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B' }}>+{val}%</span>
                    </div>
                    <input
                      type="range" min="0" max="40" step="0.5"
                      value={val}
                      onChange={(e) => set(parseFloat(e.target.value))}
                      style={{ width: '100%', accentColor: '#F59E0B' }}
                    />
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
                  </div>
                ))}
              </div>

              {/* Trade summary table */}
              <div style={{
                borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--card-bg)', overflow: 'hidden', marginBottom: 12,
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1fr 90px 90px 90px 60px',
                  gap: 6, padding: '9px 12px',
                  background: 'rgba(27,42,74,0.06)',
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
                  color: 'var(--text-muted)', textTransform: 'uppercase',
                }}>
                  <div>#</div><div>Trade</div>
                  <div style={{ textAlign: 'right' }}>Labour</div>
                  <div style={{ textAlign: 'right' }}>Materials</div>
                  <div style={{ textAlign: 'right' }}>Total</div>
                  <div style={{ textAlign: 'right' }}>%</div>
                </div>
                {adjustedSections.length === 0 && (
                  <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                    No priced sections found in this BOQ.
                  </div>
                )}
                {adjustedSections.map((s, idx) => {
                  const pct = adjustedGrand.total > 0 ? (s.adj.total / adjustedGrand.total) * 100 : 0;
                  return (
                    <div key={s.number + '-' + idx} style={{
                      display: 'grid',
                      gridTemplateColumns: '32px 1fr 90px 90px 90px 60px',
                      gap: 6, padding: '10px 12px',
                      borderTop: '1px solid var(--border)',
                      fontSize: 12.5,
                    }}>
                      <div style={{ color: 'var(--text-muted)' }}>{idx + 1}</div>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                        {s.title}
                        <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 8 }}>
                          {s.item_count} item{s.item_count === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#3B82F6' }}>
                        {fmt(s.adj.labour)}
                      </div>
                      <div style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#A855F7' }}>
                        {fmt(s.adj.materials)}
                      </div>
                      <div style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {fmt(s.adj.total)}
                      </div>
                      <div style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
                        {pct.toFixed(1)}%
                      </div>
                    </div>
                  );
                })}
                {/* Grand total row */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '32px 1fr 90px 90px 90px 60px',
                  gap: 6, padding: '11px 12px',
                  borderTop: '1px solid var(--border)',
                  background: 'rgba(245,158,11,0.06)',
                  fontSize: 13, fontWeight: 700,
                }}>
                  <div></div>
                  <div style={{ color: 'var(--text-primary)' }}>GRAND TOTAL</div>
                  <div style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmt(adjustedGrand.labour)}</div>
                  <div style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmt(adjustedGrand.materials)}</div>
                  <div style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', color: '#F59E0B' }}>{fmt(adjustedGrand.total)}</div>
                  <div style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>100%</div>
                </div>
              </div>

              {/* Labour vs materials split */}
              {adjustedGrand.total > 0 && (
                <div style={{
                  display: 'flex', gap: 1, height: 8, borderRadius: 4, overflow: 'hidden',
                  marginBottom: 14, background: 'var(--border)',
                }}>
                  <div style={{
                    width: ((adjustedGrand.labour / adjustedGrand.total) * 100) + '%',
                    background: '#3B82F6',
                  }} />
                  <div style={{
                    width: ((adjustedGrand.materials / adjustedGrand.total) * 100) + '%',
                    background: '#A855F7',
                  }} />
                </div>
              )}
              {adjustedGrand.total > 0 && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', fontSize: 11.5,
                  color: 'var(--text-muted)', marginBottom: 16,
                }}>
                  <span><span style={{ color: '#3B82F6', fontWeight: 700 }}>■</span> Labour {((adjustedGrand.labour / adjustedGrand.total) * 100).toFixed(1)}%</span>
                  <span><span style={{ color: '#A855F7', fontWeight: 700 }}>■</span> Materials {((adjustedGrand.materials / adjustedGrand.total) * 100).toFixed(1)}%</span>
                </div>
              )}

              {/* Download button */}
              <button
                onClick={download}
                disabled={downloading || adjustedSections.length === 0}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', padding: '12px 18px', borderRadius: 10,
                  background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                  color: '#0A0F1C', fontWeight: 700, fontSize: 14, border: 'none',
                  cursor: downloading ? 'wait' : 'pointer',
                  opacity: (downloading || adjustedSections.length === 0) ? 0.6 : 1,
                  boxShadow: '0 2px 12px rgba(245,158,11,0.25)',
                }}
              >
                {downloading
                  ? 'Generating Builder Pack…'
                  : 'Download Builder Pack (3 tabs · TESTING)'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
