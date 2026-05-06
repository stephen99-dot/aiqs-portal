import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch, getToken } from '../utils/api';

/**
 * Builder Pack page — full-width workspace for turning a priced BOQ into the
 * outputs builders actually want.
 *
 * Two tabs:
 *   • Builder pack — granular trade rollup, materials & labour schedules,
 *     blanket builder margin + materials markup. Three-tab XLSX download.
 *   • Client copy — what you give the client. Per-trade OH&P override,
 *     prelims (flat or %), day-rate / management fee, contingency, VAT,
 *     rounding rule. Live preview, then a single-sheet XLSX download.
 *
 * Both views read the same parsed BOQ via /projects/:id/builder-breakdown
 * and compute their previews client-side; only the download hits the server.
 */

const TABS = [
  { key: 'builder', label: 'Builder pack' },
  { key: 'client',  label: 'Client copy'  },
];

const ROUNDING_OPTIONS = [
  { value: 0,   label: 'No rounding (penny accurate)' },
  { value: 1,   label: 'Nearest £1' },
  { value: 10,  label: 'Nearest £10' },
  { value: 100, label: 'Nearest £100' },
];

function fmt(sym, v) {
  return sym + (Math.round(v || 0)).toLocaleString('en-GB');
}
function roundMoney(rounding, v) {
  if (!rounding || rounding < 1) return Math.round(v * 100) / 100;
  return Math.round(v / rounding) * rounding;
}

export default function BuilderPackPage() {
  const { id } = useParams();
  const [breakdown, setBreakdown] = useState(null);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('builder');
  const [downloading, setDownloading] = useState(false);

  // Builder-tab controls
  const [builderMargin, setBuilderMargin] = useState(0);
  const [materialsMarkup, setMaterialsMarkup] = useState(0);

  // Client-tab controls
  const [defaultOhp, setDefaultOhp] = useState(12);
  const [contingency, setContingency] = useState(7.5);
  const [vat, setVat] = useState(0);
  const [perTradeOhp, setPerTradeOhp] = useState({});  // { '1': 14, '2': 12 }
  const [prelimsMode, setPrelimsMode] = useState('off'); // 'off' | 'flat' | 'pct'
  const [prelimsAmount, setPrelimsAmount] = useState(0);
  const [prelimsPct, setPrelimsPct] = useState(0);
  const [dayRateOn, setDayRateOn] = useState(false);
  const [dayRate, setDayRate] = useState({ label: 'Project management', days: 0, rate_per_day: 0 });
  const [rounding, setRounding] = useState(10);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiFetch(`/projects/${id}`),
      apiFetch(`/projects/${id}/builder-breakdown`),
    ])
      .then(([proj, bd]) => {
        if (cancelled) return;
        setProject(proj);
        setBreakdown(bd);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load BOQ'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const sym = (project && project.currency === 'EUR') ? '€' : '£';

  // ─── Builder-tab calculations ────────────────────────────────────────────
  const labourMult = 1 + builderMargin / 100;
  const matMult = 1 + builderMargin / 100 + materialsMarkup / 100;
  const builderRows = useMemo(() => {
    if (!breakdown) return [];
    return breakdown.sections.map((s) => ({
      ...s,
      labour: (s.subtotal.labour || 0) * labourMult,
      materials: (s.subtotal.materials || 0) * matMult,
      total: ((s.subtotal.labour || 0) * labourMult) + ((s.subtotal.materials || 0) * matMult),
    }));
  }, [breakdown, labourMult, matMult]);
  const builderTotals = builderRows.reduce(
    (acc, r) => ({ labour: acc.labour + r.labour, materials: acc.materials + r.materials, total: acc.total + r.total }),
    { labour: 0, materials: 0, total: 0 }
  );

  // ─── Client-tab calculations ─────────────────────────────────────────────
  const clientRows = useMemo(() => {
    if (!breakdown) return [];
    return breakdown.sections.map((s) => {
      const sectionOhp = Object.prototype.hasOwnProperty.call(perTradeOhp, s.number)
        ? parseFloat(perTradeOhp[s.number])
        : defaultOhp;
      const ohp = Number.isFinite(sectionOhp) ? sectionOhp : defaultOhp;
      const base = (s.subtotal.labour || 0) + (s.subtotal.materials || 0);
      const subtotal = roundMoney(rounding, base * (1 + ohp / 100));
      return { ...s, ohp, base, subtotal };
    });
  }, [breakdown, defaultOhp, perTradeOhp, rounding]);

  const netConstruction = clientRows.reduce((a, r) => a + r.subtotal, 0);

  let runningTotal = netConstruction;
  const summaryLines = [{ label: 'Net construction (incl. trade OH&P)', value: netConstruction, key: 'net' }];
  if (prelimsMode === 'flat' && prelimsAmount > 0) {
    summaryLines.push({ label: 'Preliminaries (flat)', value: prelimsAmount, key: 'prel-flat' });
    runningTotal += prelimsAmount;
  }
  if (prelimsMode === 'pct' && prelimsPct > 0) {
    const v = netConstruction * (prelimsPct / 100);
    summaryLines.push({ label: `Preliminaries (${prelimsPct}% of net)`, value: v, key: 'prel-pct' });
    runningTotal += v;
  }
  if (dayRateOn && dayRate.days > 0 && dayRate.rate_per_day > 0) {
    const v = dayRate.days * dayRate.rate_per_day;
    summaryLines.push({
      label: `${dayRate.label} (${dayRate.days} day${dayRate.days === 1 ? '' : 's'} @ ${sym}${dayRate.rate_per_day})`,
      value: v, key: 'dayrate',
    });
    runningTotal += v;
  }
  if (contingency > 0) {
    const v = netConstruction * (contingency / 100);
    summaryLines.push({ label: `Contingency (${contingency}% of net)`, value: v, key: 'contingency' });
    runningTotal += v;
  }
  const exVat = runningTotal;
  const vatVal = vat > 0 ? exVat * (vat / 100) : 0;
  const inclVat = exVat + vatVal;

  // ─── Downloads ───────────────────────────────────────────────────────────
  async function downloadBuilderPack() {
    setDownloading(true); setError('');
    try {
      const token = getToken();
      const resp = await fetch(`/api/projects/${id}/builder-pack`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ builder_margin: builderMargin, materials_markup: materialsMarkup }),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || 'Download failed');
      }
      await streamBlob(resp);
    } catch (err) { setError(err.message); }
    finally { setDownloading(false); }
  }

  async function downloadClientCopy() {
    setDownloading(true); setError('');
    try {
      const token = getToken();
      const body = {
        contingency, default_ohp: defaultOhp, vat,
        per_trade_ohp: perTradeOhp,
        prelims_amount: prelimsMode === 'flat' ? prelimsAmount : 0,
        prelims_pct:    prelimsMode === 'pct'  ? prelimsPct    : 0,
        day_rate: dayRateOn ? dayRate : null,
        rounding,
      };
      const resp = await fetch(`/api/projects/${id}/client-copy-pro`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(e.error || 'Download failed');
      }
      await streamBlob(resp);
    } catch (err) { setError(err.message); }
    finally { setDownloading(false); }
  }

  async function streamBlob(resp) {
    const blob = await resp.blob();
    const disp = resp.headers.get('content-disposition') || '';
    const m = disp.match(/filename="?([^"]+)"?/);
    const filename = m ? m[1] : 'export.xlsx';
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 1480, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <Link to={`/project/${id}`} style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}>
          ← Back to project
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
          <h1 style={{
            fontFamily: "'DM Serif Display', Georgia, serif",
            fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em',
          }}>
            Builder Pack & Client Copy
          </h1>
          <span style={{
            fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em',
            padding: '3px 8px', borderRadius: 5,
            background: 'rgba(239,68,68,0.12)', color: '#EF4444',
            border: '1px solid rgba(239,68,68,0.3)',
            textTransform: 'uppercase',
          }}>Testing · Beta</span>
        </div>
        {project && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>
            {project.title} · {project.project_type}
          </p>
        )}
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, padding: 4, borderRadius: 10,
        background: 'var(--card-bg)', border: '1px solid var(--border)',
        marginBottom: 18, width: 'fit-content',
      }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 18px', borderRadius: 7,
              fontSize: 13, fontWeight: 700,
              background: tab === t.key
                ? (t.key === 'builder' ? '#F59E0B' : '#A855F7')
                : 'transparent',
              color: tab === t.key ? '#0A0F1C' : 'var(--text-muted)',
              border: 'none', cursor: 'pointer',
            }}
          >{t.label}</button>
        ))}
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 12, borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
          color: '#EF4444', fontSize: 13,
        }}>{error}</div>
      )}

      {loading && (
        <div style={{ padding: 40, textAlign: 'center', fontSize: 13.5, color: 'var(--text-muted)' }}>
          Reading the BOQ…
        </div>
      )}

      {!loading && breakdown && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 360px) 1fr', gap: 18, alignItems: 'flex-start' }}>
          {/* ─── Sticky control sidebar ────────────────────────────────────── */}
          <div style={{
            position: 'sticky', top: 12,
            padding: 18, borderRadius: 12,
            background: 'var(--card-bg)', border: '1px solid var(--border)',
            maxHeight: 'calc(100vh - 40px)', overflowY: 'auto',
          }}>
            {tab === 'builder' && (
              <>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>Builder margins</h3>
                <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
                  Add your blanket margin on every line, plus an extra uplift on materials only.
                </p>

                <Slider label="Builder margin (all rates)" value={builderMargin} onChange={setBuilderMargin} max={40} hint="Applies to labour and materials" />
                <Slider label="Materials markup (extra)" value={materialsMarkup} onChange={setMaterialsMarkup} max={40} hint="Stacks on top of builder margin, materials only" />

                <button
                  onClick={downloadBuilderPack}
                  disabled={downloading || builderRows.length === 0}
                  style={primaryBtn('#F59E0B', downloading || builderRows.length === 0)}
                >
                  {downloading ? 'Generating…' : 'Download Builder Pack (3 tabs)'}
                </button>
                <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '8px 0 0', textAlign: 'center' }}>
                  Trade Summary · Materials Schedule · Labour Schedule
                </p>
              </>
            )}

            {tab === 'client' && (
              <>
                <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>Client copy controls</h3>
                <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
                  What the client sees. No margin shown separately — uplift is baked into rates.
                </p>

                <Slider label="Default OH&P" value={defaultOhp} onChange={setDefaultOhp} max={30} hint="Applied unless a trade is overridden below" />
                <Slider label="Contingency" value={contingency} onChange={setContingency} max={20} hint="% of construction net — separate summary line" />
                <Slider label="VAT" value={vat} onChange={setVat} max={25} hint="Set 0 if quoting ex-VAT" />

                <Field label="Rounding">
                  <select
                    value={rounding}
                    onChange={(e) => setRounding(parseInt(e.target.value, 10))}
                    style={selectStyle}
                  >
                    {ROUNDING_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>

                {/* Prelims */}
                <Field label="Preliminaries">
                  <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                    {[
                      { v: 'off', l: 'Off' },
                      { v: 'flat', l: 'Flat £' },
                      { v: 'pct', l: '% of net' },
                    ].map((o) => (
                      <button
                        key={o.v}
                        onClick={() => setPrelimsMode(o.v)}
                        style={{
                          flex: 1, padding: '6px 8px', borderRadius: 6,
                          fontSize: 11.5, fontWeight: 700,
                          background: prelimsMode === o.v ? '#A855F7' : 'transparent',
                          color: prelimsMode === o.v ? '#fff' : 'var(--text-muted)',
                          border: '1px solid ' + (prelimsMode === o.v ? '#A855F7' : 'var(--border)'),
                          cursor: 'pointer',
                        }}
                      >{o.l}</button>
                    ))}
                  </div>
                  {prelimsMode === 'flat' && (
                    <input
                      type="number" min="0" step="50" value={prelimsAmount}
                      onChange={(e) => setPrelimsAmount(parseFloat(e.target.value) || 0)}
                      placeholder="e.g. 2500"
                      style={inputStyle}
                    />
                  )}
                  {prelimsMode === 'pct' && (
                    <input
                      type="number" min="0" max="20" step="0.5" value={prelimsPct}
                      onChange={(e) => setPrelimsPct(parseFloat(e.target.value) || 0)}
                      placeholder="e.g. 5"
                      style={inputStyle}
                    />
                  )}
                </Field>

                {/* Day rate */}
                <Field label={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    Day-rate / mgmt
                    <input
                      type="checkbox" checked={dayRateOn}
                      onChange={(e) => setDayRateOn(e.target.checked)}
                      style={{ accentColor: '#A855F7' }}
                    />
                  </span>
                }>
                  {dayRateOn && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input
                        type="text" value={dayRate.label}
                        onChange={(e) => setDayRate((d) => ({ ...d, label: e.target.value }))}
                        placeholder="Label (e.g. Site management)"
                        style={inputStyle}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="number" min="0" step="0.5" value={dayRate.days}
                          onChange={(e) => setDayRate((d) => ({ ...d, days: parseFloat(e.target.value) || 0 }))}
                          placeholder="Days"
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <input
                          type="number" min="0" step="25" value={dayRate.rate_per_day}
                          onChange={(e) => setDayRate((d) => ({ ...d, rate_per_day: parseFloat(e.target.value) || 0 }))}
                          placeholder={`${sym}/day`}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                      </div>
                    </div>
                  )}
                </Field>

                {/* Per-trade OH&P override */}
                <details style={{ marginBottom: 12 }}>
                  <summary style={{ fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 0' }}>
                    Per-trade OH&P override ({Object.keys(perTradeOhp).length})
                  </summary>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                    {breakdown.sections.map((s) => {
                      const has = Object.prototype.hasOwnProperty.call(perTradeOhp, s.number);
                      return (
                        <div key={s.number} style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '5px 8px', borderRadius: 6,
                          background: has ? 'rgba(168,85,247,0.06)' : 'transparent',
                          border: '1px solid ' + (has ? 'rgba(168,85,247,0.3)' : 'var(--border)'),
                        }}>
                          <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.number}. {s.title}
                          </span>
                          <input
                            type="number" min="0" max="50" step="0.5"
                            value={has ? perTradeOhp[s.number] : ''}
                            placeholder={defaultOhp + '%'}
                            onChange={(e) => {
                              const v = e.target.value;
                              setPerTradeOhp((m) => {
                                const next = { ...m };
                                if (v === '' || v == null) delete next[s.number];
                                else next[s.number] = parseFloat(v) || 0;
                                return next;
                              });
                            }}
                            style={{ ...inputStyle, width: 60, padding: '4px 6px', fontSize: 11 }}
                          />
                          {has && (
                            <button
                              onClick={() => setPerTradeOhp((m) => { const next = { ...m }; delete next[s.number]; return next; })}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}
                              aria-label="Reset"
                            >×</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </details>

                <button
                  onClick={downloadClientCopy}
                  disabled={downloading || clientRows.length === 0}
                  style={primaryBtn('#A855F7', downloading || clientRows.length === 0, '#fff')}
                >
                  {downloading ? 'Generating…' : 'Download Client Copy'}
                </button>
              </>
            )}
          </div>

          {/* ─── Live preview ────────────────────────────────────────────── */}
          <div style={{
            padding: 18, borderRadius: 12,
            background: 'var(--card-bg)', border: '1px solid var(--border)',
          }}>
            {tab === 'builder' && (
              <BuilderPreview
                rows={builderRows} totals={builderTotals} sym={sym}
              />
            )}
            {tab === 'client' && (
              <ClientPreview
                rows={clientRows} sym={sym}
                summaryLines={summaryLines} exVat={exVat} vat={vat} vatVal={vatVal} inclVat={inclVat}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%', padding: '7px 10px', borderRadius: 7,
  background: 'var(--bg)', color: 'var(--text-primary)',
  border: '1px solid var(--border)', fontSize: 12, outline: 'none',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
const selectStyle = { ...inputStyle, cursor: 'pointer' };

function primaryBtn(color, disabled, textColor) {
  return {
    width: '100%', padding: '11px 16px', borderRadius: 9,
    background: color, color: textColor || '#0A0F1C',
    fontWeight: 700, fontSize: 13.5, border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    marginTop: 6,
  };
}

function Slider({ label, value, onChange, max, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#A855F7' }}>{value}%</span>
      </div>
      <input
        type="range" min="0" max={max} step="0.5"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#A855F7' }}
      />
      {hint && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function BuilderPreview({ rows, totals, sym }) {
  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 14px' }}>Trade summary preview</h2>
      <div style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={previewHeaderStyle}>
          <div>#</div><div>Trade</div>
          <div style={{ textAlign: 'right' }}>Labour</div>
          <div style={{ textAlign: 'right' }}>Materials</div>
          <div style={{ textAlign: 'right' }}>Total</div>
          <div style={{ textAlign: 'right' }}>%</div>
        </div>
        {rows.length === 0 && <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>No priced sections in this BOQ.</div>}
        {rows.map((s, i) => {
          const pct = totals.total > 0 ? (s.total / totals.total) * 100 : 0;
          return (
            <div key={s.number + '-' + i} style={previewRowStyle}>
              <div style={{ color: 'var(--text-muted)' }}>{i + 1}</div>
              <div style={{ fontWeight: 500 }}>{s.title}<span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 8 }}>{s.item_count} items</span></div>
              <div style={moneyCell('#3B82F6')}>{fmt(sym, s.labour)}</div>
              <div style={moneyCell('#A855F7')}>{fmt(sym, s.materials)}</div>
              <div style={{ ...moneyCell(), fontWeight: 700 }}>{fmt(sym, s.total)}</div>
              <div style={moneyCell('var(--text-muted)')}>{pct.toFixed(1)}%</div>
            </div>
          );
        })}
        <div style={{ ...previewRowStyle, background: 'rgba(245,158,11,0.08)', fontWeight: 700, fontSize: 13.5 }}>
          <div></div>
          <div>GRAND TOTAL</div>
          <div style={moneyCell()}>{fmt(sym, totals.labour)}</div>
          <div style={moneyCell()}>{fmt(sym, totals.materials)}</div>
          <div style={moneyCell('#F59E0B')}>{fmt(sym, totals.total)}</div>
          <div style={moneyCell()}>100%</div>
        </div>
      </div>

      {totals.total > 0 && (
        <>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 16, gap: 1, background: 'var(--border)' }}>
            <div style={{ width: ((totals.labour / totals.total) * 100) + '%', background: '#3B82F6' }} />
            <div style={{ width: ((totals.materials / totals.total) * 100) + '%', background: '#A855F7' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span><span style={{ color: '#3B82F6' }}>■</span> Labour {((totals.labour / totals.total) * 100).toFixed(1)}%</span>
            <span><span style={{ color: '#A855F7' }}>■</span> Materials {((totals.materials / totals.total) * 100).toFixed(1)}%</span>
          </div>
        </>
      )}
    </>
  );
}

function ClientPreview({ rows, sym, summaryLines, exVat, vat, vatVal, inclVat }) {
  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 14px' }}>Client copy preview</h2>
      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '-8px 0 14px' }}>
        This is what your client will see. No margin shown separately.
      </p>
      <div style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ ...previewHeaderStyle, gridTemplateColumns: '32px 1fr 80px 110px' }}>
          <div>#</div><div>Trade</div>
          <div style={{ textAlign: 'right' }}>OH&P</div>
          <div style={{ textAlign: 'right' }}>Sub-total</div>
        </div>
        {rows.map((s, i) => (
          <div key={s.number + '-' + i} style={{ ...previewRowStyle, gridTemplateColumns: '32px 1fr 80px 110px' }}>
            <div style={{ color: 'var(--text-muted)' }}>{i + 1}</div>
            <div style={{ fontWeight: 500 }}>{s.title}<span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 8 }}>{s.item_count} items</span></div>
            <div style={moneyCell('#A855F7')}>{s.ohp}%</div>
            <div style={{ ...moneyCell(), fontWeight: 600 }}>{fmt(sym, s.subtotal)}</div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div style={{
        marginTop: 16, borderRadius: 10, border: '1px solid var(--border)',
        background: 'var(--bg)', padding: '14px 16px',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
          Project summary
        </div>
        {summaryLines.map((l) => (
          <div key={l.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}>{l.label}</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{fmt(sym, l.value)}</span>
          </div>
        ))}
        <div style={{
          display: 'flex', justifyContent: 'space-between', padding: '8px 0',
          borderTop: '1px solid var(--border)', marginTop: 6,
          fontWeight: 700, fontSize: 14,
        }}>
          <span>Total (excl. VAT)</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{fmt(sym, exVat)}</span>
        </div>
        {vat > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>VAT @ {vat}%</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{fmt(sym, vatVal)}</span>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', padding: '8px 0',
              borderTop: '1px solid var(--border)', marginTop: 4,
              fontWeight: 800, fontSize: 16, color: '#A855F7',
            }}>
              <span>Total (incl. VAT)</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{fmt(sym, inclVat)}</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

const previewHeaderStyle = {
  display: 'grid',
  gridTemplateColumns: '32px 1fr 100px 100px 100px 60px',
  gap: 8, padding: '9px 12px',
  background: 'rgba(27,42,74,0.06)',
  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
  color: 'var(--text-muted)', textTransform: 'uppercase',
};
const previewRowStyle = {
  display: 'grid',
  gridTemplateColumns: '32px 1fr 100px 100px 100px 60px',
  gap: 8, padding: '10px 12px',
  borderTop: '1px solid var(--border)',
  fontSize: 12.5,
};
function moneyCell(color) {
  return {
    textAlign: 'right',
    fontFamily: 'JetBrains Mono, monospace',
    color: color || 'var(--text-primary)',
  };
}
