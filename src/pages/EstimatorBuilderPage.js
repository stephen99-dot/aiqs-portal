import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch, getToken, getEstimatorKey } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import RateAutocomplete from '../components/RateAutocomplete';
import MaterialAutocomplete from '../components/MaterialAutocomplete';
import ShareLinkModal from '../components/ShareLinkModal';

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

// ─── Site-measurement element types ─────────────────────────────────────────
// Each element type defines its inputs and how the quantity is computed from them.
// The output is fed to the AI as structured measurements so prices are based on
// real numbers, not guesses.
const ELEMENT_TYPES = {
  floor_area: {
    label: 'Floor area', unit: 'm²',
    fields: [
      { key: 'length', label: 'Length (m)' },
      { key: 'width',  label: 'Width (m)' },
    ],
    compute: (d) => num(d.length) * num(d.width),
  },
  wall_area: {
    label: 'Wall area', unit: 'm²',
    fields: [
      { key: 'perimeter', label: 'Perimeter (m)' },
      { key: 'height',    label: 'Height (m)' },
    ],
    compute: (d) => num(d.perimeter) * num(d.height),
  },
  ceiling_area: {
    label: 'Ceiling area', unit: 'm²',
    fields: [
      { key: 'length', label: 'Length (m)' },
      { key: 'width',  label: 'Width (m)' },
    ],
    compute: (d) => num(d.length) * num(d.width),
  },
  roof_area: {
    label: 'Roof area', unit: 'm²',
    fields: [
      { key: 'length', label: 'Plan length (m)' },
      { key: 'width',  label: 'Plan width (m)' },
      { key: 'pitchFactor', label: 'Pitch factor (1.0 flat, 1.15 typical)' },
    ],
    compute: (d) => num(d.length) * num(d.width) * (num(d.pitchFactor) || 1),
  },
  linear: {
    label: 'Linear (m)', unit: 'm',
    fields: [
      { key: 'length', label: 'Length (m)' },
    ],
    compute: (d) => num(d.length),
  },
  volume: {
    label: 'Volume', unit: 'm³',
    fields: [
      { key: 'length', label: 'Length (m)' },
      { key: 'width',  label: 'Width (m)' },
      { key: 'depth',  label: 'Depth (m)' },
    ],
    compute: (d) => num(d.length) * num(d.width) * num(d.depth),
  },
  count: {
    label: 'Count (nr)', unit: 'nr',
    fields: [
      { key: 'count', label: 'Number' },
    ],
    compute: (d) => num(d.count),
  },
  custom: {
    label: 'Custom', unit: 'item',
    fields: [
      { key: 'qty',  label: 'Quantity' },
      { key: 'unit', label: 'Unit (e.g. m, m², item)' },
    ],
    compute: (d) => num(d.qty),
    unitFromData: (d) => (d.unit || 'item'),
  },
};

function newElement(type = 'floor_area') {
  return { id: Math.random().toString(36).slice(2), type, name: '', dims: {} };
}

function elementQty(el) {
  const def = ELEMENT_TYPES[el.type];
  if (!def) return 0;
  return def.compute(el.dims || {});
}
function elementUnit(el) {
  const def = ELEMENT_TYPES[el.type];
  if (!def) return 'item';
  return def.unitFromData ? def.unitFromData(el.dims || {}) : def.unit;
}

function measurementsToPrompt(elements, notes) {
  const lines = elements
    .map(el => {
      const def = ELEMENT_TYPES[el.type];
      if (!def) return null;
      const qty = elementQty(el);
      if (!qty) return null;
      const u = elementUnit(el);
      const name = el.name ? el.name : def.label;
      return '- ' + name + ': ' + qty.toFixed(2) + ' ' + u;
    })
    .filter(Boolean);
  let out = 'Site measurements (use these quantities directly in the quote):\n' + lines.join('\n');
  if (notes && notes.trim()) out += '\n\nNotes: ' + notes.trim();
  return out;
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
  const [qs] = useSearchParams();

  // Input phase
  const [inputMode, setInputMode] = useState('describe'); // 'describe' | 'form' | 'measure'
  const [inputText, setInputText] = useState('');
  const [projectType, setProjectType] = useState('extension');
  const [formSize, setFormSize] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [elements, setElements] = useState([newElement('floor_area')]);
  const [measureNotes, setMeasureNotes] = useState('');
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
  const [clientEmail, setClientEmail] = useState('');
  const [projectName, setProjectName] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  // A1 — public acceptance link state
  const [locked, setLocked] = useState(false);              // accepted -> read-only
  const [acceptedInfo, setAcceptedInfo] = useState(null);   // { name, at }
  const [share, setShare] = useState(null);                 // { url } share sheet
  const [sendingQuote, setSendingQuote] = useState(false);
  const [clientQuestions, setClientQuestions] = useState([]);

  // Wave 2 — overheads + jobs awareness. /estimator/new?job=<id> (the job
  // page's "+ New quote") arrives pre-linked so the builder never associates
  // things by hand.
  const [overheads, setOverheads] = useState(null);    // { break_even_day, break_even_hour, total } or null
  const [jobs, setJobs] = useState([]);                // list of available jobs to link this quote to
  const [jobId, setJobId] = useState(qs.get('job') || null);

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
        setClientEmail(q.client_email || '');
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
        setJobId(q.job_id || null);
        setLocked(!!q.locked);
        if (q.accepted_at) setAcceptedInfo({ name: q.acceptance_name, at: q.accepted_at });
        setPhase('ready');
        // Best-effort: questions the client asked from the public page.
        try {
          const m = await apiFetch('/estimator/quotes/' + q.id + '/messages');
          setClientQuestions(m.messages || []);
        } catch (e2) { /* non-fatal */ }
      } catch (e) {
        setError(e.message);
        setPhase('error');
      }
    })();
  }, [id, isNew]);

  // Fetch current overheads + jobs once (best-effort; ignore errors so the editor
  // still works for users who haven't set overheads yet).
  useEffect(() => {
    (async () => {
      try { const oh = await apiFetch('/finance/overheads/current'); setOverheads(oh.exists ? oh : null); } catch (e) {}
      try { const j = await apiFetch('/finance/jobs'); setJobs(j.jobs || []); } catch (e) {}
    })();
  }, []);

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
    } else if (inputMode === 'measure') {
      const valid = elements.filter(el => elementQty(el) > 0);
      if (valid.length === 0) {
        setError('Add at least one element with a non-zero quantity.');
        return;
      }
      payloadText = 'Project type: ' + projectType + '\n\n' + measurementsToPrompt(valid, measureNotes);
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
            client_email: clientEmail,
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
        // Link to job after creation if the picker is set (job_id isn't on the
        // POST schema; we use the finance link endpoint to keep concerns separate).
        if (jobId) {
          try { await apiFetch('/finance/jobs/' + jobId + '/link-quote', { method: 'POST', body: JSON.stringify({ quote_id: r.id }) }); } catch (e) {}
        }
        setSavedAt(new Date());
        // Move to the saved URL so reload works.
        nav('/estimator/quote/' + r.id, { replace: true });
      } else {
        await apiFetch('/estimator/quotes/' + quoteId, {
          method: 'PATCH',
          body: JSON.stringify({
            client_name: clientName,
            client_email: clientEmail,
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
        // Re-link to job (or unlink and relink to a different one).
        if (jobId) {
          try { await apiFetch('/finance/jobs/' + jobId + '/link-quote', { method: 'POST', body: JSON.stringify({ quote_id: quoteId }) }); } catch (e) {}
        }
        setSavedAt(new Date());
      }
    } catch (e) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Save the latest edits, then mint/reuse the public /q/<token> link and show
  // the share sheet (copy / WhatsApp / native share).
  const sendQuote = async () => {
    if (!quoteId) { alert('Save the quote first.'); return; }
    setSendingQuote(true);
    setError('');
    try {
      await save();
      const r = await apiFetch('/estimator/quotes/' + quoteId + '/send', {
        method: 'POST',
        body: JSON.stringify({ client_email: clientEmail || null }),
      });
      setStatus(r.status || 'sent');
      setShare({ url: window.location.origin + r.path, emailedTo: r.emailed_to });
    } catch (e) {
      setError(e.message || 'Failed to send the quote');
    } finally {
      setSendingQuote(false);
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
        <div style={{ display: 'inline-flex', background: t.surface, border: '1px solid ' + t.border, borderRadius: 8, padding: 4, marginBottom: 16, flexWrap: 'wrap' }}>
          <ToggleBtn t={t} active={inputMode === 'describe'} onClick={() => setInputMode('describe')}>Describe the job</ToggleBtn>
          <ToggleBtn t={t} active={inputMode === 'form'} onClick={() => setInputMode('form')}>Quick form</ToggleBtn>
          <ToggleBtn t={t} active={inputMode === 'measure'} onClick={() => setInputMode('measure')}>Site measurements</ToggleBtn>
        </div>

        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20, marginBottom: 16 }}>
          {inputMode === 'describe' && (
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
          )}
          {inputMode === 'form' && (
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
          {inputMode === 'measure' && (
            <MeasurementEditor
              t={t}
              projectType={projectType} setProjectType={setProjectType}
              currency={currency} setCurrency={setCurrency}
              elements={elements} setElements={setElements}
              notes={measureNotes} setNotes={setMeasureNotes}
            />
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
          {!locked && (
            <button onClick={save} disabled={saving} style={btnPrimary(t, saving)}>{saving ? 'Saving…' : (quoteId ? 'Save changes' : 'Save quote')}</button>
          )}
          {!locked && quoteId && (
            <button onClick={sendQuote} disabled={sendingQuote} style={{
              background: t.success, color: '#fff', border: 'none', borderRadius: 8,
              padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: sendingQuote ? 'wait' : 'pointer',
              opacity: sendingQuote ? 0.7 : 1,
            }}>{sendingQuote ? 'Getting link…' : 'Send the quote'}</button>
          )}
          <button onClick={() => download('pdf')} disabled={!quoteId} style={btnSecondary(t, !quoteId)}>Download PDF</button>
          <button onClick={() => download('xlsx')} disabled={!quoteId} style={btnSecondary(t, !quoteId)}>Download Excel</button>
        </div>
      </div>

      {/* Accepted — the quote is the signed record now */}
      {acceptedInfo && (
        <div style={{ background: t.successBg, border: '1px solid ' + t.success, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ color: t.success, fontWeight: 700 }}>
            Accepted by {acceptedInfo.name || 'the client'} on {new Date(acceptedInfo.at).toLocaleDateString('en-GB')}
          </div>
          <div style={{ color: t.textSecondary, fontSize: 13, marginTop: 4 }}>
            This quote is locked — it's your signed record. {jobId
              ? <>The job is in Finance: <a href={'/jobs/' + jobId} onClick={(e) => { e.preventDefault(); nav('/jobs/' + jobId); }} style={{ color: t.accent }}>open the job</a>.</>
              : 'Duplicate it if you need a revised version.'}
          </div>
        </div>
      )}

      {/* Questions the client asked from the public quote page */}
      {clientQuestions.length > 0 && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Questions from your client</div>
          {clientQuestions.map(m => (
            <div key={m.id} style={{ borderTop: '1px solid ' + t.border, padding: '10px 0', fontSize: 14 }}>
              <div style={{ color: t.textSecondary, fontSize: 12, marginBottom: 2 }}>
                {m.sender_name || 'Client'} · {new Date(m.created_at).toLocaleString('en-GB')}
              </div>
              <div>{m.message}</div>
            </div>
          ))}
        </div>
      )}

      {error && <div style={errBox(t)}>{error}</div>}

      {/* Header fields */}
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div>
            <label style={lbl(t)}>Client name</label>
            <input value={clientName} onChange={e => setClientName(e.target.value)} style={input(t)} placeholder="e.g. Mr & Mrs Smith" />
          </div>
          <div>
            <label style={lbl(t)}>Client email <span style={{ fontWeight: 400, color: t.textMuted }}>(so we can email the quote)</span></label>
            <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} style={input(t)} placeholder="e.g. dave@example.com" />
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
            <select value={status} onChange={e => setStatus(e.target.value)} style={input(t)} disabled={locked}>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              {status === 'accepted' && <option value="accepted">Accepted by client</option>}
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
          <div>
            <label style={lbl(t)}>Link to job</label>
            <select value={jobId || ''} onChange={e => setJobId(e.target.value || null)} style={input(t)}>
              <option value="">— Not linked —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.name}{j.client_name ? ' · ' + j.client_name : ''}</option>)}
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
                        <RateAutocomplete
                          value={ln.item || ''}
                          unit={ln.unit}
                          onChange={(v) => updateLine(idx, { item: v })}
                          onPick={(r) => updateLine(idx, {
                            item: r.description.split(',')[0].slice(0, 80),
                            description: r.description,
                            unit: r.unit || ln.unit || 'item',
                            rate: r.rate,
                            labour: r.labour,
                            materials: r.materials,
                            est_rate: false,
                          })}
                          placeholder="Item — type to search rate library"
                        />
                        <MaterialAutocomplete
                          value={ln.description || ''}
                          unit={ln.unit}
                          materialId={ln.material_id}
                          onChange={(v) => updateLine(idx, { description: v })}
                          onPick={(m) => updateLine(idx, {
                            description: m.description,
                            unit: m.unit,
                            rate: m.rate,
                            materials: m.materials,
                            source_url: m.source_url,
                            material_id: m.material_id,
                            est_rate: false,
                          })}
                          placeholder="Description — type to search materials"
                        />
                        {ln.source_url && (
                          <a href={ln.source_url} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 10, color: t.accent, marginLeft: 6 }}
                            title="Audit source for the materials rate">source ↗</a>
                        )}
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
          {overheads && overheads.break_even_day > 0 && (() => {
            const profit = totals.ohp;
            const breakDay = overheads.break_even_day;
            const days = profit / breakDay;
            const clears = profit > breakDay;
            return (
              <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: clears ? t.successBg : t.warningBg, color: clears ? t.success : t.warning, fontSize: 12 }}>
                {clears
                  ? <>This quote's OH&P covers {days.toFixed(1)} day{days >= 1.05 ? 's' : ''} of your {fmtMoney(breakDay, 'GBP')}/day overhead.</>
                  : <>OH&P doesn't cover one full day of overhead ({fmtMoney(breakDay, 'GBP')}/day). Consider lifting the markup.</>
                }
              </div>
            );
          })()}
          {!overheads && (
            <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: t.surface, color: t.textMuted, fontSize: 12 }}>
              Set <a href="/finance/overheads" style={{ color: t.accent }}>your overheads</a> to see whether this quote clears your break-even rate.
            </div>
          )}
        </div>
      </div>

      {share && (
        <ShareLinkModal
          t={t}
          url={share.url}
          title={share.emailedTo ? ('Emailed to ' + share.emailedTo) : 'Send the quote to your client'}
          message="Here’s your quote — you can view and accept it here:"
          onClose={() => setShare(null)}
        />
      )}
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

function MeasurementEditor({ t, projectType, setProjectType, currency, setCurrency, elements, setElements, notes, setNotes }) {
  const updateEl = (id, patch) => setElements(prev => prev.map(el => el.id === id ? { ...el, ...patch } : el));
  const updateDim = (id, k, v) => setElements(prev => prev.map(el => el.id === id ? { ...el, dims: { ...el.dims, [k]: v } } : el));
  const removeEl = (id) => setElements(prev => prev.filter(el => el.id !== id));
  const addEl = () => setElements(prev => [...prev, newElement('floor_area')]);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
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

      <label style={lbl(t)}>Elements — add the parts of the job, enter dimensions, we compute the quantities.</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {elements.map(el => {
          const def = ELEMENT_TYPES[el.type];
          const qty = elementQty(el);
          return (
            <div key={el.id} style={{ background: t.surface, border: '1px solid ' + t.border, borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 80px', gap: 8, alignItems: 'end' }}>
                <div>
                  <label style={lbl(t)}>Type</label>
                  <select
                    value={el.type}
                    onChange={e => updateEl(el.id, { type: e.target.value, dims: {} })}
                    style={input(t)}
                  >
                    {Object.entries(ELEMENT_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={lbl(t)}>Name (optional)</label>
                  <input value={el.name} onChange={e => updateEl(el.id, { name: e.target.value })} placeholder={def.label} style={input(t)} />
                </div>
                <button onClick={() => removeEl(el.id)} title="Remove" style={{
                  background: 'transparent', color: t.danger, border: '1px solid ' + t.border,
                  borderRadius: 8, padding: '8px 10px', cursor: 'pointer',
                }}>Remove</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr)) 140px', gap: 8, marginTop: 10 }}>
                {def.fields.map(f => (
                  <div key={f.key}>
                    <label style={lbl(t)}>{f.label}</label>
                    <input
                      type={f.key === 'unit' ? 'text' : 'number'} step="any"
                      value={el.dims[f.key] != null ? el.dims[f.key] : ''}
                      onChange={e => updateDim(el.id, f.key, e.target.value)}
                      style={input(t)}
                    />
                  </div>
                ))}
                <div>
                  <label style={lbl(t)}>Quantity</label>
                  <div style={{
                    background: t.bg, border: '1px solid ' + t.border, borderRadius: 6,
                    padding: '8px 10px', fontSize: 14, fontWeight: 600, color: qty > 0 ? t.accent : t.textMuted,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {qty > 0 ? qty.toFixed(2) + ' ' + elementUnit(el) : '—'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <button onClick={addEl} style={{
          background: 'transparent', color: t.accent, border: '1px dashed ' + t.border,
          borderRadius: 8, padding: '10px 14px', fontSize: 14, cursor: 'pointer',
        }}>+ Add element</button>
      </div>

      <label style={{ ...lbl(t), marginTop: 14 }}>Notes (optional)</label>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={3}
        placeholder="Scope details, finishes, spec level — anything the AI should know beyond the dimensions"
        style={txtarea(t)}
      />
    </>
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
