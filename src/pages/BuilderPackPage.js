import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch, getToken } from '../utils/api';

/**
 * Builder Pack page — full-width workspace for turning a priced BOQ into the
 * outputs builders actually want. Items are editable in-place: change a
 * description, qty, labour or materials value and the previews + download
 * recompute live. Edits are sent to the server when downloading.
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

function fmt(sym, v, decimals = 0) {
  return sym + (Math.round((v || 0) * Math.pow(10, decimals)) / Math.pow(10, decimals))
    .toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function roundMoney(rounding, v) {
  if (!rounding || rounding < 1) return Math.round(v * 100) / 100;
  return Math.round(v / rounding) * rounding;
}
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export default function BuilderPackPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [sections, setSections] = useState([]);   // editable copy of breakdown.sections
  const [originalSections, setOriginalSections] = useState([]); // for "reset"
  const [branding, setBranding] = useState(null); // { primary_colour, accent_colour, ... }
  const [logoUrl, setLogoUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('builder');
  const [downloading, setDownloading] = useState(false);
  const [openSectionIds, setOpenSectionIds] = useState({}); // { '1': true }

  // Builder-tab controls
  const [builderMargin, setBuilderMargin] = useState(0);
  const [materialsMarkup, setMaterialsMarkup] = useState(0);

  // Client-tab controls
  const [defaultOhp, setDefaultOhp] = useState(12);
  const [contingency, setContingency] = useState(7.5);
  const [vat, setVat] = useState(0);
  const [perTradeOhp, setPerTradeOhp] = useState({});
  const [prelimsMode, setPrelimsMode] = useState('off');
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
      apiFetch('/branding').catch(() => null),
    ])
      .then(([proj, bd, br]) => {
        if (cancelled) return;
        setProject(proj);
        const seeded = (bd.sections || []).map((s) => ({
          number: s.number,
          title: s.title,
          items: (s.items || []).map((it) => ({ ...it })),
        }));
        setSections(seeded);
        setOriginalSections(JSON.parse(JSON.stringify(seeded)));
        if (seeded.length) setOpenSectionIds({ [seeded[0].number]: true });
        if (br && br.branding) {
          setBranding(br.branding);
          // Logo endpoint needs auth — fetch as blob so <img> can render it.
          if (br.logo_url) {
            const token = getToken();
            fetch(br.logo_url, { headers: { Authorization: 'Bearer ' + token } })
              .then((r) => r.ok ? r.blob() : null)
              .then((blob) => { if (blob && !cancelled) setLogoUrl(URL.createObjectURL(blob)); })
              .catch(() => {});
          }
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load BOQ'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const sym = (project && project.currency === 'EUR') ? '€' : '£';

  // ─── Edit helpers ────────────────────────────────────────────────────────
  const updateItem = useCallback((sIdx, iIdx, patch) => {
    setSections((prev) => {
      const next = prev.slice();
      const sec = { ...next[sIdx], items: next[sIdx].items.slice() };
      sec.items[iIdx] = { ...sec.items[iIdx], ...patch };
      next[sIdx] = sec;
      return next;
    });
  }, []);
  const updateSectionTitle = useCallback((sIdx, title) => {
    setSections((prev) => {
      const next = prev.slice();
      next[sIdx] = { ...next[sIdx], title };
      return next;
    });
  }, []);
  const removeItem = useCallback((sIdx, iIdx) => {
    setSections((prev) => {
      const next = prev.slice();
      const sec = { ...next[sIdx], items: next[sIdx].items.filter((_, i) => i !== iIdx) };
      next[sIdx] = sec;
      return next;
    });
  }, []);
  const addItem = useCallback((sIdx) => {
    setSections((prev) => {
      const next = prev.slice();
      const sec = { ...next[sIdx], items: next[sIdx].items.slice() };
      sec.items.push({ itemRef: '', description: 'New item', unit: 'no', qty: 1, rate: 0, labour: 0, materials: 0, total: 0 });
      next[sIdx] = sec;
      return next;
    });
  }, []);
  const resetEdits = useCallback(() => {
    setSections(JSON.parse(JSON.stringify(originalSections)));
  }, [originalSections]);

  // Per-section subtotals (live)
  const sectionTotals = useMemo(
    () => sections.map((s) => s.items.reduce(
      (acc, it) => ({
        labour: acc.labour + num(it.labour),
        materials: acc.materials + num(it.materials),
        total: acc.total + num(it.labour) + num(it.materials),
      }),
      { labour: 0, materials: 0, total: 0 }
    )),
    [sections]
  );

  // ─── Builder tab calculations ────────────────────────────────────────────
  const labourMult = 1 + builderMargin / 100;
  const matMult = 1 + builderMargin / 100 + materialsMarkup / 100;
  const builderRows = useMemo(
    () => sections.map((s, i) => ({
      number: s.number, title: s.title, item_count: s.items.length,
      labour: sectionTotals[i].labour * labourMult,
      materials: sectionTotals[i].materials * matMult,
      total: sectionTotals[i].labour * labourMult + sectionTotals[i].materials * matMult,
    })),
    [sections, sectionTotals, labourMult, matMult]
  );
  const builderGrand = builderRows.reduce(
    (a, r) => ({ labour: a.labour + r.labour, materials: a.materials + r.materials, total: a.total + r.total }),
    { labour: 0, materials: 0, total: 0 }
  );

  // ─── Client tab calculations ─────────────────────────────────────────────
  const clientRows = useMemo(
    () => sections.map((s, i) => {
      const sectionOhp = Object.prototype.hasOwnProperty.call(perTradeOhp, s.number)
        ? num(perTradeOhp[s.number])
        : defaultOhp;
      const base = sectionTotals[i].total;
      const subtotal = roundMoney(rounding, base * (1 + sectionOhp / 100));
      return { number: s.number, title: s.title, item_count: s.items.length, ohp: sectionOhp, base, subtotal };
    }),
    [sections, sectionTotals, perTradeOhp, defaultOhp, rounding]
  );
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
  function editsForBody() {
    return sections.map((s) => ({
      number: s.number, title: s.title,
      items: s.items.map((it) => ({
        itemRef: it.itemRef, description: it.description, unit: it.unit,
        qty: num(it.qty), labour: num(it.labour), materials: num(it.materials),
      })),
    }));
  }

  async function downloadBuilderPack() {
    setDownloading(true); setError('');
    try {
      const token = getToken();
      const resp = await fetch(`/api/projects/${id}/builder-pack`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          builder_margin: builderMargin,
          materials_markup: materialsMarkup,
          edited_sections: editsForBody(),
        }),
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
      const resp = await fetch(`/api/projects/${id}/client-copy-pro`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contingency, default_ohp: defaultOhp, vat,
          per_trade_ohp: perTradeOhp,
          prelims_amount: prelimsMode === 'flat' ? prelimsAmount : 0,
          prelims_pct:    prelimsMode === 'pct'  ? prelimsPct    : 0,
          day_rate: dayRateOn ? dayRate : null,
          rounding,
          edited_sections: editsForBody(),
        }),
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

  const totalItemCount = sections.reduce((a, s) => a + s.items.length, 0);
  const isDirty = useMemo(() =>
    JSON.stringify(sections) !== JSON.stringify(originalSections),
    [sections, originalSections]
  );

  return (
    <div style={{ padding: '20px 24px 60px', maxWidth: 1480, margin: '0 auto' }}>
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
            {project.title} · {project.project_type} · {totalItemCount} item{totalItemCount === 1 ? '' : 's'} across {sections.length} trade{sections.length === 1 ? '' : 's'}
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
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '8px 18px', borderRadius: 7, fontSize: 13, fontWeight: 700,
              background: tab === t.key ? (t.key === 'builder' ? '#F59E0B' : '#A855F7') : 'transparent',
              color: tab === t.key ? (t.key === 'builder' ? '#0A0F1C' : '#fff') : 'var(--text-muted)',
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

      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 360px) 1fr', gap: 18, alignItems: 'flex-start' }}>
          {/* Sticky control sidebar */}
          <div style={{
            position: 'sticky', top: 12,
            padding: 18, borderRadius: 12,
            background: 'var(--card-bg)', border: '1px solid var(--border)',
            maxHeight: 'calc(100vh - 40px)', overflowY: 'auto',
          }}>
            {tab === 'builder' ? (
              <BuilderControls
                builderMargin={builderMargin} setBuilderMargin={setBuilderMargin}
                materialsMarkup={materialsMarkup} setMaterialsMarkup={setMaterialsMarkup}
                onDownload={downloadBuilderPack} downloading={downloading}
                disabled={builderRows.length === 0}
                isDirty={isDirty} onReset={resetEdits}
              />
            ) : (
              <ClientControls
                defaultOhp={defaultOhp} setDefaultOhp={setDefaultOhp}
                contingency={contingency} setContingency={setContingency}
                vat={vat} setVat={setVat}
                rounding={rounding} setRounding={setRounding}
                prelimsMode={prelimsMode} setPrelimsMode={setPrelimsMode}
                prelimsAmount={prelimsAmount} setPrelimsAmount={setPrelimsAmount}
                prelimsPct={prelimsPct} setPrelimsPct={setPrelimsPct}
                dayRateOn={dayRateOn} setDayRateOn={setDayRateOn}
                dayRate={dayRate} setDayRate={setDayRate}
                perTradeOhp={perTradeOhp} setPerTradeOhp={setPerTradeOhp}
                sections={sections} sym={sym}
                onDownload={downloadClientCopy} downloading={downloading}
                disabled={clientRows.length === 0}
                isDirty={isDirty} onReset={resetEdits}
              />
            )}
          </div>

          {/* Main: editable items + previews */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Editable items */}
            <div style={{
              padding: 18, borderRadius: 12,
              background: 'var(--card-bg)', border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Line items (editable)</h2>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Edit description, qty, labour or materials. Rates and totals recompute automatically.
                </span>
              </div>

              {sections.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                  No priced sections found in this BOQ.
                </div>
              )}

              {sections.map((s, sIdx) => {
                const open = !!openSectionIds[s.number];
                const t = sectionTotals[sIdx];
                return (
                  <div key={s.number + '-' + sIdx} style={{
                    borderRadius: 10, border: '1px solid var(--border)',
                    marginTop: 10, overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', background: 'rgba(27,42,74,0.06)',
                    }}>
                      <button
                        onClick={() => setOpenSectionIds((m) => ({ ...m, [s.number]: !m[s.number] }))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)' }}
                        aria-label={open ? 'Collapse' : 'Expand'}
                      >{open ? '▾' : '▸'}</button>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-muted)', minWidth: 28 }}>{s.number}</span>
                      <input
                        value={s.title}
                        onChange={(e) => updateSectionTitle(sIdx, e.target.value)}
                        style={{
                          flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700,
                          background: 'transparent', border: 'none', color: 'var(--text-primary)',
                          padding: '3px 4px', outline: 'none',
                        }}
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.items.length} item{s.items.length === 1 ? '' : 's'}</span>
                      <span style={{ fontSize: 12.5, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--text-primary)', minWidth: 90, textAlign: 'right' }}>
                        {fmt(sym, t.total)}
                      </span>
                    </div>

                    {open && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 }}>
                          <thead>
                            <tr style={{ background: 'var(--bg)', color: 'var(--text-muted)', textAlign: 'left' }}>
                              <th style={th(70)}>Ref</th>
                              <th style={th()}>Description</th>
                              <th style={th(70)}>Unit</th>
                              <th style={{ ...th(70), textAlign: 'right' }}>Qty</th>
                              <th style={{ ...th(100), textAlign: 'right' }}>Labour</th>
                              <th style={{ ...th(100), textAlign: 'right' }}>Materials</th>
                              <th style={{ ...th(100), textAlign: 'right' }}>Total</th>
                              <th style={th(36)}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.items.map((it, iIdx) => {
                              const total = num(it.labour) + num(it.materials);
                              return (
                                <tr key={iIdx} style={{ borderTop: '1px solid var(--border)' }}>
                                  <td style={td()}>
                                    <input value={it.itemRef || ''} onChange={(e) => updateItem(sIdx, iIdx, { itemRef: e.target.value })}
                                      style={{ ...inputCell, fontFamily: 'JetBrains Mono, monospace' }} />
                                  </td>
                                  <td style={td()}>
                                    <textarea value={it.description || ''} onChange={(e) => updateItem(sIdx, iIdx, { description: e.target.value })}
                                      rows={1}
                                      style={{ ...inputCell, resize: 'vertical', minHeight: 26, fontFamily: 'inherit' }} />
                                  </td>
                                  <td style={td()}>
                                    <input value={it.unit || ''} onChange={(e) => updateItem(sIdx, iIdx, { unit: e.target.value })}
                                      style={{ ...inputCell, textAlign: 'center' }} />
                                  </td>
                                  <td style={td()}>
                                    <input type="number" step="0.01" value={it.qty}
                                      onChange={(e) => updateItem(sIdx, iIdx, { qty: e.target.value })}
                                      style={{ ...inputCell, textAlign: 'right' }} />
                                  </td>
                                  <td style={td()}>
                                    <input type="number" step="0.01" value={it.labour}
                                      onChange={(e) => updateItem(sIdx, iIdx, { labour: e.target.value })}
                                      style={{ ...inputCell, textAlign: 'right', color: '#3B82F6' }} />
                                  </td>
                                  <td style={td()}>
                                    <input type="number" step="0.01" value={it.materials}
                                      onChange={(e) => updateItem(sIdx, iIdx, { materials: e.target.value })}
                                      style={{ ...inputCell, textAlign: 'right', color: '#A855F7' }} />
                                  </td>
                                  <td style={{ ...td(), textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                                    {fmt(sym, total, 2)}
                                  </td>
                                  <td style={td()}>
                                    <button
                                      onClick={() => removeItem(sIdx, iIdx)}
                                      title="Remove item"
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14 }}
                                    >×</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg)' }}>
                          <button
                            onClick={() => addItem(sIdx)}
                            style={{
                              background: 'none', border: '1px dashed var(--border)',
                              borderRadius: 6, padding: '5px 10px',
                              fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                              color: 'var(--text-muted)',
                            }}
                          >+ Add item</button>
                          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                            Subtotal: <strong style={{ color: 'var(--text-primary)' }}>{fmt(sym, t.total, 2)}</strong>
                            {' '}<span style={{ color: '#3B82F6' }}>· L {fmt(sym, t.labour)}</span>
                            {' '}<span style={{ color: '#A855F7' }}>· M {fmt(sym, t.materials)}</span>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Live preview */}
            <div style={{
              padding: 18, borderRadius: 12,
              background: 'var(--card-bg)', border: '1px solid var(--border)',
            }}>
              {tab === 'builder'
                ? <BuilderPreview rows={builderRows} totals={builderGrand} sym={sym} />
                : <ClientPreview rows={clientRows} sym={sym}
                    summaryLines={summaryLines} exVat={exVat} vat={vat} vatVal={vatVal} inclVat={inclVat}
                    branding={branding} logoUrl={logoUrl} projectName={project ? project.title : ''} />
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

const inputCell = {
  width: '100%',
  padding: '4px 6px', borderRadius: 5,
  background: 'transparent', color: 'var(--text-primary)',
  border: '1px solid transparent', fontSize: 12, outline: 'none',
  boxSizing: 'border-box',
};
const th = (w) => ({
  padding: '8px 10px', fontSize: 10.5, fontWeight: 700,
  letterSpacing: '0.04em', textTransform: 'uppercase',
  width: w || 'auto', whiteSpace: 'nowrap',
});
const td = () => ({ padding: '4px 8px', verticalAlign: 'top' });

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

function ResetRow({ isDirty, onReset }) {
  if (!isDirty) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '7px 10px', borderRadius: 7,
      background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
      marginBottom: 12,
    }}>
      <span style={{ fontSize: 11.5, color: '#F59E0B', fontWeight: 600 }}>You've edited line items</span>
      <button onClick={onReset}
        style={{ background: 'none', border: '1px solid rgba(245,158,11,0.35)', color: '#F59E0B', borderRadius: 5, padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
      >Reset</button>
    </div>
  );
}

function BuilderControls({
  builderMargin, setBuilderMargin, materialsMarkup, setMaterialsMarkup,
  onDownload, downloading, disabled, isDirty, onReset,
}) {
  return (
    <>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>Builder margins</h3>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
        Add your blanket margin on every line, plus an extra uplift on materials only.
      </p>
      <ResetRow isDirty={isDirty} onReset={onReset} />
      <Slider label="Builder margin (all rates)" value={builderMargin} onChange={setBuilderMargin} max={40} hint="Applies to labour and materials" />
      <Slider label="Materials markup (extra)" value={materialsMarkup} onChange={setMaterialsMarkup} max={40} hint="Stacks on top of builder margin, materials only" />
      <button onClick={onDownload} disabled={downloading || disabled} style={primaryBtn('#F59E0B', downloading || disabled)}>
        {downloading ? 'Generating…' : 'Download Builder Pack (3 tabs)'}
      </button>
      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '8px 0 0', textAlign: 'center' }}>
        Trade Summary · Materials Schedule · Labour Schedule
      </p>
    </>
  );
}

function ClientControls({
  defaultOhp, setDefaultOhp, contingency, setContingency, vat, setVat,
  rounding, setRounding, prelimsMode, setPrelimsMode,
  prelimsAmount, setPrelimsAmount, prelimsPct, setPrelimsPct,
  dayRateOn, setDayRateOn, dayRate, setDayRate,
  perTradeOhp, setPerTradeOhp, sections, sym,
  onDownload, downloading, disabled, isDirty, onReset,
}) {
  return (
    <>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px' }}>Client copy controls</h3>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
        What the client sees. No margin shown separately — uplift is baked into rates.
      </p>
      <ResetRow isDirty={isDirty} onReset={onReset} />

      <Slider label="Default OH&P" value={defaultOhp} onChange={setDefaultOhp} max={30} hint="Applied unless a trade is overridden below" />
      <Slider label="Contingency" value={contingency} onChange={setContingency} max={20} hint="% of construction net — separate summary line" />
      <Slider label="VAT" value={vat} onChange={setVat} max={25} hint="Set 0 if quoting ex-VAT" />

      <Field label="Rounding">
        <select value={rounding} onChange={(e) => setRounding(parseInt(e.target.value, 10))} style={selectStyle}>
          {ROUNDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      <Field label="Preliminaries">
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {[{ v: 'off', l: 'Off' }, { v: 'flat', l: 'Flat £' }, { v: 'pct', l: '% of net' }].map((o) => (
            <button key={o.v} onClick={() => setPrelimsMode(o.v)}
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
          <input type="number" min="0" step="50" value={prelimsAmount}
            onChange={(e) => setPrelimsAmount(parseFloat(e.target.value) || 0)}
            placeholder="e.g. 2500" style={inputStyle} />
        )}
        {prelimsMode === 'pct' && (
          <input type="number" min="0" max="20" step="0.5" value={prelimsPct}
            onChange={(e) => setPrelimsPct(parseFloat(e.target.value) || 0)}
            placeholder="e.g. 5" style={inputStyle} />
        )}
      </Field>

      <Field label={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Day-rate / mgmt
          <input type="checkbox" checked={dayRateOn} onChange={(e) => setDayRateOn(e.target.checked)} style={{ accentColor: '#A855F7' }} />
        </span>
      }>
        {dayRateOn && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input type="text" value={dayRate.label}
              onChange={(e) => setDayRate((d) => ({ ...d, label: e.target.value }))}
              placeholder="Label (e.g. Site management)" style={inputStyle} />
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" min="0" step="0.5" value={dayRate.days}
                onChange={(e) => setDayRate((d) => ({ ...d, days: parseFloat(e.target.value) || 0 }))}
                placeholder="Days" style={{ ...inputStyle, flex: 1 }} />
              <input type="number" min="0" step="25" value={dayRate.rate_per_day}
                onChange={(e) => setDayRate((d) => ({ ...d, rate_per_day: parseFloat(e.target.value) || 0 }))}
                placeholder={`${sym}/day`} style={{ ...inputStyle, flex: 1 }} />
            </div>
          </div>
        )}
      </Field>

      <details style={{ marginBottom: 12 }}>
        <summary style={{ fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '6px 0' }}>
          Per-trade OH&P override ({Object.keys(perTradeOhp).length})
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {sections.map((s) => {
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
                <input type="number" min="0" max="50" step="0.5"
                  value={has ? perTradeOhp[s.number] : ''} placeholder={defaultOhp + '%'}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPerTradeOhp((m) => {
                      const next = { ...m };
                      if (v === '' || v == null) delete next[s.number];
                      else next[s.number] = parseFloat(v) || 0;
                      return next;
                    });
                  }}
                  style={{ ...inputStyle, width: 60, padding: '4px 6px', fontSize: 11 }} />
                {has && (
                  <button onClick={() => setPerTradeOhp((m) => { const n = { ...m }; delete n[s.number]; return n; })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}
                    aria-label="Reset">×</button>
                )}
              </div>
            );
          })}
        </div>
      </details>

      <button onClick={onDownload} disabled={downloading || disabled} style={primaryBtn('#A855F7', downloading || disabled, '#fff')}>
        {downloading ? 'Generating…' : 'Download Client Copy'}
      </button>
    </>
  );
}

function Slider({ label, value, onChange, max, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#A855F7' }}>{value}%</span>
      </div>
      <input type="range" min="0" max={max} step="0.5" value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#A855F7' }} />
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
    </>
  );
}

function ClientPreview({ rows, sym, summaryLines, exVat, vat, vatVal, inclVat, branding, logoUrl, projectName }) {
  const primary = (branding && branding.primary_colour) || '#1B2A4A';
  const accent  = (branding && branding.accent_colour)  || '#A855F7';
  const company = branding && branding.company_name;

  return (
    <>
      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>Client copy preview</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px' }}>
        Reflects your branding from{' '}
        <a href="/branding" style={{ color: accent, fontWeight: 600 }}>/branding</a>.
      </p>

      {/* Branded cover band */}
      <div style={{
        borderRadius: 10, overflow: 'hidden', marginBottom: 14,
        background: '#fff', boxShadow: '0 4px 18px rgba(0,0,0,0.08)',
      }}>
        <div style={{
          background: primary, color: '#fff',
          padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14,
          borderBottom: '4px solid ' + accent,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 8, flexShrink: 0,
            background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}>
            {logoUrl
              ? <img src={logoUrl} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              : <span style={{ fontSize: 9, color: '#888' }}>No logo</span>
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, opacity: 0.7, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Bill of Quantities · Client Copy
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, marginTop: 2, color: '#fff' }}>
              {projectName || 'Project'}
            </div>
            {company && <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>Issued by {company}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9.5, opacity: 0.7, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Total ex-VAT</div>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', color: accent }}>
              {fmt(sym, exVat)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ ...previewHeaderStyle, gridTemplateColumns: '32px 1fr 80px 110px', background: primary, color: '#fff' }}>
          <div>#</div><div>Trade</div>
          <div style={{ textAlign: 'right' }}>OH&P</div>
          <div style={{ textAlign: 'right' }}>Sub-total</div>
        </div>
        {rows.map((s, i) => (
          <div key={s.number + '-' + i} style={{ ...previewRowStyle, gridTemplateColumns: '32px 1fr 80px 110px' }}>
            <div style={{ color: 'var(--text-muted)' }}>{i + 1}</div>
            <div style={{ fontWeight: 500 }}>{s.title}<span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginLeft: 8 }}>{s.item_count} items</span></div>
            <div style={moneyCell(accent)}>{s.ohp}%</div>
            <div style={{ ...moneyCell(), fontWeight: 600 }}>{fmt(sym, s.subtotal)}</div>
          </div>
        ))}
      </div>

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
