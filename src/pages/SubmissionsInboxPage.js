import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import DeliverablesPanel from '../components/DeliverablesPanel';
import { CheckIcon, AlertTriangleIcon, ClockIcon, InboxIcon, ZapIcon, HandIcon, UserIcon } from '../components/Icons';
import {
  Button, Card, Banner, Input, Select, Textarea, Field, Badge, Stat,
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

// Fallback stage list, used only for the flash before /admin/all responds.
// The server's list (server/jobStages.js) is authoritative and replaces this.
const FALLBACK_STAGES = [{ key: 'new', label: 'New', tone: 'warning' }];

// ISO timestamp → the YYYY-MM-DD an <input type="date"> wants.
function toDateInput(value) {
  if (!value) return '';
  const str = String(value).trim();
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str);
  const d = new Date(sqlite ? str.replace(' ', 'T') + 'Z' : str);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function fmtDate(value) {
  if (!value) return '—';
  const str = String(value).trim();
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str);
  const d = new Date(sqlite ? str.replace(' ', 'T') + 'Z' : str);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(value) {
  if (!value) return '—';
  const str = String(value).trim();
  const sqlite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str);
  const d = new Date(sqlite ? str.replace(' ', 'T') + 'Z' : str);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// "Today" / "3 days" — how long the customer has been waiting, in the words
// somebody would actually use when asked.
function waitingLabel(days) {
  if (typeof days !== 'number') return '';
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day';
  return days + ' days';
}

/**
 * Admin-only queue of every job, whatever door it came in through — portal
 * submissions and email/phone enquiries logged by hand sit in the same list,
 * at the same stages, measured from the same clock.
 *
 * Split-pane: queue on the left, the job and its full history on the right.
 */
// Step a YYYY-MM-DD day key without going near the local timezone — midday
// UTC is far enough from either midnight that a DST change cannot roll it into
// the wrong date.
function shiftDay(day, delta) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function dayLabel(day, today) {
  if (!day) return '';
  if (day === today) return 'Today';
  if (today && day === shiftDay(today, -1)) return 'Yesterday';
  return new Date(day + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

// Names in the office are email addresses. The local part is what people
// actually call each other, and it is what fits in a table cell.
function personName(actor) {
  if (!actor) return '—';
  const at = actor.indexOf('@');
  return at > 0 ? actor.slice(0, at) : actor;
}

export default function SubmissionsInboxPage() {
  const { user } = useAuth();
  const [submissions, setSubmissions] = useState([]);
  const [stages, setStages] = useState(FALLBACK_STAGES);
  const [sources, setSources] = useState([]);
  const [owners, setOwners] = useState([]);
  const [summary, setSummary] = useState(null);
  const [turnaroundDays, setTurnaroundDays] = useState(3);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('open'); // open | mine | overdue | delivered | all | <stage key>
  const [creatingProject, setCreatingProject] = useState(false);
  const [linkedProject, setLinkedProject] = useState(null);
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [driveDraft, setDriveDraft] = useState('');
  const [statusMsg, setStatusMsg] = useState(null); // { kind: 'ok'|'err', text }
  const [events, setEvents] = useState([]);
  const [noteDraft, setNoteDraft] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  // Manual "Add job" — log an email or phone enquiry into the same queue.
  // Day sheet — what got done, and by whom. Its own fetch: the queue reloads on
  // every stage change, and re-pulling a fortnight of history each time would
  // be waste.
  const [daySheet, setDaySheet] = useState(null);
  const [daySheetDate, setDaySheetDate] = useState('');
  const [daySheetLoading, setDaySheetLoading] = useState(false);
  const [daySheetError, setDaySheetError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const [showAddJob, setShowAddJob] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [jobDraft, setJobDraft] = useState(null);
  const [creatingJob, setCreatingJob] = useState(false);
  const [addJobError, setAddJobError] = useState('');

  const isAdmin = user && user.role === 'admin';
  const myEmail = (user && user.email) || '';

  const stageByKey = useMemo(() => {
    const m = {};
    for (const s of stages) m[s.key] = s;
    return m;
  }, [stages]);

  const applyListPayload = useCallback((data) => {
    setSubmissions(data.submissions || []);
    if (Array.isArray(data.stages) && data.stages.length) setStages(data.stages);
    if (Array.isArray(data.sources)) setSources(data.sources);
    if (Array.isArray(data.owners)) setOwners(data.owners);
    if (data.summary) setSummary(data.summary);
    if (data.turnaround_days) setTurnaroundDays(data.turnaround_days);
  }, []);

  const loadDaySheet = useCallback((date) => {
    setDaySheetLoading(true);
    setDaySheetError('');
    apiFetch('/submissions/admin/day-sheet?days=14' + (date ? '&date=' + date : ''))
      .then((data) => {
        setDaySheet(data);
        setDaySheetDate(data.date);
      })
      .catch((err) => setDaySheetError(err.message || 'Could not load the day sheet'))
      .finally(() => setDaySheetLoading(false));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadDaySheet('');
  }, [isAdmin, loadDaySheet]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    setLoading(true);
    apiFetch('/submissions/admin/all')
      .then((data) => {
        if (cancelled) return;
        applyListPayload(data);
        const subs = data.submissions || [];
        if (subs.length && !selectedId) setSelectedId(subs[0].id);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load submissions'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin]); // eslint-disable-line

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return submissions.filter((s) => {
      const stage = s.stage || 'new';
      if (view === 'open' && stage === 'delivered') return false;
      else if (view === 'mine' && (stage === 'delivered' || s.owner !== myEmail)) return false;
      else if (view === 'overdue' && !s.overdue) return false;
      else if (view === 'delivered' && stage !== 'delivered') return false;
      else if (view !== 'open' && view !== 'mine' && view !== 'overdue'
               && view !== 'delivered' && view !== 'all' && stage !== view) return false;
      if (!q) return true;
      const hay = [
        s.user_name, s.user_email, s.user_company,
        s.project_type, s.site_address, s.message, s.submission_id, s.owner,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [submissions, view, search, myEmail]);

  const selected = useMemo(
    () => submissions.find((s) => s.id === selectedId) || null,
    [submissions, selectedId]
  );

  const loadEvents = useCallback((id) => {
    if (!id) { setEvents([]); return; }
    apiFetch(`/submissions/admin/${id}/events`)
      .then((d) => setEvents(d.events || []))
      .catch(() => setEvents([]));
  }, []);

  useEffect(() => {
    setNotesDraft(selected ? (selected.admin_notes || '') : '');
    setDriveDraft(selected ? (selected.drive_link || '') : '');
    setNoteDraft('');
    setStatusMsg(null);
    loadEvents(selectedId);
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
      applyListPayload(await apiFetch('/submissions/admin/all'));
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
        // The summary counts every row, so a stage move changes it — pull the
        // list back so the tiles above can never disagree with the queue below.
        refreshList();
      } else {
        await refreshList();
      }
      loadEvents(id);
      // A stage move is the day sheet's raw material — delivering a job should
      // show up in today's figures without a page reload.
      if (body && (body.stage || Object.prototype.hasOwnProperty.call(body, 'actioned'))) {
        loadDaySheet(daySheetDate);
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

  function moveToStage(s, stageKey) {
    if (!s || (s.stage || 'new') === stageKey) return;
    const label = (stageByKey[stageKey] && stageByKey[stageKey].label) || stageKey;
    patchSubmission(s.id, { stage: stageKey }, 'Moved to ' + label);
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

  async function addNote() {
    if (!selected || addingNote) return;
    const text = noteDraft.trim();
    if (!text) return;
    setAddingNote(true);
    try {
      const data = await apiFetch(`/submissions/admin/${selected.id}/note`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      setEvents(data.events || []);
      setNoteDraft('');
      setStatusMsg({ kind: 'ok', text: 'Note added to the history' });
    } catch (err) {
      setStatusMsg({ kind: 'err', text: err.message || 'Could not add note' });
    } finally {
      setAddingNote(false);
    }
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
        await refreshList();
        const proj = await apiFetch(`/projects/${data.project_id}`);
        setLinkedProject(proj);
        loadEvents(selected.id);
        setStatusMsg({ kind: 'ok', text: data.created ? 'Job created — ready to upload' : 'Linked to existing job' });
      }
    } catch (err) {
      setError(err.message || 'Could not create job');
    } finally {
      setCreatingProject(false);
    }
  }

  function openAddJob() {
    setAddJobError('');
    setJobDraft({
      user_id: '', project_type: '', site_address: '', message: '', title: '',
      // An email enquiry is the common case for a hand-logged job, and it
      // arrived when it arrived — default to today but make it editable, since
      // these are usually typed in after the fact.
      source: 'email',
      received_at: new Date().toISOString().slice(0, 10),
    });
    setShowAddJob(true);
    setCustomerSearch('');
    if (customers.length === 0) {
      setCustomersLoading(true);
      apiFetch('/admin/users')
        .then((d) => {
          const list = (d.users || d || []).filter((u) => u.role !== 'admin');
          list.sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''));
          setCustomers(list);
        })
        .catch((e) => setAddJobError(e.message || 'Could not load customers'))
        .finally(() => setCustomersLoading(false));
    }
  }

  async function submitManualJob(e) {
    if (e) e.preventDefault();
    if (creatingJob || !jobDraft) return;
    if (!jobDraft.user_id) { setAddJobError('Pick a customer for this job.'); return; }
    setCreatingJob(true);
    setAddJobError('');
    try {
      const data = await apiFetch('/submissions/admin/manual-job', {
        method: 'POST',
        body: JSON.stringify(jobDraft),
      });
      if (data && data.submission) {
        await refreshList();
        // Logging an email job is work — count it straight away.
        loadDaySheet(daySheetDate);
        setSelectedId(data.submission.id);
        // Hand-logged jobs now start at the front of the queue like any other,
        // so the default Open view is where it lands — no need to switch away.
        setView('open');
        if (data.project_id) {
          try {
            const proj = await apiFetch(`/projects/${data.project_id}`);
            setLinkedProject(proj);
          } catch (_) { /* ignore */ }
        }
        setStatusMsg({ kind: 'ok', text: 'Job logged — it is in the queue' });
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

  const openCount = submissions.filter((s) => (s.stage || 'new') !== 'delivered').length;
  const mineCount = submissions.filter((s) => (s.stage || 'new') !== 'delivered' && s.owner === myEmail).length;
  const overdueCount = submissions.filter((s) => s.overdue).length;
  const deliveredCount = submissions.length - openCount;

  const tabs = [
    { key: 'open', label: 'Open', count: openCount },
    { key: 'mine', label: 'Mine', count: mineCount },
    { key: 'overdue', label: 'Late', count: overdueCount },
    ...stages
      .filter((st) => st.key !== 'delivered')
      .map((st) => ({
        key: st.key,
        label: st.label,
        count: submissions.filter((s) => (s.stage || 'new') === st.key).length,
      })),
    { key: 'delivered', label: 'Delivered', count: deliveredCount },
    { key: 'all', label: 'All time', count: submissions.length },
  ];

  const selectedStage = selected ? (stageByKey[selected.stage] || stageByKey.new || FALLBACK_STAGES[0]) : null;

  // Customer picker for the Log-a-job modal. A dropdown of every account is
  // unusable once the list is long, so it is a search over name, company and
  // email instead — the three things somebody has to hand when an enquiry
  // comes in by email.
  const chosenCustomer = jobDraft
    ? customers.find((c) => c.id === jobDraft.user_id) || null
    : null;
  const customerMatches = (() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [c.full_name, c.email, c.company, c.phone].filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  })();

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>
      {/* Add-job modal — log an email or phone enquiry into the same queue */}
      {showAddJob && jobDraft && (
        <Modal
          title="Log a job"
          onClose={() => { if (!creatingJob) setShowAddJob(false); }}
        >
          <form onSubmit={submitManualJob}>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
              For enquiries that arrived by email or phone rather than through the portal.
              It joins the same queue at the same stage, so nothing is tracked in two places.
            </p>

            {addJobError && (
              <Banner tone="danger" style={{ padding: '9px 12px', marginBottom: 14, color: 'var(--danger)', fontSize: '0.82rem' }}>
                {addJobError}
              </Banner>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="ui-field">
                <span className="ui-field__label">Customer *</span>
                {chosenCustomer ? (
                  // Chosen — collapse to the one name, so the rest of the form
                  // is not buried under a list.
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 8,
                    background: 'var(--accent-glow)', border: '1px solid var(--border-accent)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {chosenCustomer.full_name || chosenCustomer.email}
                        {chosenCustomer.company ? <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}> · {chosenCustomer.company}</span> : null}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {chosenCustomer.email}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => { setJobDraft((d) => ({ ...d, user_id: '' })); setCustomerSearch(''); }}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      type="search"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter takes the top match — the common case is typing
                        // enough of a name to leave exactly one.
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (customerMatches.length > 0) {
                            setJobDraft((d) => ({ ...d, user_id: customerMatches[0].id }));
                          }
                        }
                      }}
                      placeholder={customersLoading ? 'Loading customers…' : 'Search by name, company or email…'}
                      autoFocus
                      disabled={customersLoading}
                    />
                    <div style={{
                      marginTop: 6, maxHeight: 210, overflowY: 'auto',
                      border: '1px solid var(--border)', borderRadius: 8,
                      background: 'var(--bg-primary)',
                    }}>
                      {customersLoading && (
                        <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                          Loading customers…
                        </div>
                      )}
                      {!customersLoading && customerMatches.length === 0 && (
                        <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                          {customers.length === 0
                            ? 'No customers on the account yet.'
                            : <>No customer matches “{customerSearch.trim()}”. They may need an account first.</>}
                        </div>
                      )}
                      {!customersLoading && customerMatches.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setJobDraft((d) => ({ ...d, user_id: c.id }))}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '9px 12px', border: 'none',
                            borderBottom: '1px solid var(--border)',
                            background: 'transparent', cursor: 'pointer',
                            fontFamily: 'var(--font-body)',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {c.full_name || c.email}
                            {c.company ? <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}> · {c.company}</span> : null}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {c.email}
                          </div>
                        </button>
                      ))}
                    </div>
                    {!customersLoading && customers.length > 0 && (
                      <span className="ui-field__hint">
                        {customerSearch.trim()
                          ? customerMatches.length + ' of ' + customers.length + ' customers'
                          : customers.length + ' customers — start typing to narrow it down'}
                      </span>
                    )}
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Field label="Came in by" style={{ flex: 1, minWidth: 150 }}>
                  <Select
                    value={jobDraft.source}
                    onChange={(e) => setJobDraft((d) => ({ ...d, source: e.target.value }))}
                  >
                    {(sources.length ? sources : [{ key: 'email', label: 'Email' }]).map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Enquiry arrived on *" style={{ flex: 1, minWidth: 150 }}>
                  <Input
                    type="date"
                    value={jobDraft.received_at}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setJobDraft((d) => ({ ...d, received_at: e.target.value }))}
                    required
                  />
                </Field>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -8, lineHeight: 1.5 }}>
                Use the date the email actually landed, not today — every waiting time and
                late flag is measured from this. Target date is set {turnaroundDays} day
                {turnaroundDays === 1 ? '' : 's'} after it.
              </div>

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
                  placeholder="Paste the email, or anything worth recording about this job."
                />
              </Field>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <Button variant="secondary" onClick={() => setShowAddJob(false)} disabled={creatingJob}>
                Cancel
              </Button>
              <Button type="submit" disabled={creatingJob}>
                {creatingJob ? 'Logging…' : 'Log job'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Header */}
      <PageHeader
        title="Job Queue"
        subtitle="Every job in one place — portal submissions and email enquiries, at the same stages, on the same clock."
        actions={<Button onClick={openAddJob}>+ Log a job</Button>}
      />

      {/* The owner's view: what is outstanding, what has not been started, and
          what has run past its date. Reads off the same rows as the list below. */}
      {summary && (
        <div className="ui-stat-grid" style={{
          display: 'grid', gap: 12, marginBottom: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        }}>
          <Stat icon={InboxIcon} tone={summary.unstarted > 0 ? 'warning' : 'neutral'}
            value={summary.unstarted} label="Not started" />
          <Stat icon={ZapIcon} tone="info" value={summary.in_progress} label="In progress" />
          <Stat icon={AlertTriangleIcon} tone={summary.overdue > 0 ? 'danger' : 'neutral'}
            value={summary.overdue} label="Past target date" />
          <Stat icon={HandIcon} tone={summary.on_hold > 0 ? 'violet' : 'neutral'}
            value={summary.on_hold} label="On hold" />
          <Stat icon={ClockIcon} tone={summary.oldest_waiting_days > turnaroundDays ? 'danger' : 'neutral'}
            value={waitingLabel(summary.oldest_waiting_days) || '—'} label="Longest wait" />
          <Stat icon={UserIcon} tone={summary.unassigned > 0 ? 'warning' : 'neutral'}
            value={summary.unassigned} label="Nobody assigned" />
        </div>
      )}

      {/* ── Day sheet ─────────────────────────────────────────────────────────
          The tiles above are what is outstanding. This is what got done, which
          you cannot read off a queue: a delivered job leaves the list and takes
          its evidence with it. Per person, because "how many did we get out"
          and "how many did she get out" are different questions. */}
      <Card style={{ marginBottom: 16 }}>
        <Card.Header title="What we got done">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <Button size="sm" variant="secondary" aria-label="Previous day"
              onClick={() => loadDaySheet(shiftDay(daySheetDate, -1))}
              disabled={daySheetLoading || !daySheetDate}>‹</Button>
            <Input
              type="date"
              value={daySheetDate}
              max={daySheet ? daySheet.today : undefined}
              onChange={(e) => e.target.value && loadDaySheet(e.target.value)}
              aria-label="Day to report on"
              style={{ width: 158, padding: '5px 8px', fontSize: '0.8rem' }}
            />
            <Button size="sm" variant="secondary" aria-label="Next day"
              onClick={() => loadDaySheet(shiftDay(daySheetDate, 1))}
              disabled={daySheetLoading || !daySheetDate || (daySheet && daySheetDate >= daySheet.today)}>›</Button>
            <Button size="sm" variant="secondary"
              onClick={() => loadDaySheet('')}
              disabled={daySheetLoading || (daySheet && daySheetDate === daySheet.today)}>Today</Button>
          </div>
        </Card.Header>
        <Card.Body>
          {daySheetError && (
            <div style={{ fontSize: '0.82rem', color: 'var(--danger)' }}>{daySheetError}</div>
          )}
          {!daySheetError && !daySheet && (
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Loading…</div>
          )}
          {!daySheetError && daySheet && (
            <>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                <strong style={{ color: 'var(--text-primary)' }}>{dayLabel(daySheetDate, daySheet.today)}</strong>
                {' — '}
                <strong style={{ color: 'var(--text-primary)' }}>{daySheet.sheet.delivered}</strong> delivered,
                {' '}<strong style={{ color: 'var(--text-primary)' }}>{daySheet.sheet.logged}</strong> logged by hand,
                {' '}<strong style={{ color: 'var(--text-primary)' }}>{daySheet.sheet.arrived}</strong> in through the portal,
                {' '}{daySheet.sheet.moved} stage move{daySheet.sheet.moved === 1 ? '' : 's'}.
              </div>

              {daySheet.sheet.people.length === 0 ? (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Nothing recorded against anybody on this day.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <th style={{ padding: '6px 10px 6px 0' }}>Who</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>Delivered</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>Logged</th>
                        <th style={{ padding: '6px 10px', textAlign: 'right' }}>Moved on</th>
                        <th style={{ padding: '6px 0 6px 10px', textAlign: 'right' }}>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daySheet.sheet.people.map((p) => (
                        <tr key={p.actor} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '8px 10px 8px 0', fontWeight: 600, color: 'var(--text-primary)' }}
                            title={p.actor}>{personName(p.actor)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: p.delivered ? 'var(--success)' : 'var(--text-muted)' }}>{p.delivered}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.logged}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.moved}</td>
                          <td style={{ padding: '8px 0 8px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{p.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button type="button"
                onClick={() => setShowHistory(v => !v)}
                style={{ marginTop: 12, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: 'var(--accent)', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'var(--font-body)' }}>
                {showHistory ? 'Hide the last 14 days' : 'Show the last 14 days'}
              </button>

              {showHistory && (
                <div style={{ overflowX: 'auto', marginTop: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <th style={{ padding: '5px 10px 5px 0' }}>Day</th>
                        <th style={{ padding: '5px 10px', textAlign: 'right' }}>Delivered</th>
                        <th style={{ padding: '5px 10px', textAlign: 'right' }}>Logged</th>
                        <th style={{ padding: '5px 0 5px 10px', textAlign: 'right' }}>Came in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...daySheet.history].reverse().map((d) => (
                        <tr key={d.date}
                          style={{ borderTop: '1px solid var(--border)', cursor: 'pointer',
                            background: d.date === daySheetDate ? 'var(--accent-glow)' : 'transparent' }}
                          onClick={() => loadDaySheet(d.date)}>
                          <td style={{ padding: '6px 10px 6px 0' }}>{dayLabel(d.date, daySheet.today)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: d.delivered ? 'var(--success)' : 'var(--text-muted)' }}>{d.delivered}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{d.logged}</td>
                          <td style={{ padding: '6px 0 6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{d.arrived}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Card.Body>
      </Card>

      {/* Toolbar — segmented filter + search */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 9, background: 'var(--bg-card)', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setView(tab.key)}
              style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                fontFamily: 'var(--font-body)',
                background: view === tab.key ? 'var(--accent)' : 'transparent',
                color: view === tab.key ? 'var(--accent-text)' : 'var(--text-muted)',
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
          placeholder="Search name, email, site, message, owner…"
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
        {/* Queue */}
        <Card style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          {loading && <SkeletonRows rows={5} />}
          {!loading && filtered.length === 0 && (
            <EmptyState title="Nothing here" body="No jobs match this filter." />
          )}
          {filtered.map((s) => {
            const active = s.id === selectedId;
            const stage = stageByKey[s.stage] || stageByKey.new || FALLBACK_STAGES[0];
            // Card title is the site address. Older submissions predate the
            // address field, so fall back to the client name (then project
            // type) to keep the card from going blank.
            const hasAddress = !!(s.site_address && s.site_address.trim());
            const title = (hasAddress && s.site_address.trim())
              || s.user_name || s.user_email || s.project_type || 'Untitled job';
            const subtitleParts = [];
            if (hasAddress && (s.user_name || s.user_email)) subtitleParts.push(s.user_name || s.user_email);
            subtitleParts.push(s.project_type || 'Untyped');
            if (s.source && s.source !== 'portal') subtitleParts.push('via ' + s.source);
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}
                  </span>
                  {s.overdue && <Badge tone="danger" size="sm">Late</Badge>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                  <Badge tone={stage.tone || 'neutral'} size="sm">{stage.label}</Badge>
                  <span style={{ fontSize: 10.5, color: s.overdue ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                    waiting {waitingLabel(s.waiting_days)}
                  </span>
                  {s.owner && (
                    <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                      · {s.owner === myEmail ? 'you' : s.owner.split('@')[0]}
                    </span>
                  )}
                  {!s.owner && (s.stage || 'new') !== 'delivered' && (
                    <span style={{ fontSize: 10.5, color: 'var(--warning)', fontWeight: 600 }}>· unassigned</span>
                  )}
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
            <EmptyState title="Nothing selected" body="Pick a job on the left to see where it is up to." />
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
                  {selected.owner !== myEmail && (selected.stage || 'new') !== 'delivered' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => patchSubmission(selected.id, { owner: myEmail }, 'This one is yours now')}
                      disabled={savingId === selected.id}
                    >
                      Take this job
                    </Button>
                  )}
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

              {/* Stage — one click per step, so recording progress costs nothing
                  and the queue is truthful between "started" and "finished". */}
              <div style={{ marginBottom: 18 }}>
                <div style={sectionLabel}>Where it is up to</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {stages.map((st) => {
                    const isCurrent = (selected.stage || 'new') === st.key;
                    return (
                      <button
                        key={st.key}
                        onClick={() => moveToStage(selected, st.key)}
                        disabled={savingId === selected.id || isCurrent}
                        title={st.hint}
                        style={{
                          padding: '7px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                          fontFamily: 'var(--font-body)',
                          background: isCurrent ? 'var(--accent)' : 'var(--bg-primary)',
                          color: isCurrent ? 'var(--accent-text)' : 'var(--text-secondary)',
                          border: '1px solid ' + (isCurrent ? 'var(--accent)' : 'var(--border)'),
                          cursor: isCurrent ? 'default' : 'pointer',
                          opacity: savingId === selected.id && !isCurrent ? 0.5 : 1,
                        }}
                      >
                        {st.label}
                      </button>
                    );
                  })}
                </div>
                {selectedStage && selectedStage.hint && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5, fontStyle: 'italic' }}>
                    {selectedStage.hint}
                  </div>
                )}
              </div>

              {/* Who has it and when it is due */}
              <div style={{ marginBottom: 18, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Field label="Who has it" style={{ flex: 1, minWidth: 190 }}>
                  <Select
                    value={selected.owner || ''}
                    onChange={(e) => patchSubmission(selected.id, { owner: e.target.value }, 'Owner updated')}
                    disabled={savingId === selected.id}
                  >
                    <option value="">Nobody yet</option>
                    {owners.map((o) => (
                      <option key={o.email} value={o.email}>
                        {o.name}{o.email === myEmail ? ' (you)' : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Enquiry arrived" style={{ flex: 1, minWidth: 150 }}>
                  <Input
                    type="date"
                    value={toDateInput(selected.received_at || selected.created_at)}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      patchSubmission(selected.id, { received_at: e.target.value }, 'Arrival date corrected');
                    }}
                    disabled={savingId === selected.id}
                  />
                </Field>
                <Field label="Target date" style={{ flex: 1, minWidth: 150 }}>
                  <Input
                    type="date"
                    value={toDateInput(selected.due_at)}
                    onChange={(e) => patchSubmission(selected.id, { due_at: e.target.value }, 'Target date updated')}
                    disabled={savingId === selected.id}
                  />
                </Field>
              </div>

              {/* Meta strip */}
              <div style={{
                display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
                padding: '10px 14px', borderRadius: 8, marginBottom: 18,
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                fontSize: 11.5,
              }}>
                <span>
                  <span style={{ color: 'var(--text-muted)' }}>Waiting</span>{' '}
                  <strong style={{ color: selected.overdue ? 'var(--danger)' : 'inherit' }}>
                    {waitingLabel(selected.waiting_days)}
                  </strong>
                </span>
                {selected.overdue && <Badge tone="danger" size="sm">Past target date</Badge>}
                <span><span style={{ color: 'var(--text-muted)' }}>Came in by</span>{' '}<strong>{selected.source || 'portal'}</strong></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Site</span>{' '}<strong>{selected.site_address || '—'}</strong></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Type</span>{' '}<strong>{selected.project_type || '—'}</strong></span>
                <span><span style={{ color: 'var(--text-muted)' }}>Files</span>{' '}<strong>{selected.file_count}</strong></span>
                <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.6 }}>{selected.submission_id}</span>
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

              {/* Admin private notes — the current state of play, overwritten as
                  it changes. History lives below. */}
              <div style={{ marginBottom: 18 }}>
                <div style={sectionLabel}>Working notes (admin only)</div>
                <Textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  onBlur={saveNotes}
                  rows={4}
                  placeholder="Where this job stands right now — not visible to the customer."
                  style={{ minHeight: 90 }}
                />
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                  Saved when you click outside the box.
                  {savingId === selected.id ? ' · Saving…' : ''}
                </div>
              </div>

              {/* History — dated, attributed, never overwritten. This is what
                  makes a hand-over possible without a phone call. */}
              <div>
                <div style={sectionLabel}>History</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <Input
                    type="text"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } }}
                    placeholder="Add a dated note — chased the customer, waiting on a section, etc."
                    style={{ flex: 1 }}
                    maxLength={2000}
                  />
                  <Button variant="secondary" onClick={addNote} disabled={addingNote || !noteDraft.trim()}>
                    {addingNote ? 'Adding…' : 'Add'}
                  </Button>
                </div>

                {events.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Nothing recorded yet. Stage moves and hand-overs land here automatically.
                  </div>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {events.map((ev) => (
                      <li key={ev.id} style={{
                        display: 'flex', gap: 10, padding: '9px 0',
                        borderBottom: '1px solid var(--border)', fontSize: 12.5,
                        alignItems: 'baseline',
                      }}>
                        <span style={{
                          flexShrink: 0, width: 92, fontSize: 10.5,
                          color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                        }}>
                          {fmtDateTime(ev.created_at)}
                        </span>
                        <span style={{ flex: 1, color: 'var(--text-primary)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                          {ev.detail || ev.event_type}
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 10.5, color: 'var(--text-muted)' }}>
                          {ev.actor ? (ev.actor === myEmail ? 'you' : ev.actor.split('@')[0]) : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic', lineHeight: 1.5 }}>
                  Enquiry arrived {fmtDate(selected.received_at || selected.created_at)}.
                  {selected.due_at ? ' Target date ' + fmtDate(selected.due_at) + '.' : ''}
                </div>
              </div>
            </Card.Body>
          )}
        </Card>
      </div>
    </div>
  );
}
