import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

/**
 * Admin-only inbox of all customer drawing submissions. Replaces the
 * truncated toast notifications — full message, full file list, status,
 * private admin notes. Split-pane: list on the left, detail on the right.
 */
export default function SubmissionsInboxPage() {
  const { user } = useAuth();
  const [submissions, setSubmissions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // all | unactioned | actioned
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [driveDraft, setDriveDraft] = useState('');
  const [statusMsg, setStatusMsg] = useState(null); // { kind: 'ok'|'err', text }

  const isAdmin = user && user.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    apiFetch('/submissions/admin/all')
      .then((data) => {
        if (cancelled) return;
        const subs = data.submissions || [];
        setSubmissions(subs);
        if (subs.length && !selectedId) setSelectedId(subs[0].id);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load submissions'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin]); // eslint-disable-line

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return submissions.filter((s) => {
      if (filter === 'unactioned' && s.actioned_at) return false;
      if (filter === 'actioned' && !s.actioned_at) return false;
      if (!q) return true;
      const hay = [
        s.user_name, s.user_email, s.user_company,
        s.project_type, s.message, s.submission_id,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [submissions, filter, search]);

  const selected = useMemo(
    () => submissions.find((s) => s.id === selectedId) || null,
    [submissions, selectedId]
  );

  useEffect(() => {
    setNotesDraft(selected ? (selected.admin_notes || '') : '');
    setDriveDraft(selected ? (selected.drive_link || '') : '');
    setStatusMsg(null);
  }, [selectedId]); // eslint-disable-line

  // Auto-clear ephemeral status banner after 2.5s
  useEffect(() => {
    if (!statusMsg) return;
    const t = setTimeout(() => setStatusMsg(null), 2500);
    return () => clearTimeout(t);
  }, [statusMsg]);

  async function refreshList() {
    try {
      const data = await apiFetch('/submissions/admin/all');
      setSubmissions(data.submissions || []);
    } catch (e) { /* ignore */ }
  }

  async function patchSubmission(id, body, okMsg) {
    setSavingId(id);
    setError('');
    try {
      const data = await apiFetch(`/submissions/admin/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (data && data.submission) {
        setSubmissions((prev) => prev.map((s) => (s.id === id ? data.submission : s)));
      } else {
        // Belt-and-braces: if the response shape is unexpected, still refresh
        await refreshList();
      }
      if (okMsg) setStatusMsg({ kind: 'ok', text: okMsg });
    } catch (err) {
      const msg = err && err.message ? err.message : 'Save failed';
      setError(msg);
      setStatusMsg({ kind: 'err', text: msg });
    } finally {
      setSavingId(null);
    }
  }

  function toggleActioned(s) {
    const next = !s.actioned_at;
    patchSubmission(s.id, { actioned: next }, next ? 'Marked as actioned' : 'Reopened — back to unactioned');
  }

  function saveNotes() {
    if (!selected) return;
    if ((selected.admin_notes || '') === (notesDraft || '')) return;
    patchSubmission(selected.id, { admin_notes: notesDraft }, 'Notes saved');
  }

  function saveDriveLink() {
    if (!selected) return;
    if ((selected.drive_link || '') === (driveDraft || '').trim()) return;
    patchSubmission(selected.id, { drive_link: driveDraft.trim() }, 'Drive link saved');
  }

  if (!isAdmin) {
    return (
      <div className="page" style={{ padding: '40px 28px' }}>
        <div className="empty-state">
          <h3>Admin only</h3>
          <p style={{ color: 'var(--text-muted)' }}>This page is for admins.</p>
          <Link to="/dashboard" className="btn-secondary" style={{ marginTop: 16 }}>Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const unactionedCount = submissions.filter((s) => !s.actioned_at).length;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em',
        }}>
          Submissions Inbox
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5, margin: '4px 0 0' }}>
          Every drawing submission from the portal — full briefs, files, and your private notes.
          {unactionedCount > 0 && (
            <span style={{ marginLeft: 10, color: '#F59E0B', fontWeight: 600 }}>
              {unactionedCount} unactioned
            </span>
          )}
        </p>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 9, background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
          {[
            { key: 'all', label: 'All', count: submissions.length },
            { key: 'unactioned', label: 'Unactioned', count: unactionedCount },
            { key: 'actioned', label: 'Done', count: submissions.length - unactionedCount },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                background: filter === tab.key ? '#F59E0B' : 'transparent',
                color: filter === tab.key ? '#0A0F1C' : 'var(--text-muted)',
                border: 'none', cursor: 'pointer',
              }}
            >
              {tab.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{tab.count}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, project, message…"
          style={{
            flex: 1, minWidth: 240,
            padding: '8px 12px', borderRadius: 8,
            background: 'var(--card-bg)', color: 'var(--text-primary)',
            border: '1px solid var(--border)', fontSize: 13, outline: 'none',
          }}
        />
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 12, borderRadius: 8,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
          color: '#EF4444', fontSize: 13,
        }}>{error}</div>
      )}

      {/* Split pane */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: 16, alignItems: 'flex-start' }}>
        {/* List */}
        <div style={{
          maxHeight: 'calc(100vh - 220px)', overflowY: 'auto',
          borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card-bg)',
        }}>
          {loading && <div style={{ padding: 18, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
              No submissions match.
            </div>
          )}
          {filtered.map((s) => {
            const active = s.id === selectedId;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                style={{
                  display: 'block', textAlign: 'left',
                  width: '100%', padding: '12px 14px',
                  background: active ? 'rgba(245,158,11,0.08)' : 'transparent',
                  borderLeft: active ? '3px solid #F59E0B' : '3px solid transparent',
                  borderTop: 'none', borderRight: 'none',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: 999, flexShrink: 0,
                    background: s.actioned_at ? '#10B981' : '#F59E0B',
                  }} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.user_name || s.user_email}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {new Date(s.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.project_type || 'Untyped'} · {s.file_count} file{s.file_count === 1 ? '' : 's'}
                </div>
                <div style={{
                  fontSize: 12, color: 'var(--text-primary)', opacity: 0.8,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', lineHeight: 1.4,
                }}>
                  {s.message || <em style={{ opacity: 0.5 }}>(no message)</em>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail */}
        <div style={{
          padding: 22, minHeight: 360,
          borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card-bg)',
        }}>
          {!selected ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13.5 }}>
              Pick a submission on the left to read the full brief.
            </div>
          ) : (
            <div>
              {/* Customer */}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                    {selected.user_name}
                    {selected.user_company ? <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}> · {selected.user_company}</span> : null}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    <a href={`mailto:${selected.user_email}`} style={{ color: 'inherit' }}>{selected.user_email}</a>
                    {selected.user_phone ? <> · <a href={`tel:${selected.user_phone}`} style={{ color: 'inherit' }}>{selected.user_phone}</a></> : null}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {selected.project_id && (
                    <Link
                      to={`/project/${selected.project_id}`}
                      style={{
                        padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                        background: 'rgba(59,130,246,0.12)', color: '#3B82F6',
                        border: '1px solid rgba(59,130,246,0.3)',
                        textDecoration: 'none',
                      }}
                    >Open project →</Link>
                  )}
                  <button
                    onClick={() => toggleActioned(selected)}
                    disabled={savingId === selected.id}
                    style={{
                      padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                      background: selected.actioned_at ? 'rgba(16,185,129,0.12)' : '#F59E0B',
                      color: selected.actioned_at ? '#10B981' : '#0A0F1C',
                      border: selected.actioned_at ? '1px solid rgba(16,185,129,0.4)' : 'none',
                      cursor: savingId === selected.id ? 'wait' : 'pointer',
                    }}
                  >
                    {selected.actioned_at ? '✓ Done' : 'Mark as actioned'}
                  </button>
                </div>
              </div>

              {/* Status banner — shows save confirmation or error from the last action */}
              {statusMsg && (
                <div style={{
                  padding: '8px 12px', borderRadius: 7, marginBottom: 12,
                  background: statusMsg.kind === 'ok' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                  border: '1px solid ' + (statusMsg.kind === 'ok' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'),
                  color: statusMsg.kind === 'ok' ? '#10B981' : '#EF4444',
                  fontSize: 12.5, fontWeight: 600,
                }}>
                  {statusMsg.kind === 'ok' ? '✓ ' : '⚠ '}{statusMsg.text}
                </div>
              )}

              {/* Meta strip */}
              <div style={{
                display: 'flex', gap: 12, flexWrap: 'wrap',
                padding: '10px 14px', borderRadius: 8, marginBottom: 18,
                background: 'var(--bg)', border: '1px solid var(--border)',
                fontSize: 11.5,
              }}>
                <span><span style={{ color: 'var(--text-muted)' }}>Submitted</span>{' '}<strong>{new Date(selected.created_at).toLocaleString('en-GB')}</strong></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Type</span>{' '}<strong>{selected.project_type || '—'}</strong></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Files</span>{' '}<strong>{selected.file_count}</strong></span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', opacity: 0.6 }}>{selected.submission_id}</span>
                {selected.actioned_at && (
                  <span style={{ color: '#10B981' }}>✓ {selected.actioned_by} · {new Date(selected.actioned_at).toLocaleDateString('en-GB')}</span>
                )}
              </div>

              {/* Full message */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                  Full brief
                </div>
                <div style={{
                  padding: '14px 16px', borderRadius: 10,
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-primary)',
                  maxHeight: 360, overflowY: 'auto',
                }}>
                  {selected.message || <em style={{ color: 'var(--text-muted)' }}>(no message provided)</em>}
                </div>
              </div>

              {/* Drive link — files are uploaded to Google Drive (via Pipedream),
                  not stored locally, so we keep the Drive folder URL here for one-click
                  access from this inbox. */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                  Google Drive folder
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
                  <input
                    type="url"
                    value={driveDraft}
                    onChange={(e) => setDriveDraft(e.target.value)}
                    onBlur={saveDriveLink}
                    placeholder="https://drive.google.com/drive/folders/…  (paste here, saves on blur)"
                    style={{
                      flex: 1, minWidth: 280,
                      padding: '10px 14px', borderRadius: 9,
                      background: 'var(--bg)', color: 'var(--text-primary)',
                      border: '1px solid var(--border)', fontSize: 13,
                      outline: 'none', fontFamily: 'inherit',
                    }}
                  />
                  {selected.drive_link ? (
                    <a
                      href={selected.drive_link}
                      target="_blank" rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '10px 16px', borderRadius: 9,
                        background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
                        color: '#fff', fontSize: 13, fontWeight: 700,
                        textDecoration: 'none',
                        boxShadow: '0 2px 8px rgba(59,130,246,0.25)',
                      }}
                    >Open in Drive ↗</a>
                  ) : (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      padding: '10px 14px', fontSize: 11.5, color: 'var(--text-muted)',
                    }}>Saves on blur</span>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                  Pipedream uploads the customer's files to Drive — paste the Drive folder URL once and the file rows below become one-click links.
                </div>
              </div>

              {/* Files */}
              {Array.isArray(selected.file_names) && selected.file_names.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                    Files ({selected.file_names.length})
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {selected.file_names.map((name, i) => {
                      const baseStyle = {
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 12px', borderRadius: 7,
                        background: 'var(--bg)', border: '1px solid var(--border)',
                        fontSize: 12.5, fontFamily: 'JetBrains Mono, monospace',
                        color: 'var(--text-primary)', wordBreak: 'break-all',
                        textDecoration: 'none',
                      };
                      if (selected.drive_link) {
                        return (
                          <li key={i}>
                            <a href={selected.drive_link} target="_blank" rel="noopener noreferrer"
                              style={{ ...baseStyle, cursor: 'pointer' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(59,130,246,0.06)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.35)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                            >
                              <span style={{ flex: 1 }}>{name}</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#3B82F6', fontFamily: 'system-ui' }}>Open in Drive ↗</span>
                            </a>
                          </li>
                        );
                      }
                      return (
                        <li key={i} style={baseStyle}>
                          <span style={{ flex: 1 }}>{name}</span>
                          <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'system-ui', fontStyle: 'italic' }}>Add Drive link to open</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Admin private notes */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
                  Private notes (admin only)
                </div>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={saveNotes}
                  rows={4}
                  placeholder="Notes on this job — not visible to the customer."
                  style={{
                    width: '100%', padding: '11px 14px', borderRadius: 9,
                    background: 'var(--bg)', color: 'var(--text-primary)',
                    border: '1px solid var(--border)', fontSize: 13,
                    outline: 'none', resize: 'vertical', minHeight: 90,
                    fontFamily: 'inherit', lineHeight: 1.55,
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                  Saved when you click outside the box.
                  {savingId === selected.id ? ' · Saving…' : ''}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
