import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch, getToken } from '../utils/api';
import { MailIcon, PhoneIcon, CheckIcon, AlertTriangleIcon } from './Icons';
import useIsMobile from '../utils/useIsMobile';

/**
 * Deliverables panel — the return leg of the workflow.
 *
 * For customers (project owner): read-only list of files the QS has sent
 *   back ("Documents from your QS"), latest version per kind, with version
 *   history collapsible.
 *
 * For admins: same list, plus an inline uploader. Pick a kind, optionally add
 *   a note ("v2 — revised after spec change"), drop files. Each upload bumps
 *   the version for that kind and demotes the previous to history.
 */

const KIND_LABELS = {
  boq: 'Bill of Quantities',
  findings: 'Findings Report',
  marked_drawing: 'Marked-up Drawing',
  supplier_quote: 'Supplier Quote',
  schedule: 'Schedule',
  client_copy: 'Client Copy',
  other: 'Other',
};

const KIND_OPTIONS = [
  { value: 'boq', label: 'Bill of Quantities' },
  { value: 'findings', label: 'Findings Report' },
  { value: 'marked_drawing', label: 'Marked-up Drawing' },
  { value: 'supplier_quote', label: 'Supplier Quote' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'client_copy', label: 'Client Copy' },
  { value: 'other', label: 'Other' },
];

function fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

export default function DeliverablesPanel({ projectId, project }) {
  const { user } = useAuth();
  const isAdmin = user && user.role === 'admin';
  const isMobile = useIsMobile();

  const [latest, setLatest] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  // Admin "View as customer" — fetches the project list the customer would
  // see on their dashboard so the admin can confirm the current job is
  // actually in their portal (and not lost to a user_id mismatch).
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [previewError, setPreviewError] = useState('');

  // Admin uploader state
  const [kind, setKind] = useState('boq');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadOk, setUploadOk] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(`/projects/${projectId}/deliverables`);
      setLatest(data.latest || []);
      setHistory(data.history || []);
    } catch (err) {
      setError(err.message || 'Failed to load deliverables');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function loadCustomerPreview() {
    if (!project || !project.user_id) {
      setPreviewError('No customer attached to this project.');
      setPreviewOpen(true);
      return;
    }
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewData(null);
    try {
      const data = await apiFetch(`/admin/users/${project.user_id}/projects`);
      setPreviewData(data);
    } catch (err) {
      setPreviewError(err.message || 'Failed to load customer dashboard');
    } finally {
      setPreviewLoading(false);
    }
  }

  function addFiles(fl) {
    setFiles((prev) => [...prev, ...Array.from(fl || [])]);
  }
  function removeFile(idx) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function doUpload() {
    if (!files.length || !isAdmin) return;
    setUploading(true);
    setError('');
    setUploadOk('');
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      if (notes.trim()) fd.append('notes', notes.trim());
      for (const f of files) fd.append('files', f, f.name);
      const token = getToken();
      const resp = await fetch(`/api/projects/${projectId}/deliverables`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: fd,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
      setFiles([]);
      setNotes('');
      setUploadOk('Uploaded ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '. Customer can now download.');
      load();
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function deleteDeliverable(id) {
    if (!isAdmin) return;
    if (!window.confirm('Hide this file from the customer? The previous version (if any) will be promoted back to current.')) return;
    try {
      const token = getToken();
      const resp = await fetch(`/api/deliverables/${id}`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Delete failed');
      }
      load();
    } catch (err) {
      setError(err.message || 'Delete failed');
    }
  }

  async function downloadFile(id, filename) {
    if (downloadingId) return;
    setDownloadingId(id);
    setError('');
    try {
      const token = getToken();
      const resp = await fetch(`/api/downloads/${filename}`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
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
      setDownloadingId(null);
    }
  }

  const byKind = latest.reduce((acc, d) => {
    (acc[d.kind] = acc[d.kind] || []).push(d);
    return acc;
  }, {});
  const groupOrder = ['boq', 'findings', 'marked_drawing', 'supplier_quote', 'schedule', 'client_copy', 'other'];
  const orderedGroups = [
    ...groupOrder.filter((k) => byKind[k]),
    ...Object.keys(byKind).filter((k) => !groupOrder.includes(k)),
  ];

  return (
    <div className="section-card">
      <div className="section-card-header">
        <h2>Documents from your QS{isAdmin ? ' · Admin upload' : ''}</h2>
      </div>
      <div className="card-body" style={{ padding: '14px 18px 18px' }}>

        {/* Customer-context banner — admins need to know who they're sending to */}
        {isAdmin && project && (project.owner_name || project.owner_email) && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '10px 14px', borderRadius: 9, marginBottom: 12,
            background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.25)',
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 13,
            }}>
              {(project.owner_name || project.owner_email || 'C')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Sending to
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                {project.owner_name || project.owner_email}
                {project.owner_company ? <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}> · {project.owner_company}</span> : null}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {project.owner_email && <a href={`mailto:${project.owner_email}`} style={{ color: 'inherit', textDecoration: 'none' }}><MailIcon size={14} style={{ verticalAlign: 'middle' }} /> {project.owner_email}</a>}
                {project.owner_phone && <a href={`tel:${project.owner_phone}`} style={{ color: 'inherit', textDecoration: 'none' }}><PhoneIcon size={14} style={{ verticalAlign: 'middle' }} /> {project.owner_phone}</a>}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span style={{
                fontSize: 11, fontWeight: 700,
                padding: '4px 9px', borderRadius: 999,
                background: 'rgba(16,185,129,0.15)', color: '#10B981',
                border: '1px solid rgba(16,185,129,0.3)',
              }}>
                Files appear in their portal instantly
              </span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexDirection: isMobile ? 'column' : 'row', alignSelf: isMobile ? 'stretch' : 'auto', width: isMobile ? '100%' : 'auto' }}>
                <button
                  type="button"
                  onClick={loadCustomerPreview}
                  title="See exactly what's in this customer's dashboard"
                  style={{
                    fontSize: isMobile ? 13 : 10.5, color: '#3B82F6',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: isMobile ? '8px 10px' : 0, minHeight: isMobile ? 40 : 'auto',
                    width: isMobile ? '100%' : 'auto',
                    textDecoration: 'underline', fontWeight: 600,
                  }}
                >View as customer</button>
                <button
                  type="button"
                  onClick={async () => {
                    const url = window.location.origin + '/project/' + projectId;
                    try {
                      await navigator.clipboard.writeText(url);
                      setUploadOk('Customer URL copied — paste in an email if they say they can\'t find the job.');
                    } catch (_) {
                      setUploadOk('Copy failed — customer URL is ' + url);
                    }
                  }}
                  title={'Customer sees this at /project/' + projectId}
                  style={{
                    fontSize: isMobile ? 13 : 10.5, color: 'var(--text-muted)',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: isMobile ? '8px 10px' : 0, minHeight: isMobile ? 40 : 'auto',
                    width: isMobile ? '100%' : 'auto',
                    textDecoration: 'underline',
                  }}
                >Copy URL</button>
              </div>
            </div>
          </div>
        )}

        {/* Builder Pack / Client Copy entry point. The generator lives in its own
            workspace and needs a portal-readable BOQ on the project — uploading a
            BOQ deliverable (kind "BOQ", .xlsx) wires that up, so once it's present
            we surface a direct link here instead of making the user hunt for it. */}
        {project && project.boq_filename && (
          <Link
            to={`/project/${projectId}/builder-pack`}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 16px', borderRadius: 10, marginBottom: 12,
              background: 'linear-gradient(135deg, rgba(245,158,11,0.1), rgba(168,85,247,0.06))',
              border: '1px solid rgba(245,158,11,0.3)',
              textDecoration: 'none',
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(135deg, #F59E0B, #D97706)',
              color: '#0A0F1C', fontWeight: 800, fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>BP</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                Amend numbers &amp; generate a Client Copy
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Open the Builder Pack workspace — edit line items, add margin, download a branded copy.
              </div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#F59E0B', flexShrink: 0 }}>Open →</span>
          </Link>
        )}

        {/* Customer-dashboard preview — proves the job is (or isn't) visible. */}
        {isAdmin && previewOpen && (
          <div style={{
            padding: '12px 14px', borderRadius: 9, marginBottom: 12,
            background: 'var(--bg-primary)', border: '1px solid var(--border)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8, gap: 10, flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                Customer dashboard preview
                {previewData && previewData.user && (
                  <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>
                    {' '}— what {previewData.user.fullName || previewData.user.email} sees
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setPreviewOpen(false); setPreviewData(null); setPreviewError(''); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: 14, padding: 0,
                }}
                aria-label="Close preview"
              >×</button>
            </div>

            {previewLoading && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading customer's projects…</div>
            )}
            {previewError && (
              <div style={{ fontSize: 12, color: '#EF4444' }}>{previewError}</div>
            )}

            {previewData && !previewLoading && (() => {
              const list = previewData.projects || [];
              const here = list.find((p) => p.id === projectId);
              return (
                <>
                  <div style={{
                    padding: '8px 10px', borderRadius: 7, marginBottom: 8,
                    fontSize: 12, fontWeight: 600,
                    background: here ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)',
                    color: here ? '#10B981' : '#EF4444',
                    border: '1px solid ' + (here ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'),
                  }}>
                    {here
                      ? <><CheckIcon size={14} style={{ verticalAlign: 'middle' }} /> {`This job is in their portal (${here.deliverableCount || 0} doc${here.deliverableCount === 1 ? '' : 's'} ready).`}</>
                      : <><AlertTriangleIcon size={14} style={{ verticalAlign: 'middle' }} /> This job is NOT in the customer's dashboard. They will never see these files — recipient mismatch.</>}
                  </div>

                  {list.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 6, fontStyle: 'italic' }}>
                      This customer has zero projects in their portal.
                    </div>
                  ) : (
                    <div style={{
                      maxHeight: 220, overflowY: 'auto',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}>
                      {list.map((p) => {
                        const isHere = p.id === projectId;
                        return (
                          <div key={p.id} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '7px 10px', borderRadius: 6,
                            background: isHere ? 'rgba(59,130,246,0.08)' : 'transparent',
                            border: '1px solid ' + (isHere ? 'rgba(59,130,246,0.3)' : 'var(--border)'),
                            fontSize: 11.5,
                          }}>
                            <span style={{
                              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              color: 'var(--text-primary)', fontWeight: isHere ? 700 : 500,
                            }}>{p.title}</span>
                            {p.deliverableCount > 0 && (
                              <span style={{
                                padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                                background: 'rgba(16,185,129,0.15)', color: '#10B981',
                              }}>{p.deliverableCount} doc{p.deliverableCount === 1 ? '' : 's'}</span>
                            )}
                            <span style={{ color: 'var(--text-muted)', fontSize: 10.5, fontFamily: 'JetBrains Mono, monospace' }}>
                              {p.status}
                            </span>
                            <span style={{ color: 'var(--text-muted)', fontSize: 10.5 }}>
                              {new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* Admin uploader */}
        {isAdmin && (
          <div style={{
            padding: 14, borderRadius: 10, marginBottom: 14,
            background: 'linear-gradient(135deg, rgba(59,130,246,0.06), rgba(168,85,247,0.04))',
            border: '1px solid rgba(59,130,246,0.25)',
          }}>
            {/* Quick presets — 90% of uploads are BOQ / Findings / both, so make
                those one-click. The dropdown below still covers the rest. */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {[
                { v: 'boq',           l: 'BOQ',                 desc: 'Bill of Quantities' },
                { v: 'findings',      l: 'Findings Report',     desc: 'Findings Report (.docx)' },
                { v: 'marked_drawing',l: 'Marked-up drawing',   desc: 'PDF / image with marks' },
                { v: 'supplier_quote',l: 'Supplier quote',      desc: 'Quote from a supplier' },
              ].map((p) => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => setKind(p.v)}
                  title={p.desc}
                  style={{
                    padding: '6px 11px', borderRadius: 7,
                    fontSize: 11.5, fontWeight: 700,
                    background: kind === p.v ? '#3B82F6' : 'transparent',
                    color: kind === p.v ? '#fff' : 'var(--text-muted)',
                    border: '1px solid ' + (kind === p.v ? '#3B82F6' : 'var(--border)'),
                    cursor: 'pointer',
                  }}
                >{p.l}</button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                disabled={uploading}
                style={{
                  padding: '8px 12px', borderRadius: 8,
                  background: 'var(--bg-card)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', fontSize: 13, outline: 'none',
                }}
              >
                {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={uploading}
                placeholder="Optional note for the customer (e.g. 'v2 — revised pricing')"
                style={{
                  flex: 1, minWidth: 200,
                  padding: '8px 12px', borderRadius: 8,
                  background: 'var(--bg-card)', color: 'var(--text-primary)',
                  border: '1px solid var(--border)', fontSize: 13, outline: 'none',
                }}
              />
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
              style={{
                borderRadius: 10,
                border: '2px dashed ' + (dragOver ? '#3B82F6' : 'var(--border)'),
                background: dragOver ? 'rgba(59,130,246,0.06)' : 'transparent',
                padding: '14px 16px', textAlign: 'center',
                fontSize: 12.5, color: 'var(--text-muted)',
                marginBottom: 8,
              }}
            >
              Drop files here or{' '}
              <button
                type="button"
                onClick={() => {
                  const inp = document.createElement('input');
                  inp.type = 'file';
                  inp.multiple = true;
                  inp.style.position = 'fixed';
                  inp.onchange = (e) => {
                    if (e.target.files && e.target.files.length) addFiles(e.target.files);
                    setTimeout(() => inp.remove(), 0);
                  };
                  document.body.appendChild(inp);
                  inp.click();
                }}
                style={{ background: 'none', border: 'none', color: '#3B82F6', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
              >browse</button>
              {' '}— PDF, Excel, Word, drawings, ZIP. Max 100MB each.
            </div>

            {files.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                {files.map((f, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 6,
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    fontSize: 12,
                  }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{fmtSize(f.size)}</span>
                    <button
                      onClick={() => removeFile(i)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}
                      aria-label="Remove"
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={doUpload}
              disabled={uploading || files.length === 0}
              style={{
                padding: '9px 16px', borderRadius: 8, border: 'none',
                background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
                color: '#fff', fontWeight: 700, fontSize: 13.5,
                cursor: uploading || files.length === 0 ? 'not-allowed' : 'pointer',
                opacity: uploading || files.length === 0 ? 0.55 : 1,
              }}
            >
              {uploading ? 'Uploading…' : 'Send ' + files.length + ' file' + (files.length === 1 ? '' : 's') + ' to customer'}
            </button>

            {uploadOk && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#10B981' }}>{uploadOk}</div>
            )}
          </div>
        )}

        {error && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 10,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
            color: '#EF4444', fontSize: 12.5,
          }}>{error}</div>
        )}

        {/* List */}
        {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 8 }}>Loading…</div>}
        {!loading && latest.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            {isAdmin
              ? 'No files sent to this customer yet. Use the uploader above to send their priced documents.'
              : "Your QS hasn't uploaded any documents for this project yet."}
          </div>
        )}

        {orderedGroups.map((k) => (
          <div key={k} style={{ marginBottom: 12 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: 'var(--text-muted)',
              padding: '6px 2px', marginBottom: 4,
            }}>
              {KIND_LABELS[k] || k}
            </div>
            {byKind[k].map((d) => (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 14px', borderRadius: 9,
                background: 'rgba(16,185,129,0.05)',
                border: '1px solid rgba(16,185,129,0.18)',
                marginBottom: 6,
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                  background: 'rgba(16,185,129,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#10B981', fontWeight: 800, fontSize: 11,
                }}>v{d.version}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.original_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    {fmtSize(d.file_size)} · {new Date(d.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {d.uploaded_by ? ' · ' + d.uploaded_by : ''}
                  </div>
                  {d.notes && (
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', opacity: 0.85, marginTop: 4, fontStyle: 'italic' }}>
                      “{d.notes}”
                    </div>
                  )}
                </div>
                <button
                  onClick={() => downloadFile(d.id, d.filename)}
                  disabled={downloadingId === d.id}
                  style={{
                    padding: '7px 12px', borderRadius: 7, border: 'none',
                    background: 'rgba(16,185,129,0.18)', color: '#10B981',
                    fontWeight: 700, fontSize: 12,
                    cursor: downloadingId === d.id ? 'not-allowed' : 'pointer',
                    opacity: downloadingId === d.id ? 0.55 : 1,
                  }}
                >{downloadingId === d.id ? 'Downloading…' : 'Download'}</button>
                {isAdmin && (
                  <button
                    onClick={() => deleteDeliverable(d.id)}
                    title="Hide from customer"
                    style={{
                      padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)',
                      background: 'transparent', color: 'var(--text-muted)',
                      fontSize: 12, cursor: 'pointer',
                    }}
                  >Hide</button>
                )}
              </div>
            ))}
          </div>
        ))}

        {/* Version history */}
        {history.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => setShowHistory((v) => !v)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '6px 0', color: 'var(--text-muted)',
                fontSize: 12, fontWeight: 600,
              }}
            >
              {showHistory ? '▾' : '▸'} Version history ({history.length})
            </button>
            {showHistory && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {history.map((d) => (
                  <div key={d.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 12px', borderRadius: 7,
                    background: 'var(--bg-primary)', border: '1px solid var(--border)',
                    fontSize: 11.5, color: 'var(--text-muted)',
                  }}>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>v{d.version}</span>
                    <span style={{
                      padding: '1px 6px', borderRadius: 4,
                      background: 'rgba(0,0,0,0.04)',
                      fontSize: 10.5, fontWeight: 600,
                    }}>{KIND_LABELS[d.kind] || d.kind}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)', opacity: 0.7 }}>{d.original_name}</span>
                    <span>{new Date(d.created_at).toLocaleDateString('en-GB')}</span>
                    <button
                      onClick={() => downloadFile(d.id, d.filename)}
                      disabled={downloadingId === d.id}
                      style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: downloadingId === d.id ? 'not-allowed' : 'pointer', fontSize: 11.5, fontWeight: 600, opacity: downloadingId === d.id ? 0.55 : 1 }}
                    >{downloadingId === d.id ? 'Downloading…' : 'Download'}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
