import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch, getToken, getEstimatorKey } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';

// Two-mode page:
//   /estimator/new          — input flow -> draft -> edit -> save
//   /estimator/quote/:id    — load saved quote -> edit -> save changes
// The editor UI is the same in both modes.

const PROJECT_TYPES = [
  'extension', 'loft conversion', 'renovation', 'bathroom', 'kitchen',
  'new build', 'commercial fit-out', 'other',
];

function fmtMoney(n, currency) {
  const sym = currency === 'EUR' ? '€' : '£';
  const v = Number(n) || 0;
  return sym + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export default function EstimatorBuilderPage() {
  return <EstimatorGate><EstimatorBuilderPageInner /></EstimatorGate>;
}

function EstimatorBuilderPageInner() {
  const { id } = useParams();
  const isNew = !id;
  const { t } = useTheme();
  const { user } = useAuth();
  const nav = useNavigate();

  // Input phase
  const [inputMode, setInputMode] = useState('describe'); // 'describe' | 'form'
  const [inputText, setInputText] = useState('');
  const [projectType, setProjectType] = useState('extension');
  const [formSize, setFormSize] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [currency, setCurrency] = useState('GBP');
  const [vatPct, setVatPct] = useState(20);
  const [ohpPct, setOhpPct] = useState(15);
  const [contPct, setContPct] = useState(5);
  const [targetMarginPct, setTargetMarginPct] = useState(15);

  const [phase, setPhase] = useState(isNew ? 'input' : 'loading'); // input | drafting | pricing | ready | loading | error
  const [phaseMsg, setPhaseMsg] = useState('');
  const [error, setError] = useState('');

  // Quote being edited
  const [quoteId, setQuoteId] = useState(id || null);
  const [quoteNumber, setQuoteNumber] = useState('');
  const [status, setStatus] = useState('draft');
  const [clientName, setClientName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  // Load existing quote
  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const r = await apiFetch('/estimator/quotes/' + id);
        const q = r.quote;
        setQuoteId(q.id);
        setQuoteNumber(q.quote_number || '');
        setClientName(q.client_name || '');
        setProjectName(q.project_name || '');
        setProjectType(q.project_type || '');
        setCurrency(q.currency || 'GBP');
        setOhpPct(num(q.ohp_pct));
        setContPct(num(q.contingency_pct));
        setVatPct(num(q.vat_pct));
        setTargetMarginPct(num(q.target_margin_pct));
        setStatus(q.status || 'draft');
        setNotes(q.notes || '');
        setLines((r.lines || []).map(l => ({ ...l, est_rate: !!l.est_rate })));
        setPhase('ready');
      } catch (e) {
        setError(e.message);
        setPhase('error');
      }
    })();
  }, [id, isNew]);

  // Recompute totals client-side as the builder edits
  const totals = useMemo(() => {
    let net = 0;
    for (const ln of lines) net += num(ln.qty) * num(ln.rate);
    const ohp = net * (num(ohpPct) / 100);
    const cont = (net + ohp) * (num(contPct) / 100);
    const beforeVat = net + ohp + cont;
    const vat = beforeVat * (num(vatPct) / 100);
    const grand = beforeVat + vat;
    const margin = (net + ohp) > 0 ? (ohp / (net + ohp)) * 100 : 0;
    return {
      net, ohp, cont, vat, grand, margin,
      target: num(targetMarginPct),
      marginBelow: num(targetMarginPct) > 0 && margin < num(targetMarginPct),
    };
  }, [lines, ohpPct, contPct, vatPct, targetMarginPct]);

  // Group lines by section for rendering
  const sections = useMemo(() => {
    const grouped = {};
    const order = [];
    lines.forEach((ln, idx) => {
      const s = ln.section || 'General';
      if (!grouped[s]) { grouped[s] = []; order.push(s); }
      grouped[s].push({ ...ln, _idx: idx });
    });
    return { grouped, order };
  }, [lines]);

  // ─── Generate draft from input ────────────────────────────────────────────
  const generate = async () => {
    setError('');
    let payloadText = inputText.trim();
    if (inputMode === 'form') {
      const parts = [];
      parts.push('Project type: ' + projectType);
      if (formSize) parts.push('Approximate size: ' + formSize);
      if (formLocation) parts.push('Location: ' + formLocation);
      if (formNotes) parts.push('Notes: ' + formNotes);
      payloadText = parts.join('. ');
    }
    if (payloadText.length < 10) {
      setError('Please describe the job in a bit more detail.');
      return;
    }
    setPhase('drafting');
    setPhaseMsg('AI is drafting your quote…');
    try {
      const r = await apiFetch('/estimator/draft', {
        method: 'POST',
        body: JSON.stringify({
          input_text: payloadText,
          project_type: projectType,
          currency,
          ohp_pct: ohpPct,
          contingency_pct: contPct,
          vat_pct: vatPct,
          target_margin_pct: targetMarginPct,
        }),
      });
      setPhase('pricing');
      setPhaseMsg('Pricing from rate library…');
      setClientName(r.client_name || '');
      setProjectName(r.project_name || '');
      setLines((r.lines || []).map(l => ({ ...l, est_rate: !!l.est_rate })));
      // Small visual pause so the user sees the "pricing" step
      setTimeout(() => setPhase('ready'), 400);
    } catch (e) {
      setError(e.message || 'Failed to draft quote');
      setPhase('input');
    }
  };

  // ─── Line edits ───────────────────────────────────────────────────────────
  const updateLine = (idx, patch) => {
    setLines(prev => prev.map((ln, i) => i === idx ? { ...ln, ...patch } : ln));
  };
  const deleteLine = (idx) => {
    setLines(prev => prev.filter((_, i) => i !== idx));
  };
  const addLine = (section) => {
    setLines(prev => [...prev, {
      section: section || 'General',
      item: '',
      description: '',
      unit: 'item',
      qty: 1,
      rate: 0,
      labour: 0,
      materials: 0,
      est_rate: true,
      sort_order: prev.length,
    }]);
  };

  // ─── Save / save changes ──────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (!quoteId) {
        const r = await apiFetch('/estimator/quotes', {
          method: 'POST',
          body: JSON.stringify({
            client_name: clientName,
            project_name: projectName || 'Untitled quote',
            project_type: projectType,
            currency,
            input_text: inputMode === 'describe' ? inputText : null,
            ohp_pct: ohpPct,
            contingency_pct: contPct,
            vat_pct: vatPct,
            target_margin_pct: targetMarginPct,
            status,
            notes,
            lines,
          }),
        });
        setQuoteId(r.id);
        setQuoteNumber(r.quote_number || '');
        setSavedAt(new Date());
        // Move to the saved URL so reload works.
        nav('/estimator/quote/' + r.id, { replace: true });
      } else {
        await apiFetch('/estimator/quotes/' + quoteId, {
          method: 'PATCH',
          body: JSON.stringify({
            client_name: clientName,
            project_name: projectName,
            project_type: projectType,
            currency,
            ohp_pct: ohpPct,
            contingency_pct: contPct,
            vat_pct: vatPct,
            target_margin_pct: targetMarginPct,
            status,
            notes,
          }),
        });
        await apiFetch('/estimator/quotes/' + quoteId + '/lines', {
          method: 'PUT',
          body: JSON.stringify({ lines }),
        });
        setSavedAt(new Date());
      }
    } catch (e) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const download = (kind) => {
    if (!quoteId) { alert('Save the quote first.'); return; }
    const url = '/api/estimator/quotes/' + quoteId + '/' + kind;
    fetch(url, { headers: { Authorization: 'Bearer ' + getToken(), 'x-estimator-key': getEstimatorKey() } })
      .then(r => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (quoteNumber || 'quote') + '.' + kind;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(e => alert(e.message));
  };

  if (!user?.hasEstimator && user?.role !== 'admin') {
    return (
      <div style={{ padding: 32, color: t.text }}>
        <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center', color: t.textSecondary }}>
          The estimator add-on isn't enabled on this account.
        </div>
      </div>
    );
  }

  if (phase === 'loading') {
    return <div style={{ padding: 40, color: t.textSecondary, textAlign: 'center' }}>Loading…</div>;
  }

  // ─── Input phase (only when starting fresh) ──────────────────────────────
  if (phase === 'input' || phase === 'drafting' || phase === 'pricing') {
    const busy = phase === 'drafting' || phase === 'pricing';
    return (
      <div style={{ padding: 24, color: t.text, maxWidth: 880, margin: '0 auto' }}>
        <div style={{ marginBottom: 16 }}>
          <button onClick={() => nav('/estimator')} style={btnLink(t)}>← Quotes</button>
        </div>
        <h1 style={{ margin: '0 0 6px 0', fontSize: 24 }}>New quote</h1>
        <div style={{ color: t.textSecondary, fontSize: 14, marginBottom: 20 }}>
          Describe the job, or fill in a few fields. We'll draft an itemised quote in seconds.
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'inline-flex', background: t.surface, border: '1px solid ' + t.border, borderRadius: 8, padding: 4, marginBottom: 16 }}>
          <ToggleBtn t={t} active={inputMode === 'describe'} onClick={() => setInputMode('describe')}>Describe the job</ToggleBtn>
          <ToggleBtn t={t} active={inputMode === 'form'} onClick={() => setInputMode('form')}>Quick form</ToggleBtn>
        </div>

        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20, marginBottom: 16 }}>
          {inputMode === 'describe' ? (
            <>
              <label style={lbl(t)}>Describe the job</label>
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder="e.g. Single-storey kitchen extension, 5m x 4m, brick & block walls, pitched tiled roof, internal fit-out, plumbing, electrics, decorating."
                rows={5}
                style={txtarea(t)}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                <div>
                  <label style={lbl(t)}>Project type</label>
                  <select value={projectType} onChange={e => setProjectType(e.target.value)} style={input(t)}>
                    {PROJECT_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl(t)}>Currency</label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} style={input(t)}>
                    <option value="GBP">GBP (£)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl(t)}>Project type</label>
                  <select value={projectType} onChange={e => setProjectType(e.target.value)} style={input(t)}>
                    {PROJECT_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl(t)}>Currency</label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} style={input(t)}>
                    <option value="GBP">GBP (£)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
                <div>
                  <label style={lbl(t)}>Rough size</label>
                  <input value={formSize} onChange={e => setFormSize(e.target.value)} placeholder="e.g. 5m x 4m, 25 m²" style={input(t)} />
                </div>
                <div>
                  <label style={lbl(t)}>Location</label>
                  <input value={formLocation} onChange={e => setFormLocation(e.target.value)} placeholder="e.g. Bristol" style={input(t)} />
                </div>
              </div>
              <label style={lbl(t)}>Notes (optional)</label>
              <textarea
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
                placeholder="Anything specific — materials, finishes, target spec level"
                rows={3}
                style={txtarea(t)}
              />
            </>
          )}
        </div>

        {/* Build-up settings */}
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ color: t.textSecondary, fontSize: 13, marginBottom: 12 }}>Quote build-up</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <PctField t={t} label="OH&P %" value={ohpPct} onChange={setOhpPct} />
            <PctField t={t} label="Contingency %" value={contPct} onChange={setContPct} />
            <PctField t={t} label="VAT %" value={vatPct} onChange={setVatPct} />
            <PctField t={t} label="Target margin %" value={targetMarginPct} onChange={setTargetMarginPct} />
          </div>
        </div>

        {error && <div style={errBox(t)}>{error}</div>}

        <button
          onClick={generate}
          disabled={busy}
          style={{
            background: busy ? t.surface : t.accent, color: '#fff', border: 'none', borderRadius: 8,
            padding: '12px 22px', fontSize: 15, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? phaseMsg : 'Generate quote →'}
        </button>

        {busy && <PhaseStrip t={t} phase={phase} />}
      </div>
    );
  }

  // ─── Editor (ready phase) ────────────────────────────────────────────────
  return (
    <div style={{ padding: 24, color: t.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <button onClick={() => nav('/estimator')} style={btnLink(t)}>← Quotes</button>
          <h1 style={{ margin: '6px 0 4px 0', fontSize: 24 }}>
            {quoteNumber ? quoteNumber + ' — ' : ''}{projectName || 'Untitled quote'}
          </h1>
          {savedAt && (
            <div style={{ color: t.success, fontSize: 12 }}>Saved at {savedAt.toLocaleTimeString('en-GB')}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={save} disabled={saving} style={btnPrimary(t, saving)}>{saving ? 'Saving…' : (quoteId ? 'Save changes' : 'Save quote')}</button>
          <button onClick={() => download('pdf')} disabled={!quoteId} style={btnSecondary(t, !quoteId)}>Download PDF</button>
          <button onClick={() => download('xlsx')} disabled={!quoteId} style={btnSecondary(t, !quoteId)}>Download Excel</button>
        </div>
      </div>

      {error && <div style={errBox(t)}>{error}</div>}

      {/* Header fields */}
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div>
            <label style={lbl(t)}>Client name</label>
            <input value={clientName} onChange={e => setClientName(e.target.value)} style={input(t)} placeholder="e.g. Mr & Mrs Smith" />
          </div>
          <div>
            <label style={lbl(t)}>Project name</label>
            <input value={projectName} onChange={e => setProjectName(e.target.value)} style={input(t)} placeholder="e.g. Kitchen extension" />
          </div>
          <div>
            <label style={lbl(t)}>Project type</label>
            <select value={projectType || ''} onChange={e => setProjectType(e.target.value)} style={input(t)}>
              {PROJECT_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl(t)}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={input(t)}>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          </div>
          <div>
            <label style={lbl(t)}>Currency</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)} style={input(t)}>
              <option value="GBP">GBP (£)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Build-up */}
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ color: t.textSecondary, fontSize: 13, marginBottom: 12 }}>Build-up</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <PctField t={t} label="OH&P %" value={ohpPct} onChange={setOhpPct} />
          <PctField t={t} label="Contingency %" value={contPct} onChange={setContPct} />
          <PctField t={t} label="VAT %" value={vatPct} onChange={setVatPct} />
          <PctField t={t} label="Target margin %" value={targetMarginPct} onChange={setTargetMarginPct} />
        </div>
      </div>

      {/* Lines */}
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
          <thead>
            <tr style={{ background: t.surface, fontSize: 12, color: t.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              <th style={{ ...th, width: '38%' }}>Item / description</th>
              <th style={{ ...th, width: 70, textAlign: 'right' }}>Qty</th>
              <th style={{ ...th, width: 80 }}>Unit</th>
              <th style={{ ...th, width: 110, textAlign: 'right' }}>Rate</th>
              <th style={{ ...th, width: 110, textAlign: 'right' }}>Total</th>
              <th style={{ ...th, width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {sections.order.map(sec => (
              <React.Fragment key={sec}>
                <tr>
                  <td colSpan={6} style={{ background: t.surface, padding: '8px 14px', color: t.text, fontWeight: 700, fontSize: 13, borderTop: '2px solid ' + t.border }}>{sec}</td>
                </tr>
                {sections.grouped[sec].map(ln => {
                  const idx = ln._idx;
                  const lineTotal = num(ln.qty) * num(ln.rate);
                  return (
                    <tr key={idx} style={{ borderTop: '1px solid ' + t.border }}>
                      <td style={tdCell}>
                        <input value={ln.item || ''} onChange={e => updateLine(idx, { item: e.target.value })} placeholder="Item" style={inputInline(t, true)} />
                        <input value={ln.description || ''} onChange={e => updateLine(idx, { description: e.target.value })} placeholder="Description" style={inputInline(t)} />
                      </td>
                      <td style={{ ...tdCell, textAlign: 'right' }}>
                        <input type="number" step="any" value={ln.qty} onChange={e => updateLine(idx, { qty: e.target.value })} style={inputNum(t)} />
                      </td>
                      <td style={tdCell}>
                        <input value={ln.unit || ''} onChange={e => updateLine(idx, { unit: e.target.value })} style={inputInline(t)} />
                      </td>
                      <td style={{ ...tdCell, textAlign: 'right' }}>
                        <input
                          type="number" step="any"
                          value={ln.rate}
                          onChange={e => updateLine(idx, { rate: e.target.value, est_rate: false })}
                          style={{ ...inputNum(t), color: ln.est_rate ? t.warning : t.text, borderColor: ln.est_rate ? t.warning + '55' : t.border }}
                          title={ln.est_rate ? 'AI estimated rate — no library match. Edit to confirm.' : ''}
                        />
                        {ln.est_rate && <div style={{ fontSize: 10, color: t.warning, marginTop: 2 }}>est</div>}
                      </td>
                      <td style={{ ...tdCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(lineTotal, currency)}</td>
                      <td style={{ ...tdCell, textAlign: 'center' }}>
                        <button onClick={() => deleteLine(idx)} title="Delete line" style={{ background: 'transparent', border: 'none', color: t.danger, cursor: 'pointer', fontSize: 16 }}>×</button>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={6} style={{ padding: '6px 14px', borderTop: '1px solid ' + t.border }}>
                    <button onClick={() => addLine(sec)} style={btnGhost(t)}>+ Add line to {sec}</button>
                  </td>
                </tr>
              </React.Fragment>
            ))}
            <tr>
              <td colSpan={6} style={{ padding: 12, borderTop: '1px solid ' + t.border }}>
                <button onClick={() => addLine('General')} style={btnGhost(t)}>+ Add new section line</button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, marginBottom: 16, alignItems: 'start' }}>
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
          <label style={lbl(t)}>Notes / terms</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={5} style={txtarea(t)} placeholder="Payment terms, exclusions, etc. (appears on the PDF)" />
        </div>
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
          <SummaryRow t={t} label="Net" value={fmtMoney(totals.net, currency)} />
          <SummaryRow t={t} label={'OH&P (' + num(ohpPct).toFixed(1) + '%)'} value={fmtMoney(totals.ohp, currency)} />
          <SummaryRow t={t} label={'Contingency (' + num(contPct).toFixed(1) + '%)'} value={fmtMoney(totals.cont, currency)} />
          <SummaryRow t={t} label={'VAT (' + num(vatPct).toFixed(1) + '%)'} value={fmtMoney(totals.vat, currency)} />
          <div style={{ borderTop: '1px solid ' + t.border, margin: '8px 0' }} />
          <SummaryRow t={t} label="Grand Total" value={fmtMoney(totals.grand, currency)} bold />
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: totals.marginBelow ? t.warningBg : t.successBg, color: totals.marginBelow ? t.warning : t.success, fontSize: 13 }}>
            Margin: {totals.margin.toFixed(1)}% (target {num(targetMarginPct).toFixed(1)}%)
            {totals.marginBelow && ' — below target'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Small components ──────────────────────────────────────────────────────

function PhaseStrip({ t, phase }) {
  const steps = [
    { key: 'drafting', label: 'Drafting' },
    { key: 'pricing', label: 'Pricing' },
    { key: 'ready', label: 'Ready' },
  ];
  return (
    <div style={{ marginTop: 18, display: 'flex', gap: 6 }}>
      {steps.map((s) => {
        const reached = (phase === 'drafting' && s.key === 'drafting')
          || (phase === 'pricing' && s.key !== 'ready')
          || (phase === 'ready');
        return (
          <div key={s.key} style={{
            flex: 1, padding: '6px 10px', borderRadius: 6, textAlign: 'center', fontSize: 12,
            background: reached ? t.accent : t.surface,
            color: reached ? '#fff' : t.textMuted,
            border: '1px solid ' + (reached ? t.accent : t.border),
          }}>{s.label}</div>
        );
      })}
    </div>
  );
}

function SummaryRow({ t, label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontWeight: bold ? 700 : 400, fontSize: bold ? 16 : 14, color: t.text }}>
      <div style={{ color: bold ? t.text : t.textSecondary }}>{label}</div>
      <div style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function PctField({ t, label, value, onChange }) {
  return (
    <div>
      <label style={lbl(t)}>{label}</label>
      <input
        type="number" step="any"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={input(t)}
      />
    </div>
  );
}

function ToggleBtn({ t, active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? t.accent : 'transparent',
      color: active ? '#fff' : t.text,
      border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer',
    }}>{children}</button>
  );
}

// ─── inline style helpers ──────────────────────────────────────────────────

const th = { padding: '10px 14px', textAlign: 'left', fontSize: 12 };
const tdCell = { padding: '8px 10px', fontSize: 13, verticalAlign: 'top' };
function lbl(t) { return { display: 'block', color: t.textSecondary, fontSize: 12, marginBottom: 4 }; }
function input(t) {
  return { width: '100%', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none', boxSizing: 'border-box' };
}
function inputInline(t, bold) {
  return { width: '100%', background: 'transparent', border: '1px solid transparent', color: t.text, borderRadius: 4, padding: '4px 6px', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontWeight: bold ? 600 : 400 };
}
function inputNum(t) {
  return { width: '100%', background: 'transparent', border: '1px solid ' + t.border, color: t.text, borderRadius: 4, padding: '4px 6px', fontSize: 13, textAlign: 'right', outline: 'none', boxSizing: 'border-box' };
}
function txtarea(t) {
  return { width: '100%', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '10px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' };
}
function errBox(t) {
  return { background: t.dangerBg, color: t.danger, padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 14 };
}
function btnGhost(t) {
  return { background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' };
}
function btnLink(t) {
  return { background: 'transparent', color: t.textSecondary, border: 'none', padding: 0, fontSize: 13, cursor: 'pointer' };
}
function btnPrimary(t, disabled) {
  return { background: disabled ? t.surface : t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.7 : 1 };
}
function btnSecondary(t, disabled) {
  return { background: 'transparent', color: disabled ? t.textMuted : t.text, border: '1px solid ' + t.border, borderRadius: 8, padding: '8px 14px', fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer' };
}
