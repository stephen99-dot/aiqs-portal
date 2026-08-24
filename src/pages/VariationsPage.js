import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch, getToken } from '../utils/api';
import { CheckIcon, XIcon, FileTextIcon } from '../components/Icons';
import {
  Button, Card, Badge, PageHeader, EmptyState, Banner, Modal,
  Input, Textarea, Field, Skeleton, SkeletonCard,
} from '../ui';

const STATUS_META = {
  draft:    { tone: 'neutral', label: 'Draft' },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger',  label: 'Rejected' },
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
  const [rejecting, setRejecting] = useState(false);
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

  async function handleReject() {
    if (!rejectModal) return;
    setRejecting(true);
    try {
      const data = await apiFetch(`/variations/${rejectModal}/reject`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: rejectReason })
      });
      setVariations(v => v.map(x => x.id === rejectModal ? data.variation : x));
      if (selected?.id === rejectModal) setSelected(data.variation);
      setRejectModal(null);
      setRejectReason('');
    } catch (err) {
      setError(err.message);
    } finally {
      setRejecting(false);
    }
  }

  async function handleDownload(filename) {
    const token = getToken();
    const res = await fetch(`/api/variations/download/${filename}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) { setError('Download failed'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function parseAnalysis(v) {
    try { return JSON.parse(v.raw_analysis); } catch { return null; }
  }

  if (loading) return (
    <div className="page">
      <Skeleton width={160} height={14} style={{ marginBottom: 12 }} />
      <Skeleton width={260} height={28} style={{ marginBottom: 8 }} />
      <Skeleton width={320} height={13} style={{ marginBottom: 24 }} />
      <div className="ui-split ui-split--side-first" style={{ '--split-side': '320px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <SkeletonCard height={200} />
      </div>
    </div>
  );

  const s = selected ? STATUS_META[selected.status] || STATUS_META.draft : null;

  return (
    <div className="page">
      {/* Header */}
      <Link to={`/project/${projectId}`} className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 14, opacity: 0.7, textDecoration: 'none' }}>
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M11 17l-5-5m0 0l5-5m-5 5h12"/></svg>
        {project?.title || 'Back to Project'}
      </Link>
      <PageHeader
        title="Variation Orders"
        subtitle="Manage contract variations and change orders"
        actions={
          <Button onClick={() => { setShowForm(true); setSelected(null); setError(''); }}>
            + New Variation
          </Button>
        }
      />

      {error && <Banner tone="danger" style={{ color: 'var(--danger)', fontSize: 14 }}>{error}</Banner>}

      <div className="ui-split ui-split--side-first" style={{ '--split-side': '320px' }}>

        {/* LEFT — VO list */}
        <div>
          {variations.length === 0 && !showForm && (
            <Card>
              <EmptyState
                icon={FileTextIcon}
                title="No variations raised yet"
                action={<Button size="sm" onClick={() => setShowForm(true)}>Raise First Variation</Button>}
              />
            </Card>
          )}

          {variations.map(v => {
            const sc = STATUS_META[v.status] || STATUS_META.draft;
            const isActive = selected?.id === v.id;
            return (
              <Card key={v.id}
                onClick={() => { setSelected(v); setShowForm(false); }}
                style={{
                  marginBottom: 10, cursor: 'pointer',
                  borderColor: isActive ? 'var(--accent)' : undefined,
                  background: isActive ? 'var(--accent-glow)' : undefined,
                }}>
                <Card.Body style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>{v.vo_number}</span>
                    <Badge tone={sc.tone} pill>{sc.label}</Badge>
                  </div>
                  <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, lineHeight: 1.3, color: 'var(--text-primary)' }}>{v.title}</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(v.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
                    {v.additions > 0 && <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>+{fmt(v.additions, v.currency)}</span>}
                    {v.omissions > 0 && <span style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>−{fmt(v.omissions, v.currency)}</span>}
                    <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 'auto', color: (v.net_change || 0) >= 0 ? 'var(--danger)' : 'var(--success)' }}>
                      Net: {(v.net_change || 0) >= 0 ? '+' : '−'}{fmt(v.net_change, v.currency)}
                    </span>
                  </div>
                </Card.Body>
              </Card>
            );
          })}
        </div>

        {/* RIGHT — Form or Detail */}
        <div>

          {/* NEW VARIATION FORM */}
          {showForm && (
            <Card>
              <Card.Header title="Raise New Variation" />
              <Card.Body>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 20px' }}>Describe the change. Attach revised drawings if available — the AI will analyse the delta and estimate costs.</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                  <Field label="Variation Title *">
                    <Input
                      placeholder="e.g. Additional storey to rear extension"
                      value={form.title}
                      onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    />
                  </Field>

                  <Field label="Description of Change *">
                    <Textarea
                      placeholder="Describe what has changed from the original scope. Include any specification changes, additions, or omissions..."
                      value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      rows={5}
                    />
                  </Field>

                  <div className="ui-field">
                    <span className="ui-field__label">Revised Drawings (optional)</span>
                    <div
                      onClick={() => fileRef.current.click()}
                      style={{ border: '2px dashed var(--border)', borderRadius: 8, padding: '16px 20px', cursor: 'pointer', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                      {files.length > 0
                        ? files.map(f => f.name).join(', ')
                        : 'Click to upload PDFs or images (max 5 files)'}
                    </div>
                    <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" style={{ display: 'none' }}
                      onChange={e => setFiles(Array.from(e.target.files).slice(0, 5))} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <Button onClick={handleCreate} busyLabel="Analysing..." disabled={creating} style={{ flex: 1 }}>
                    Submit Variation for Analysis
                  </Button>
                  <Button variant="secondary" onClick={() => setShowForm(false)} disabled={creating}>Cancel</Button>
                </div>

                {creating && (
                  <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--accent-glow)', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)' }}>
                    <div className="loading-spinner" style={{ width: 16, height: 16 }} />
                    AI is analysing the variation and estimating costs...
                  </div>
                )}
              </Card.Body>
            </Card>
          )}

          {/* VO DETAIL */}
          {selected && !showForm && (() => {
            const analysis = parseAnalysis(selected);
            return (
              <Card>
                <Card.Body>

                  {/* VO Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Variation Order</div>
                      <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>{selected.vo_number}</h2>
                      <p style={{ fontSize: 15, fontWeight: 600, marginTop: 4, color: 'var(--text-primary)' }}>{selected.title}</p>
                    </div>
                    <Badge tone={s.tone} pill>{s.label}</Badge>
                  </div>

                  {/* Description */}
                  <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: '14px 16px', marginBottom: 20, fontSize: 14, lineHeight: 1.6 }}>
                    {selected.description}
                  </div>

                  {/* Scope Changes */}
                  {analysis?.scope_changes?.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', marginBottom: 10 }}>Scope Changes</h3>
                      {analysis.scope_changes.map((c, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--bg-primary)' }}>
                          <Badge
                            tone={c.type === 'addition' ? 'success' : c.type === 'omission' ? 'danger' : 'warning'}
                            pill style={{ flexShrink: 0 }}>
                            {c.type?.toUpperCase()}
                          </Badge>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{c.item}</span>
                            <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 8 }}>{c.detail}</span>
                          </div>
                          {c.cost > 0 && <span style={{ fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{fmt(c.cost, selected.currency)}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Financial Summary */}
                  <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 20 }}>
                    <div style={{ background: 'var(--bg-primary)', padding: '8px 16px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>Financial Summary</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 1, background: 'var(--border)' }}>
                      {[
                        { label: 'Additions', value: '+' + fmt(selected.additions, selected.currency), color: 'var(--success)' },
                        { label: 'Omissions', value: '−' + fmt(selected.omissions, selected.currency), color: 'var(--danger)' },
                        { label: 'Net Change', value: (selected.net_change >= 0 ? '+' : '−') + fmt(selected.net_change, selected.currency), color: selected.net_change >= 0 ? 'var(--danger)' : 'var(--success)' },
                      ].map(item => (
                        <div key={item.label} style={{ background: 'var(--bg-card)', padding: '14px 16px', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>{item.label}</div>
                          <div style={{ fontSize: 18, fontWeight: 800, color: item.color }}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Assumptions */}
                  {analysis?.assumptions?.length > 0 && (
                    <Banner tone="accent" style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>ASSUMPTIONS</div>
                      {analysis.assumptions.map((a, i) => <p key={i} style={{ fontSize: 13, margin: '0 0 4px 0' }}>• {a}</p>)}
                    </Banner>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {selected.vo_doc_filename && (
                      <Button variant="secondary" size="sm" onClick={() => handleDownload(selected.vo_doc_filename)}>
                        ↓ Download VO Document
                      </Button>
                    )}
                    {selected.status === 'draft' && (
                      <>
                        <Button size="sm"
                          busyLabel="Approving…"
                          onClick={() => { if (window.confirm('Approve this variation? This cannot be undone from here.')) return handleApprove(selected.id); }}>
                          <CheckIcon size={14} color="currentColor" /> Approve Variation
                        </Button>
                        <Button variant="danger" size="sm"
                          onClick={() => { setRejectModal(selected.id); setRejectReason(''); }}>
                          <XIcon size={14} color="currentColor" /> Reject
                        </Button>
                      </>
                    )}
                    {selected.status === 'approved' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--success-bg)', color: 'var(--success)', fontSize: 13, fontWeight: 600 }}>
                          <CheckIcon size={14} style={{ verticalAlign: 'middle' }} /> Approved {selected.approved_at ? `on ${new Date(selected.approved_at).toLocaleDateString('en-GB')}` : ''}
                        </div>
                        {!selected.revised_boq_filename ? (
                          <Button size="sm"
                            disabled={generatingBoq}
                            onClick={() => handleGenerateRevisedBoq(selected.id)}>
                            {generatingBoq ? 'Generating Revised BOQ...' : 'Generate Revised BOQ'}
                          </Button>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => handleDownload(selected.revised_boq_filename)}>
                            ↓ Download Revised BOQ (Excel)
                          </Button>
                        )}
                      </div>
                    )}
                    {selected.status === 'rejected' && (
                      <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13 }}>
                        <XIcon size={14} style={{ verticalAlign: 'middle' }} /> Rejected{selected.rejection_reason ? ` — ${selected.rejection_reason}` : ''}
                      </div>
                    )}
                  </div>
                </Card.Body>
              </Card>
            );
          })()}

          {/* Empty right panel */}
          {!showForm && !selected && variations.length > 0 && (
            <Card>
              <EmptyState body="Select a variation to view details" />
            </Card>
          )}
        </div>
      </div>

      {/* Reject Modal */}
      {rejectModal && (
        <Modal
          title="Reject Variation"
          maxWidth={420}
          onClose={() => { if (!rejecting) setRejectModal(null); }}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRejectModal(null)} disabled={rejecting}>Cancel</Button>
              <Button variant="danger" onClick={handleReject} busyLabel="Rejecting…" disabled={rejecting}>Confirm Rejection</Button>
            </>
          }
        >
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 16px' }}>Provide a reason for rejection (optional):</p>
          <Textarea rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="e.g. Scope not agreed, awaiting revised drawings..." />
        </Modal>
      )}
    </div>
  );
}
