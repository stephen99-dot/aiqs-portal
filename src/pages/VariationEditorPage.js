import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch, getToken, getEstimatorKey } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import RateAutocomplete from '../components/RateAutocomplete';
import { CheckIcon } from '../components/Icons';

// Variation editor — used for both /change-orders/new?job=<id> (create) and
// /change-orders/:id (edit / view). Once status === 'approved' the row is
// locked server-side and the UI goes read-only with the audit trail visible.

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function fmt(n) { const v = Number(n) || 0; return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function VariationEditorPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const { id } = useParams();
  const [qs] = useSearchParams();
  const nav = useNavigate();
  const isNew = !id;
  const jobIdFromQs = qs.get('job') || '';

  const [phase, setPhase] = useState(isNew ? 'ready' : 'loading'); // loading | ready | error
  const [error, setError] = useState('');

  const [variationId, setVariationId] = useState(id || null);
  const [voNumber, setVoNumber] = useState('');
  const [status, setStatus] = useState('draft');
  const [locked, setLocked] = useState(false);
  const [jobId, setJobId] = useState(jobIdFromQs);
  const [jobName, setJobName] = useState('');
  const [jobs, setJobs] = useState([]);
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [currency, setCurrency] = useState('GBP');
  const [ohpPct, setOhpPct] = useState(15);
  const [vatPct, setVatPct] = useState(20);
  const [lines, setLines] = useState([]);
  const [approval, setApproval] = useState(null);   // {name, email, signature, ip, at}
  const [decline, setDecline] = useState(null);     // {reason, at}
  const [approvalToken, setApprovalToken] = useState('');
  const [emailedTo, setEmailedTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load
  useEffect(() => {
    (async () => {
      try { const j = await apiFetch('/finance/jobs'); setJobs(j.jobs || []); } catch (e) {}
      if (isNew) return;
      try {
        const r = await apiFetch('/change-orders/' + id);
        const v = r.variation;
        setVariationId(v.id);
        setVoNumber(v.vo_number || '');
        setStatus(v.status || 'draft');
        setLocked(!!v.locked);
        setJobId(v.job_id);
        setTitle(v.title || '');
        setReason(v.reason || '');
        setNotes(v.notes || '');
        setCurrency(v.currency || 'GBP');
        setOhpPct(num(v.ohp_pct, 15));
        setVatPct(num(v.vat_pct, 20));
        setApprovalToken(v.approval_token || '');
        if (v.approval_at) setApproval({ name: v.approval_name, email: v.approval_email, signature: v.approval_signature, ip: v.approval_ip, at: v.approval_at });
        if (v.decline_at) setDecline({ reason: v.decline_reason, at: v.decline_at });
        setLines((r.lines || []).map(l => ({ ...l, est_rate: !!l.est_rate })));
        setPhase('ready');
      } catch (e) {
        setError(e.message);
        setPhase('error');
      }
    })();
  }, [id, isNew]);

  // Whenever jobId changes, fill jobName from the loaded jobs list.
  useEffect(() => {
    if (!jobId) { setJobName(''); return; }
    const j = jobs.find(x => x.id === jobId);
    if (j) setJobName(j.name + (j.client_name ? ' · ' + j.client_name : ''));
  }, [jobId, jobs]);

  const totals = useMemo(() => {
    let net = 0;
    for (const ln of lines) net += num(ln.qty) * num(ln.rate);
    const ohp = net * (num(ohpPct) / 100);
    const beforeVat = net + ohp;
    const vat = beforeVat * (num(vatPct) / 100);
    const grand = beforeVat + vat;
    return { net, ohp, vat, grand };
  }, [lines, ohpPct, vatPct]);

  const updateLine = (idx, patch) => setLines(prev => prev.map((ln, i) => i === idx ? { ...ln, ...patch } : ln));
  const deleteLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));
  const addLine = () => setLines(prev => [...prev, {
    section: 'Change', item: '', description: '', unit: 'item',
    qty: 1, rate: 0, labour: 0, materials: 0, est_rate: true, sort_order: prev.length,
  }]);

  const save = async () => {
    if (locked) return;
    if (!jobId) { setError('Pick a job.'); return; }
    setSaving(true); setError('');
    try {
      if (!variationId) {
        const r = await apiFetch('/change-orders', {
          method: 'POST',
          body: JSON.stringify({
            job_id: jobId, title, reason, notes, currency,
            ohp_pct: num(ohpPct), vat_pct: num(vatPct),
            lines,
          }),
        });
        setVariationId(r.id);
        setVoNumber(r.vo_number);
        nav('/change-orders/' + r.id, { replace: true });
      } else {
        await apiFetch('/change-orders/' + variationId, {
          method: 'PATCH',
          body: JSON.stringify({ title, reason, notes, currency, ohp_pct: num(ohpPct), vat_pct: num(vatPct) }),
        });
        await apiFetch('/change-orders/' + variationId + '/lines', {
          method: 'PUT',
          body: JSON.stringify({ lines }),
        });
      }
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const send = async () => {
    if (!variationId) { setError('Save first.'); return; }
    // A2: optional email delivery — blank just mints the shareable link.
    const email = window.prompt("Client's email to send it to (leave blank to share the link by WhatsApp/text instead):", '');
    if (email === null) return; // cancelled
    setSending(true); setError('');
    try {
      const r = await apiFetch('/change-orders/' + variationId + '/send', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() || null }),
      });
      setStatus('sent');
      setApprovalToken(r.approval_token);
      if (r.emailed_to) setEmailedTo(r.emailed_to);
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  };

  const remove = async () => {
    if (!variationId || locked) return;
    if (!window.confirm('Delete this variation?')) return;
    try {
      await apiFetch('/change-orders/' + variationId, { method: 'DELETE' });
      nav(jobId ? '/jobs/' + jobId : '/jobs');
    } catch (e) { setError(e.message); }
  };

  const duplicate = async () => {
    if (!variationId) return;
    try {
      const r = await apiFetch('/change-orders/' + variationId + '/duplicate', { method: 'POST' });
      nav('/change-orders/' + r.id);
    } catch (e) { setError(e.message); }
  };

  const downloadPdf = () => {
    if (!variationId) return;
    fetch('/api/change-orders/' + variationId + '/pdf', {
      headers: { Authorization: 'Bearer ' + getToken(), 'x-estimator-key': getEstimatorKey() },
    }).then(r => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (voNumber || 'variation') + '.pdf';
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(e => alert(e.message));
  };

  const copyLink = () => {
    if (!approvalToken) return;
    const url = window.location.origin + '/v/' + approvalToken;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (phase === 'loading') return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;
  if (phase === 'error') return <div style={{ padding: 40, color: t.danger }}>{error}</div>;

  const readOnly = locked;

  return (
    <div style={{ padding: 24, color: t.text }}>
      <button onClick={() => nav(jobId ? '/jobs/' + jobId : '/jobs')} style={btnLink(t)}>← Job</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: '6px 0 4px 0', fontSize: 24 }}>
            {voNumber || 'New variation'}{title ? ' — ' + title : ''}
          </h1>
          <div style={{ color: t.textSecondary, fontSize: 13 }}>
            {jobName || 'No job linked'} · <StatusPill t={t} status={status} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!readOnly && (
            <button onClick={save} disabled={saving} style={btnPrimary(t, saving)}>{saving ? 'Saving…' : (variationId ? 'Save changes' : 'Save draft')}</button>
          )}
          {variationId && status === 'draft' && !readOnly && (
            <button onClick={send} disabled={sending} style={btnPrimary(t, sending)}>{sending ? 'Sending…' : 'Send to client'}</button>
          )}
          {variationId && <button onClick={downloadPdf} style={btnSecondary(t)}>PDF</button>}
          {variationId && <button onClick={duplicate} style={btnSecondary(t)}>Duplicate</button>}
          {variationId && !readOnly && <button onClick={remove} style={{ ...btnSecondary(t), color: t.danger }}>Delete</button>}
        </div>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}

      {/* Approval link block — when sent but not yet decided */}
      {status === 'sent' && approvalToken && (
        <div style={{ background: t.warningBg, border: '1px solid ' + t.warning + '55', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ color: t.warning, fontWeight: 600, marginBottom: 6 }}>Awaiting client approval</div>
          <div style={{ fontSize: 13, color: t.text, marginBottom: 10 }}>
            {emailedTo ? 'Emailed to ' + emailedTo + '. You can also share' : 'Share'} this link with your client — WhatsApp or text works.
            When they approve, this row locks and forms part of the contract.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ flex: 1, minWidth: 200, background: t.bg, padding: '8px 10px', borderRadius: 6, fontSize: 12, color: t.text, border: '1px solid ' + t.border, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {window.location.origin}/v/{approvalToken}
            </code>
            <button onClick={copyLink} style={btnSecondary(t)}>{copied ? 'Copied!' : 'Copy link'}</button>
          </div>
        </div>
      )}

      {/* Approved audit block */}
      {approval && (
        <div style={{ background: t.successBg, border: '1px solid ' + t.success + '55', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ color: t.success, fontWeight: 600, marginBottom: 6 }}><CheckIcon size={16} style={{ verticalAlign: 'middle' }} /> Approved by client</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, fontSize: 13, color: t.text }}>
            <div><span style={{ color: t.textSecondary }}>Name:</span> <strong>{approval.name}</strong></div>
            <div><span style={{ color: t.textSecondary }}>Signed:</span> {approval.signature}</div>
            <div><span style={{ color: t.textSecondary }}>Date:</span> {approval.at}</div>
            <div><span style={{ color: t.textSecondary }}>IP:</span> <code style={{ fontSize: 12 }}>{approval.ip || '—'}</code></div>
            {approval.email && <div><span style={{ color: t.textSecondary }}>Email:</span> {approval.email}</div>}
          </div>
        </div>
      )}

      {/* Declined block */}
      {decline && (
        <div style={{ background: t.dangerBg, border: '1px solid ' + t.danger + '55', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ color: t.danger, fontWeight: 600, marginBottom: 6 }}>Declined by client on {decline.at}</div>
          {decline.reason && <div style={{ fontSize: 13, color: t.text }}>Reason: {decline.reason}</div>}
          <div style={{ marginTop: 8, color: t.textSecondary, fontSize: 12 }}>You can still edit this variation and re-send, or duplicate it as a new draft.</div>
        </div>
      )}

      {/* Header fields */}
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div>
            <label style={lbl(t)}>Job *</label>
            <select value={jobId} onChange={e => setJobId(e.target.value)} disabled={readOnly || !!variationId} style={fld(t)}>
              <option value="">— Pick a job —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.name}{j.client_name ? ' · ' + j.client_name : ''}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl(t)}>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Add bifold doors" disabled={readOnly} style={fld(t)} />
          </div>
          <div>
            <label style={lbl(t)}>Your markup %</label>
            <input type="number" step="any" value={ohpPct} onChange={e => setOhpPct(e.target.value)} disabled={readOnly} style={fld(t)} />
          </div>
          <div>
            <label style={lbl(t)}>VAT %</label>
            <input type="number" step="any" value={vatPct} onChange={e => setVatPct(e.target.value)} disabled={readOnly} style={fld(t)} />
          </div>
        </div>
        <label style={{ ...lbl(t), marginTop: 12 }}>Reason for change</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this change happening? (Client upgrade, design change, on-site discovery, etc.)" rows={2} disabled={readOnly} style={ta(t)} />
      </div>

      {/* Lines */}
      <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr style={{ background: t.surface, fontSize: 12, color: t.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                <th style={{ ...th, width: '45%' }}>Item / description</th>
                <th style={{ ...th, width: 70, textAlign: 'right' }}>Qty</th>
                <th style={{ ...th, width: 70 }}>Unit</th>
                <th style={{ ...th, width: 110, textAlign: 'right' }}>Rate</th>
                <th style={{ ...th, width: 110, textAlign: 'right' }}>Total</th>
                {!readOnly && <th style={{ ...th, width: 36 }}></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((ln, idx) => {
                const lineTotal = num(ln.qty) * num(ln.rate);
                return (
                  <tr key={idx} style={{ borderTop: '1px solid ' + t.border }}>
                    <td style={tdCell}>
                      {readOnly ? (
                        <>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{ln.item}</div>
                          <div style={{ fontSize: 12, color: t.textSecondary }}>{ln.description}</div>
                        </>
                      ) : (
                        <>
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
                          />
                          <input value={ln.description || ''} onChange={e => updateLine(idx, { description: e.target.value })} placeholder="Description" style={inputInline(t)} />
                        </>
                      )}
                    </td>
                    <td style={{ ...tdCell, textAlign: 'right' }}>
                      {readOnly ? num(ln.qty) : <input type="number" step="any" value={ln.qty} onChange={e => updateLine(idx, { qty: e.target.value })} style={inputNum(t)} />}
                    </td>
                    <td style={tdCell}>
                      {readOnly ? (ln.unit || '') : <input value={ln.unit || ''} onChange={e => updateLine(idx, { unit: e.target.value })} style={inputInline(t)} />}
                    </td>
                    <td style={{ ...tdCell, textAlign: 'right' }}>
                      {readOnly ? fmt(ln.rate) : (
                        <>
                          <input type="number" step="any" value={ln.rate} onChange={e => updateLine(idx, { rate: e.target.value, est_rate: false })} style={{ ...inputNum(t), color: ln.est_rate ? t.warning : t.text }} />
                          {ln.est_rate && <div style={{ fontSize: 10, color: t.warning, marginTop: 2 }}>est</div>}
                        </>
                      )}
                    </td>
                    <td style={{ ...tdCell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(lineTotal)}</td>
                    {!readOnly && (
                      <td style={{ ...tdCell, textAlign: 'center' }}>
                        <button onClick={() => deleteLine(idx)} style={{ background: 'transparent', border: 'none', color: t.danger, cursor: 'pointer', fontSize: 16 }}>×</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!readOnly && (
                <tr>
                  <td colSpan={readOnly ? 5 : 6} style={{ padding: 12, borderTop: '1px solid ' + t.border }}>
                    <button onClick={addLine} style={btnGhost(t)}>+ Add line</button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
          <label style={lbl(t)}>Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} disabled={readOnly} rows={4} placeholder="Internal notes or terms (appears on the PDF)" style={ta(t)} />
        </div>
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20 }}>
          <SummaryRow t={t} label="Net" value={fmt(totals.net)} />
          <SummaryRow t={t} label={'Your markup (' + num(ohpPct).toFixed(1) + '%)'} value={fmt(totals.ohp)} />
          <SummaryRow t={t} label={'VAT (' + num(vatPct).toFixed(1) + '%)'} value={fmt(totals.vat)} />
          <div style={{ borderTop: '1px solid ' + t.border, margin: '8px 0' }} />
          <SummaryRow t={t} label="Grand Total" value={fmt(totals.grand)} bold />
        </div>
      </div>
    </div>
  );
}

function StatusPill({ t, status }) {
  const tone = status === 'approved' ? { bg: t.successBg, fg: t.success }
    : status === 'declined' ? { bg: t.dangerBg, fg: t.danger }
    : status === 'sent' ? { bg: t.warningBg, fg: t.warning }
    : { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary };
  return (
    <span style={{ background: tone.bg, color: tone.fg, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{status}</span>
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

const th = { padding: '10px 14px', textAlign: 'left', fontSize: 12 };
const tdCell = { padding: '8px 10px', fontSize: 13, verticalAlign: 'top' };
function lbl(t) { return { display: 'block', color: t.textSecondary, fontSize: 12, marginBottom: 4 }; }
function fld(t) { return { width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none' }; }
function ta(t)  { return { width: '100%', boxSizing: 'border-box', background: t.bg, border: '1px solid ' + t.border, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }; }
function inputInline(t) { return { width: '100%', background: 'transparent', border: '1px solid transparent', color: t.text, borderRadius: 4, padding: '4px 6px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }; }
function inputNum(t)    { return { width: '100%', background: 'transparent', border: '1px solid ' + t.border, color: t.text, borderRadius: 4, padding: '4px 6px', fontSize: 13, textAlign: 'right', outline: 'none', boxSizing: 'border-box' }; }
function btnLink(t)     { return { background: 'transparent', color: t.textSecondary, border: 'none', padding: 0, fontSize: 13, cursor: 'pointer' }; }
function btnPrimary(t, disabled) { return { background: disabled ? t.surface : t.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 14, fontWeight: 600, cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.7 : 1 }; }
function btnSecondary(t) { return { background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 8, padding: '8px 14px', fontSize: 14, cursor: 'pointer' }; }
function btnGhost(t) { return { background: 'transparent', color: t.text, border: '1px solid ' + t.border, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }; }
