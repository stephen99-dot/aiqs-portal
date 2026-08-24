import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import DeliverablesPanel from '../components/DeliverablesPanel';
import { CheckIcon, AlertTriangleIcon } from '../components/Icons';
import {
  Button, Card, Banner, Input, Select, Textarea, Field,
  PageHeader, EmptyState, SkeletonRows, Modal,
} from '../ui';

// Small uppercase section label used throughout the detail pane.
const sectionLabel = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6,
};
const codeChip = {
  fontFamily: 'var(--font-mono)', background: 'var(--bg-primary)',
  padding: '1px 4px', borderRadius: 3,
};

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
  const [filter, setFilter] = useState('inbox'); // inbox | done | all
  const [creatingProject, setCreatingProject] = useState(false);
  const [linkedProject, setLinkedProject] = useState(null); // { id, ... } loaded for the deliverables panel
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [driveDraft, setDriveDraft] = useState('');
  const [statusMsg, setStatusMsg] = useState(null); // { kind: 'ok'|'err', text }
  // Manual "Add job" — create a job for a customer without waiting for a submission.
  const [showAddJob, setShowAddJob] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [jobDraft, setJobDraft] = useState({ user_id: '', project_type: '', site_address: '', message: '', title: '' });
  const [creatingJob, setCreatingJob] = useState(false);
  const [addJobError, setAddJobError] = useState('');

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
      if (filter === 'inbox' && s.actioned_at) return false; // Inbox = unactioned only
      if (filter === 'done'  && !s.actioned_at) return false; // Done = actioned only
      // 'all' shows everything
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
    // Load the linked project (if any) so the inline DeliverablesPanel
    // shows the customer-context banner with the right contact info.
    setLinkedProject(null);
    if (selected && selected.project_id) {
      apiFetch(`/projects/${selected.project_id}`)
        .then((proj) => setLinkedProject(proj))
        .catch(() => setLinkedProject(null));
    }
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
    patchSubmission(
      s.id,
      { actioned: next },
      next ? 'Marked as actioned — moved to Done' : 'Reopened — back in Inbox'
    );
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

  async function createJobFromSubmission() {
    if (!selected || creatingProject) return;
    setCreatingProject(true);
    setError('');
    try {
      const data = await apiFetch(`/submissions/admin/${selected.id}/create-project`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (data && data.project_id) {
        // Refresh the submissions list so the row picks up the project_id
        await refreshList();
        // Load the new project so the deliverables panel can show it
        const proj = await apiFetch(`/projects/${data.project_id}`);
        setLinkedProject(proj);
        setStatusMsg(data.created ? 'Job created — ready to upload' : 'Linked to existing job');
      }
    } catch (err) {
      setError(err.message || 'Could not create job');
    } finally {
      setCreatingProject(false);
    }
  }

  function openAddJob() {
    setAddJobError('');
    setJobDraft({ user_id: '', project_type: '', site_address: '', message: '', title: '' });
    setShowAddJob(true);
    // Load the customer list lazily — only when the admin opens the form.
    if (customers.length === 0) {
      apiFetch('/admin/users')
        .then((d) => {
          const list = (d.users || d || []).filter((u) => u.role !== 'admin');
          list.sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''));
          setCustomers(list);
        })
        .catch((e) => setAddJobError(e.message || 'Could not load customers'));
    }
  }

  async function submitManualJob(e) {
    if (e) e.preventDefault();
    if (creatingJob) return;
    if (!jobDraft.user_id) { setAddJobError('Pick a customer for this job.'); return; }
    setCreatingJob(true);
    setAddJobError('');
    try {
      const data = await apiFetch('/submissions/admin/manual-job', {
        method: 'POST',
        body: JSON.stringify(jobDraft),
      });
      if (data && data.submission) {
        // Prepend the new job and select it — the detail pane then shows the
        // full deliverables uploader straight away.
        setSubmissions((prev) => [data.submission, ...prev]);
        setSelectedId(data.submission.id);
        setFilter('all'); // manual jobs land actioned, so they live under All/Done
        if (data.project_id) {
          try {
            const proj = await apiFetch(`/projects/${data.project_id}`);
            setLinkedProject(proj);
          } catch (_) { /* ignore */ }
        }
        setStatusMsg({ kind: 'ok', text: 'Job created — ready to upload documents' });
      }
      setShowAddJob(false);
    } catch (err) {
      setAddJobError(err.message || 'Could not create job');
    } finally {
      setCreatingJob(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="page" style={{ padding: '40px 28px' }}>
        <Card>
          <EmptyState
            icon={AlertTriangleIcon}
            title="Admin only"
            body="This page is for admins."
            action={<Button variant="secondary" to="/dashboard">Back to dashboard</Button>}
          />
        </Card>
      </div>
    );
  }

  const unactionedCount = submissions.filter((s) => !s.actioned_at).length;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Add-job modal — create a job for a customer without a submission */}
      {showAddJob && (
        <Modal
          title="Add a job manually"
          onClose={() => { if (!creatingJob) setShowAddJob(false); }}
        >
          <form onSubmit={submitManualJob}>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
              Creates the job in the customer's portal right away. You can then send priced
              documents to them just like a submitted job.
            </p>

            {addJobError && (
              <Banner tone="danger" style={{ padding: '9px 12px', marginBottom: 14, color: 'var(--danger)', fontSize: '0.82rem' }}>
                {addJobError}
              </Banner>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Customer *">
                <Select
                  value={jobDraft.user_id}
                  onChange={(e) => setJobDraft((d) => ({ ...d, user_id: e.target.value }))}
                  required
                >
                  <option value="">Select a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {(c.full_name || c.email)}{c.company ? ' · ' + c.company : ''}{c.full_name && c.email ? ' (' + c.email + ')' : ''}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Site address / job title">
                <Input
                  type="text"
                  value={jobDraft.site_address}
                  onChange={(e) => setJobDraft((d) => ({ ...d, site_address: e.target.value }))}
                  placeholder="e.g. 14 Oak Lane, Leeds"
                />
              </Field>

              <Field label="Job type">
                <Input
                  type="text"
                  value={jobDraft.project_type}
                  onChange={(e) => setJobDraft((d) => ({ ...d, project_type: e.target.value }))}
                  placeholder="e.g. Extension, New build, Refurbishment"
                />
              </Field>

              <Field label="Brief / notes (optional)">
                <Textarea
                  value={jobDraft.message}
                  onChange={(e) => setJobDraft((d) => ({ ...d, message: e.target.value }))}
                  rows={3}
                  placeholder="Anything worth recording about this job."
                />
              </Field>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <Button variant="secondary" onClick={() => setShowAddJob(false)} disabled={creatingJob}>
                Cancel
              </Button>
              <Button type="submit" disabled={creatingJob}>
                {creatingJob ? 'Creating…' : 'Create job'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Header */}
      <PageHeader
        title="Submissions Inbox"
        subtitle={
          <>
            Every drawing submission from the portal — full briefs, files, and your private notes.
            {unactionedCount > 0 && (
              <span style={{ marginLeft: 10, color: 'var(--warning)', fontWeight: 600 }}>
                {unactionedCount} unactioned
              </span>
            )}
          </>
        }
        actions={<Button onClick={openAddJob}>+ Add job manually</Button>}
      />

      {/* Toolbar — segmented filter (no kit tab primitive) + search */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 9, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          {[
            { key: 'inbox', label: 'Inbox', count: unactionedCount },
            { key: 'done',  label: 'Done',  count: submissions.length - unactionedCount },
            { key: 'all',   label: 'All time', count: submissions.length },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                fontFamily: 'var(--font-body)',
                background: filter === tab.key ? 'var(--accent)' : 'transparent',
                color: filter === tab.key ? 'var(--accent-text)' : 'var(--text-muted)',
                border: 'none', cursor: 'pointer',
              }}
            >
              {tab.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{tab.count}</span>
            </button>
          ))}
        </div>
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, project, message…"
          style={{ flex: 1, minWidth: 240 }}
        />
      </div>

      {error && (
        <Banner tone="danger" style={{ padding: '10px 14px', marginBottom: 12, color: 'var(--danger)', fontSize: '0.82rem' }}>
          {error}
        </Banner>
      )}

      {/* Split pane — list left, detail right; stacks under 900px */}
      <div className="ui-split ui-split--side-first" style={{ '--split-side': 'minmax(280px, 380px)' }}>
        {/* List */}
        <Card style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          {loading && <SkeletonRows rows={5} />}
          {!loading && filtered.length === 0 && (
            <EmptyState title="No submissions match" />
          )}
          {filtered.map((s) => {
            const active = s.id === selectedId;
            // Card title is the site address. Older submissions predate the
            // address field, so fall back to the client name (then project
            // type) to keep the card from going blank.
            const hasAddress = !!(s.site_address && s.site_address.trim());
            const title = (hasAddress && s.site_address.trim())
              || s.user_name || s.user_email || s.project_type || 'Untitled job';
            // Keep the submitter visible in the subtitle when the title is the
            // address; for fallback titles it's already the name, so skip it.
            const subtitleParts = [];
            if (hasAddress && (s.user_name || s.user_email)) subtitleParts.push(s.user_name || s.user_email);
            subtitleParts.push(s.project_type || 'Untyped');
            subtitleParts.push(`${s.file_count} file${s.file_count === 1 ? '' : 's'}`);
            return (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                style={{
                  display: 'block', textAlign: 'left',
                  width: '100%', padding: '12px 14px',
                  fontFamily: 'var(--font-body)',
                  background: active ? 'var(--accent-glow)' : 'transparent',
                  borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                  borderTop: 'none', borderRight: 'none',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: 999, flexShrink: 0,
                    background: s.actioned_at ? 'var(--success)' : 'var(--warning)',
                  }} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {new Date(s.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {subtitleParts.join(' · ')}
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
        </Card>

        {/* Detail */}
        <Card style={{ minHeight: 360 }}>
          {!selected ? (
            <EmptyState title="Nothing selected" body="Pick a submission on the left to read the full brief." />
          ) : (
            <Card.Body>
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
                    <Button size="sm" variant="secondary" to={`/project/${selected.project_id}`}>
                      Open project →
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={selected.actioned_at ? 'secondary' : 'primary'}
                    onClick={() => toggleActioned(selected)}
                    disabled={savingId === selected.id}
                    style={selected.actioned_at ? {
                      background: 'var(--success-bg)', color: 'var(--success)',
                      borderColor: 'color-mix(in srgb, var(--success) 40%, transparent)',
                    } : undefined}
                  >
                    {selected.actioned_at ? <><CheckIcon size={14} /> Done</> : 'Mark as actioned'}
                  </Button>
                </div>
              </div>

              {/* Status banner — shows save confirmation or error from the last action */}
              {statusMsg && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 12px', borderRadius: 7, marginBottom: 12,
                  background: statusMsg.kind === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)',
                  border: '1px solid ' + (statusMsg.kind === 'ok'
                    ? 'color-mix(in srgb, var(--success) 30%, transparent)'
                    : 'color-mix(in srgb, var(--danger) 30%, transparent)'),
                  color: statusMsg.kind === 'ok' ? 'var(--success)' : 'var(--danger)',
                  fontSize: 12.5, fontWeight: 600,
                }}>
                  {statusMsg.kind === 'ok' ? <CheckIcon size={14} /> : <AlertTriangleIcon size={14} />} {statusMsg.text}
                </div>
              )}

              {/* Meta strip */}
              <div style={{
                display: 'flex', gap: 12, flexWrap: 'wrap',
                padding: '10px 14px', borderRadius: 8, marginBottom: 18,
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                fontSize: 11.5,
              }}>
                <span><span style={{ color: 'var(--text-muted)' }}>Submitted</span>{' '}<strong>{new Date(selected.created_at).toLocaleString('en-GB')}</strong></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Site</span>{' '}<strong>{selected.site_address || '—'}</strong></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Type</span>{' '}<strong>{selected.project_type || '—'}</strong></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Files</span>{' '}<strong>{selected.file_count}</strong></span>
                <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.6 }}>{selected.submission_id}</span>
                {selected.actioned_at && (
                  <span style={{ color: 'var(--success)' }}><CheckIcon size={14} style={{ verticalAlign: 'middle' }} /> {selected.actioned_by} · {new Date(selected.actioned_at).toLocaleDateString('en-GB')}</span>
                )}
              </div>

              {/* Full message */}
              <div style={{ marginBottom: 18 }}>
                <div style={sectionLabel}>Full brief</div>
                <div style={{
                  padding: '14px 16px', borderRadius: 10,
                  background: 'var(--bg-primary)', border: '1px solid var(--border)',
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
                <div style={sectionLabel}>Google Drive folder</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
                  <Input
                    type="url"
                    value={driveDraft}
                    onChange={(e) => setDriveDraft(e.target.value)}
                    onBlur={saveDriveLink}
                    placeholder="https://drive.google.com/drive/folders/…  (paste here, saves on blur)"
                    style={{ flex: 1, minWidth: 280 }}
                  />
                  {selected.drive_link ? (
                    <Button variant="soft" href={selected.drive_link} target="_blank" rel="noopener noreferrer">
                      Open in Drive ↗
                    </Button>
                  ) : (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      padding: '10px 14px', fontSize: 11.5, color: 'var(--text-muted)',
                    }}>Saves on blur</span>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic', lineHeight: 1.5 }}>
                  Add a Pipedream HTTP step that POSTs <code style={codeChip}>{'{ submission_id, drive_link, secret }'}</code> to <code style={codeChip}>/api/submissions/webhook/drive-link</code> after upload — the link will appear here automatically. Or paste it manually for now (saves on blur).
                </div>
              </div>

              {/* Send deliverables to this customer (the "return leg" — wires the
                  inbox directly into the deliverables uploader so admin doesn't
                  have to navigate to a project page first). */}
              <div style={{ marginBottom: 18 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  marginBottom: 6,
                }}>
                  <div style={{ ...sectionLabel, marginBottom: 0 }}>
                    Send priced documents to {selected.user_name || 'customer'}
                  </div>
                  {selected.project_id && (
                    <Link
                      to={`/project/${selected.project_id}`}
                      style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--info)', textDecoration: 'none' }}
                    >Open job →</Link>
                  )}
                </div>

                {!selected.project_id ? (
                  <div style={{
                    padding: 16, borderRadius: 10,
                    background: 'var(--accent-glow)', border: '1px dashed var(--border-accent)',
                    textAlign: 'center',
                  }}>
                    <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                      No job exists for this submission yet. Create one to send priced BOQs, drawings, or supplier quotes to{' '}
                      <strong>{selected.user_name || selected.user_email}</strong>.
                    </p>
                    <Button
                      onClick={createJobFromSubmission}
                      disabled={creatingProject}
                      busyLabel="Creating job…"
                    >
                      {creatingProject ? 'Creating job…' : 'Create job & start upload'}
                    </Button>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic' }}>
                      The job will appear in the customer's portal immediately. Status: In progress.
                    </div>
                  </div>
                ) : (
                  <DeliverablesPanel projectId={selected.project_id} project={linkedProject} />
                )}
              </div>

              {/* Files */}
              {Array.isArray(selected.file_names) && selected.file_names.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={sectionLabel}>Files ({selected.file_names.length})</div>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {selected.file_names.map((name, i) => {
                      const baseStyle = {
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 12px', borderRadius: 7,
                        background: 'var(--bg-primary)', border: '1px solid var(--border)',
                        fontSize: 12.5, fontFamily: 'var(--font-mono)',
                        color: 'var(--text-primary)', wordBreak: 'break-all',
                        textDecoration: 'none',
                      };
                      if (selected.drive_link) {
                        return (
                          <li key={i}>
                            <a href={selected.drive_link} target="_blank" rel="noopener noreferrer"
                              style={{ ...baseStyle, cursor: 'pointer' }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--info-bg)'; e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--info) 35%, transparent)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-primary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                            >
                              <span style={{ flex: 1 }}>{name}</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--info)', fontFamily: 'var(--font-body)' }}>Open in Drive ↗</span>
                            </a>
                          </li>
                        );
                      }
                      return (
                        <li key={i} style={baseStyle}>
                          <span style={{ flex: 1 }}>{name}</span>
                          <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-body)', fontStyle: 'italic' }}>Add Drive link to open</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Admin private notes */}
              <div>
                <div style={sectionLabel}>Private notes (admin only)</div>
                <Textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={saveNotes}
                  rows={4}
                  placeholder="Notes on this job — not visible to the customer."
                  style={{ minHeight: 90 }}
                />
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                  Saved when you click outside the box.
                  {savingId === selected.id ? ' · Saving…' : ''}
                </div>
              </div>
            </Card.Body>
          )}
        </Card>
      </div>
    </div>
  );
}
