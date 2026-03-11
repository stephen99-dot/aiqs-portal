import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch, getToken } from '../utils/api';

const STATUS_COLOURS = {
  draft:    { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', label: 'Draft' },
  approved: { bg: 'rgba(16,185,129,0.12)', color: '#10B981', label: 'Approved' },
  rejected: { bg: 'rgba(239,68,68,0.12)',  color: '#EF4444', label: 'Rejected' },
};

function fmt(val, currency = 'GBP') {
  const sym = currency === 'EUR' ? '€' : '£';
  return sym + Math.abs(val || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function VariationsPage() {
  const { id: projectId } = useParams();
  const [project, setProject]       = useState(null);
  const [variations, setVariations] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [creating, setCreating]     = useState(false);
  const [showForm, setShowForm]     = useState(false);
  const [selected, setSelected]     = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [generatingBoq, setGeneratingBoq] = useState(false);
  const [form, setForm] = useState({ title: '', description: '' });
  const [files, setFiles]   = useState([]);
  const [error, setError]   = useState('');
  const fileRef = useRef();

  useEffect(() => { load(); }, [projectId]); // eslint-disable-line

  async function load() {
    setLoading(true);
    try {
      const [proj, varData] = await Promise.all([
        apiFetch(`/projects/${projectId}`),
        apiFetch(`/variations/${projectId}`)
      ]);
      setProject(proj);
      setVariations(varData.variations || []);
    } catch (err) {
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) { setError('Title and description are required'); return; }
    setCreating(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('title', form.title);
      fd.append('description', form.description);
      files.forEach(f => fd.append('drawings', f));

      const token = getToken();
      const res = await fetch(`/api/variations/${projectId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setVariations(v => [data.variation, ...v]);
      setSelected(data.variation);
      setShowForm(false);
      setForm({ title: '', description: '' });
      setFiles([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleApprove(varId) {
    try {
      const data = await apiFetch(`/variations/${varId}/approve`, { method: 'PATCH' });
      setVariations(v => v.map(x => x.id === varId ? data.variation : x));
      if (selected?.id === varId) setSelected(data.variation);
    } catch (err) { setError(err.message); }
  }

  async function handleGenerateRevisedBoq(varId) {
    setGeneratingBoq(true);
    setError('');
    try {
      const data = await apiFetch(`/variations/${varId}/generate-revised-boq`, { method: 'POST' });
      setVariations(v => v.map(x => x.id === varId ? data.variation : x));
      if (selected?.id === varId) setSelected(data.variation);
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingBoq(false);
    }
  }

  async function handleReject() {    if (!rejectModal) return;
    try {
      const data = await apiFetch(`/variations/${rejectModal}/reject`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: rejectReason })
      });
      setVariations(v => v.map(x => x.id === rejectModal ? data.variation : x));
      if (selected?.id === rejectModal) setSelected(data.variation);
      setRejectModal(null);
      setRejectReason('');
    } catch (err) { setError(err.message); }
  }

  async function handleDownload(filename) {
    const token = getToken();
    const res = await fetch(`/api/variations/download/${filename}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) { alert('Download failed'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function parseAnalysis(v) {
    try { return JSON.parse(v.raw_analysis); } catch { return null; }
  }

  if (loading) return (
    <div className="page"><div className="empty-state"><div className="loading-spinner" /><p>Loading variations...</p></div></div>
  );

  const s = selected ? STATUS_COLOURS[selected.status] || STATUS_COLOURS.draft : null;

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <Link to={`/project/${projectId}`} className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 14, opacity: 0.7, textDecoration: 'none' }}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M11 17l-5-5m0 0l5-5m-5 5h12"/></svg>
            {project?.title || 'Back to Project'}
          </Link>
          <h1 className="page-title">Variation Orders</h1>
          <p className="page-subtitle">Manage contract variations and change orders</p>
        </div>
        <button className="btn-primary" onClick={() => { setShowForm(true); setSelected(null); setError(''); }}>
          + New Variation
        </button>
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, color: '#EF4444', fontSize: 14 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start' }}>

        {/* LEFT — VO list */}
        <div>
          {variations.length === 0 && !showForm && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
              <p style={{ opacity: 0.6, marginBottom: 16, fontSize: 14 }}>No variations raised yet</p>
              <button className="btn-primary" style={{ fontSize: 13 }} onClick={() => setShowForm(true)}>Raise First Variation</button>
            </div>
          )}

          {variations.map(v => {
            const sc = STATUS_COLOURS[v.status] || STATUS_COLOURS.draft;
            const isActive = selected?.id === v.id;
            return (
              <div key={v.id}
                onClick={() => { setSelected(v); setShowForm(false); }}
                style={{ background: isActive ? 'var(--primary-bg)' : 'var(--card-bg)', border: `1px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 10, padding: '14px 16px', marginBottom: 10, cursor: 'pointer', transition: 'all 0.15s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--primary)' }}>{v.vo_number}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: sc.bg, color: sc.color }}>{sc.label}</span>
                </div>
                <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, lineHeight: 1.3 }}>{v.title}</p>
                <p style={{ fontSize: 12, opacity: 0.6 }}>{new Date(v.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
                  {v.additions > 0 && <span style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>+{fmt(v.additions, v.currency)}</span>}
                  {v.omissions > 0 && <span style={{ fontSize: 12, color: '#EF4444', fontWeight: 600 }}>−{fmt(v.omissions, v.currency)}</span>}
                  <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 'auto', color: (v.net_change || 0) >= 0 ? '#EF4444' : '#10B981' }}>
                    Net: {(v.net_change || 0) >= 0 ? '+' : '−'}{fmt(v.net_change, v.currency)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* RIGHT — Form or Detail */}
        <div>

          {/* NEW VARIATION FORM */}
          {showForm && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 28 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Raise New Variation</h2>
              <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 24 }}>Describe the change. Attach revised drawings if available — the AI will analyse the delta and estimate costs.</p>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Variation Title *</label>
                <input
                  className="input"
                  placeholder="e.g. Additional storey to rear extension"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Description of Change *</label>
                <textarea
                  className="input"
                  placeholder="Describe what has changed from the original scope. Include any specification changes, additions, or omissions..."
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={5}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Revised Drawings (optional)</label>
                <div
                  onClick={() => fileRef.current.click()}
                  style={{ border: '2px dashed var(--border)', borderRadius: 8, padding: '16px 20px', cursor: 'pointer', textAlign: 'center', fontSize: 13, opacity: 0.7 }}>
                  {files.length > 0
                    ? files.map(f => f.name).join(', ')
                    : 'Click to upload PDFs or images (max 5 files)'}
                </div>
                <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }}
                  onChange={e => setFiles(Array.from(e.target.files).slice(0, 5))} />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-primary" onClick={handleCreate} disabled={creating} style={{ flex: 1 }}>
                  {creating ? 'Analysing...' : 'Submit Variation for Analysis'}
                </button>
                <button className="btn-secondary" onClick={() => setShowForm(false)} disabled={creating}>Cancel</button>
              </div>

              {creating && (
                <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(var(--primary-rgb),0.08)', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="loading-spinner" style={{ width: 16, height: 16 }} />
                  AI is analysing the variation and estimating costs...
                </div>
              )}
            </div>
          )}

          {/* VO DETAIL */}
          {selected && !showForm && (() => {
            const analysis = parseAnalysis(selected);
            return (
              <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 28 }}>

                {/* VO Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Variation Order</div>
                    <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{selected.vo_number}</h2>
                    <p style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{selected.title}</p>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: s.bg, color: s.color }}>{s.label}</span>
                </div>

                {/* Description */}
                <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '14px 16px', marginBottom: 20, fontSize: 14, lineHeight: 1.6 }}>
                  {selected.description}
                </div>

                {/* Scope Changes */}
                {analysis?.scope_changes?.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, marginBottom: 10 }}>Scope Changes</h3>
                    {analysis.scope_changes.map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--bg)' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, flexShrink: 0, background: c.type === 'addition' ? 'rgba(16,185,129,0.15)' : c.type === 'omission' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)', color: c.type === 'addition' ? '#10B981' : c.type === 'omission' ? '#EF4444' : '#F59E0B' }}>
                          {c.type?.toUpperCase()}
                        </span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{c.item}</span>
                          <span style={{ fontSize: 13, opacity: 0.7, marginLeft: 8 }}>{c.detail}</span>
                        </div>
                        {c.cost > 0 && <span style={{ fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{fmt(c.cost, selected.currency)}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Financial Summary */}
                <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 20 }}>
                  <div style={{ background: 'var(--bg)', padding: '8px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>Financial Summary</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: 'var(--border)' }}>
                    {[
                      { label: 'Additions', value: '+' + fmt(selected.additions, selected.currency), color: '#10B981' },
                      { label: 'Omissions', value: '−' + fmt(selected.omissions, selected.currency), color: '#EF4444' },
                      { label: 'Net Change', value: (selected.net_change >= 0 ? '+' : '−') + fmt(selected.net_change, selected.currency), color: selected.net_change >= 0 ? '#EF4444' : '#10B981' },
                    ].map(item => (
                      <div key={item.label} style={{ background: 'var(--card-bg)', padding: '14px 16px', textAlign: 'center' }}>
                        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4, textTransform: 'uppercase' }}>{item.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: item.color }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Assumptions */}
                {analysis?.assumptions?.length > 0 && (
                  <div style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 8, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#F59E0B', marginBottom: 8 }}>ASSUMPTIONS</div>
                    {analysis.assumptions.map((a, i) => <p key={i} style={{ fontSize: 13, margin: '0 0 4px 0' }}>• {a}</p>)}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {selected.vo_doc_filename && (
                    <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => handleDownload(selected.vo_doc_filename)}>
                      ↓ Download VO Document
                    </button>
                  )}
                  {selected.status === 'draft' && (
                    <>
                      <button className="btn-primary" style={{ fontSize: 13, background: '#10B981', borderColor: '#10B981' }}
                        onClick={() => handleApprove(selected.id)}>
                        ✓ Approve Variation
                      </button>
                      <button className="btn-secondary" style={{ fontSize: 13, color: '#EF4444', borderColor: 'rgba(239,68,68,0.3)' }}
                        onClick={() => { setRejectModal(selected.id); setRejectReason(''); }}>
                        ✕ Reject
                      </button>
                    </>
                  )}
                  {selected.status === 'approved' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(16,185,129,0.1)', color: '#10B981', fontSize: 13, fontWeight: 600 }}>
                        ✓ Approved {selected.approved_at ? `on ${new Date(selected.approved_at).toLocaleDateString('en-GB')}` : ''}
                      </div>
                      {!selected.revised_boq_filename ? (
                        <button
                          className="btn-primary"
                          style={{ fontSize: 13 }}
                          disabled={generatingBoq}
                          onClick={() => handleGenerateRevisedBoq(selected.id)}>
                          {generatingBoq ? '⏳ Generating Revised BOQ...' : '📊 Generate Revised BOQ'}
                        </button>
                      ) : (
                        <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => handleDownload(selected.revised_boq_filename)}>
                          ↓ Download Revised BOQ (Excel)
                        </button>
                      )}
                    </div>
                  )}
                  {selected.status === 'rejected' && (
                    <div style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#EF4444', fontSize: 13 }}>
                      ✕ Rejected{selected.rejection_reason ? ` — ${selected.rejection_reason}` : ''}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Empty right panel */}
          {!showForm && !selected && variations.length > 0 && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 48, textAlign: 'center', opacity: 0.5 }}>
              <p>Select a variation to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* Reject Modal */}
      {rejectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--card-bg)', borderRadius: 12, padding: 28, width: 420, maxWidth: '90vw' }}>
            <h3 style={{ marginBottom: 12 }}>Reject Variation</h3>
            <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 16 }}>Provide a reason for rejection (optional):</p>
            <textarea className="input" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="e.g. Scope not agreed, awaiting revised drawings..." style={{ width: '100%', marginBottom: 16, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-secondary" style={{ color: '#EF4444', borderColor: 'rgba(239,68,68,0.3)', flex: 1 }} onClick={handleReject}>Confirm Rejection</button>
              <button className="btn-secondary" onClick={() => setRejectModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
