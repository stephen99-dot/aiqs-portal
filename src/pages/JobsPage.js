import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import HelpTip from '../components/HelpTip';
import { stageFigure } from '../utils/jobStages';
import {
  Button, Card, Input, Select, PageHeader,
  EmptyState, SkeletonCard, JobStageBadge, IconButton,
} from '../ui';
import { FolderIcon, TrashIcon } from '../components/Icons';

// JOBS — the centre of gravity. One card per job: customer + job name, a
// stage chip, and the one number that matters at that stage. Jobs that need
// attention (overdue money) float to the top. Mobile-first: single column,
// big tap targets, no tables.

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function fmt0(n) { return '£' + Math.round(num(n)).toLocaleString('en-GB'); }

export default function JobsPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newJob, setNewJob] = useState({ name: '', client_name: '', client_phone: '', location: '' });
  // Two ways to start a job: describe it, or pull in a BOQ already delivered
  // to the portal (creates the job + a ready-to-send draft quote in one go).
  const [jobMode, setJobMode] = useState('describe'); // 'describe' | 'boq'
  const [portalProjects, setPortalProjects] = useState(null); // null = not loaded yet
  const [boqJob, setBoqJob] = useState({ project_id: '', client_name: '', client_email: '', client_phone: '' });
  const [deletingId, setDeletingId] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const r = await apiFetch('/finance/jobs');
      setJobs(r.jobs || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    if (!newJob.name.trim()) { setError('Give the job a name — the address or the work works well.'); return; }
    try {
      const r = await apiFetch('/finance/jobs', { method: 'POST', body: JSON.stringify(newJob) });
      nav('/jobs/' + r.id);
    } catch (e) { setError(e.message); }
  };

  // Known clients power the autocomplete on the customer fields; picking an
  // exact match fills in their phone/email automatically.
  const [knownClients, setKnownClients] = useState([]);
  useEffect(() => {
    if (!creating || knownClients.length) return;
    apiFetch('/finance/clients').then(r => setKnownClients(r.clients || [])).catch(() => {});
  }, [creating, knownClients.length]);
  const matchClient = (name) => knownClients.find(c => (c.name || '').toLowerCase() === (name || '').trim().toLowerCase());

  const loadPortalProjects = useCallback(async () => {
    try {
      const r = await apiFetch('/projects');
      const list = (r.projects || r || []).filter(p => p.boq_filename);
      setPortalProjects(list);
      setBoqJob(b => (b.project_id || !list.length ? b : { ...b, project_id: list[0].id }));
    } catch (e) { setPortalProjects([]); }
  }, []);
  useEffect(() => {
    if (creating && jobMode === 'boq' && portalProjects === null) loadPortalProjects();
  }, [creating, jobMode, portalProjects, loadPortalProjects]);

  const createFromBoq = async () => {
    if (!boqJob.project_id) { setError('Pick the BOQ to start from.'); return; }
    setError('');
    try {
      const r = await apiFetch('/finance/jobs/from-project', { method: 'POST', body: JSON.stringify(boqJob) });
      nav('/jobs/' + r.job_id);
    } catch (e) { setError(e.message); }
  };

  const deleteJob = async (j) => {
    const label = [j.client_name, j.name].filter(Boolean).join(' — ') || j.name || 'this job';
    if (!window.confirm(`Delete "${label}" and everything in it — its plan, logged costs and photos? Quotes and invoices are kept (just unlinked). This cannot be undone.`)) return;
    setDeletingId(j.id); setError('');
    try {
      await apiFetch('/finance/jobs/' + j.id, { method: 'DELETE' });
      setJobs(prev => prev.filter(x => x.id !== j.id));
    } catch (e) { setError(e.message); }
    finally { setDeletingId(''); }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = jobs;
    if (q) {
      list = list.filter(j =>
        (j.name || '').toLowerCase().includes(q)
        || (j.client_name || '').toLowerCase().includes(q)
        || (j.location || '').toLowerCase().includes(q));
    }
    // Needs-attention first (overdue money), then most recent.
    return [...list].sort((a, b) => {
      const aAtt = num(a.overdue_count) > 0 ? 1 : 0;
      const bAtt = num(b.overdue_count) > 0 ? 1 : 0;
      if (aAtt !== bAtt) return bAtt - aAtt;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }, [jobs, search]);

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <PageHeader
        kicker="Office in a Box"
        title="Jobs"
        titleExtra={<HelpTip t={t} title="Jobs" text={"One card per job: the customer, where it's up to, and the number that matters right now.\n\nJobs with overdue money jump to the top with a red edge.\n\nOpen a job and everything about it is on one screen — quote, invoices, changes, photos, paperwork, notes."} />}
        data-tour="jobs-title"
        actions={
          <>
            <Button onClick={() => { setCreating(v => !v); setError(''); }}>
              {creating ? 'Cancel' : '+ New job'}
            </Button>
            <Button variant="secondary" onClick={() => nav('/estimator/new')}>+ New quote</Button>
          </>
        }
      />

      {error && (
        <div style={{ background: 'var(--danger-bg)', color: 'var(--danger)', padding: 12, borderRadius: 10, marginBottom: 14, fontSize: '0.88rem' }}>
          {error}
        </div>
      )}

      {/* New job form — describe it, or start from a BOQ already in the portal */}
      {creating && (
        <Card style={{ marginBottom: 14, maxWidth: 640 }}>
          <Card.Body style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <datalist id="known-clients">
              {knownClients.map(c => <option key={c.id} value={c.name} />)}
            </datalist>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['describe', 'Describe the job'], ['boq', 'Start from a BOQ']].map(([m, label]) => (
                <Button
                  key={m}
                  variant={jobMode === m ? 'primary' : 'secondary'}
                  onClick={() => { setJobMode(m); setError(''); }}
                  style={{ flex: 1 }}
                >{label}</Button>
              ))}
            </div>

            {jobMode === 'describe' ? (
              <>
                <Input placeholder="Job name — e.g. 12 Hill St extension" value={newJob.name} onChange={e => setNewJob({ ...newJob, name: e.target.value })} />
                <Input list="known-clients" placeholder="Customer name" value={newJob.client_name} onChange={e => {
                  const v = e.target.value;
                  const m = matchClient(v);
                  setNewJob(j => ({ ...j, client_name: v, client_phone: m && !j.client_phone ? (m.phone || '') : j.client_phone }));
                }} />
                <Input type="tel" placeholder="Customer phone (so you can call from here)" value={newJob.client_phone} onChange={e => setNewJob({ ...newJob, client_phone: e.target.value })} />
                <Input placeholder="Address (optional)" value={newJob.location} onChange={e => setNewJob({ ...newJob, location: e.target.value })} />
                <Button size="lg" full onClick={create} busyLabel="Creating…">Create the job</Button>
              </>
            ) : (
              <>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Pick a BOQ from your portal and we'll set up the job with a draft quote built
                  from its priced line items — ready to send to your customer.
                </div>
                {portalProjects === null ? (
                  <div style={{ fontSize: '0.86rem', color: 'var(--text-muted)', padding: '8px 2px' }}>Loading your BOQs…</div>
                ) : portalProjects.length === 0 ? (
                  <div style={{ fontSize: '0.86rem', color: 'var(--text-muted)', padding: '8px 2px' }}>
                    No delivered BOQs in your portal yet — submit drawings first, or describe the job instead.
                  </div>
                ) : (
                  <>
                    <Select value={boqJob.project_id} onChange={e => setBoqJob({ ...boqJob, project_id: e.target.value })}>
                      {portalProjects.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.title}{p.total_value ? ' — £' + Math.round(p.total_value).toLocaleString('en-GB') : ''}
                        </option>
                      ))}
                    </Select>
                    <Input list="known-clients" placeholder="Customer name" value={boqJob.client_name} onChange={e => {
                      const v = e.target.value;
                      const m = matchClient(v);
                      setBoqJob(j => ({
                        ...j, client_name: v,
                        client_email: m && !j.client_email ? (m.email || '') : j.client_email,
                        client_phone: m && !j.client_phone ? (m.phone || '') : j.client_phone,
                      }));
                    }} />
                    <Input type="email" placeholder="Customer email (to send the quote)" value={boqJob.client_email} onChange={e => setBoqJob({ ...boqJob, client_email: e.target.value })} />
                    <Input type="tel" placeholder="Customer phone (optional)" value={boqJob.client_phone} onChange={e => setBoqJob({ ...boqJob, client_phone: e.target.value })} />
                    <Button size="lg" full onClick={createFromBoq} busyLabel="Setting up the job…">
                      Create job + draft quote
                    </Button>
                  </>
                )}
              </>
            )}
          </Card.Body>
        </Card>
      )}

      {/* Search */}
      {jobs.length > 3 && (
        <Input
          style={{ marginBottom: 14, maxWidth: 640 }}
          placeholder="Search jobs or customers…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      )}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : visible.length === 0 ? (
        <Card flat style={{ borderStyle: 'dashed' }}>
          <EmptyState
            icon={FolderIcon}
            title={search ? 'No jobs match that' : 'No jobs yet'}
            body={search
              ? 'Try a different name.'
              : 'A job keeps everything in one place — the quote, the invoices, the changes, the paperwork.'}
            action={!search && (
              <Button size="lg" onClick={() => setCreating(true)}>Start your first job</Button>
            )}
          />
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12, alignItems: 'start' }}>
          {visible.map(j => {
            const fig = stageFigure(j, fmt0);
            const needsAttention = num(j.overdue_count) > 0;
            return (
              <div key={j.id} role="button" tabIndex={0}
                onClick={() => nav('/jobs/' + j.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nav('/jobs/' + j.id); } }}
                className="ui-card"
                style={{
                  cursor: 'pointer', padding: '14px 16px', borderRadius: 14,
                  borderColor: needsAttention ? 'var(--danger)' : undefined,
                  boxShadow: needsAttention ? '0 4px 14px var(--danger-bg)' : undefined,
                  opacity: deletingId === j.id ? 0.5 : 1,
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.98rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {[j.client_name, j.name].filter(Boolean).join(' — ') || j.name}
                    </div>
                    {j.location && <div style={{ color: 'var(--text-muted)', fontSize: '0.84rem', marginTop: 2 }}>{j.location}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <JobStageBadge job={j} />
                    <IconButton danger
                      onClick={(e) => { e.stopPropagation(); deleteJob(j); }}
                      disabled={deletingId === j.id}
                      aria-label={'Delete ' + (j.name || 'job')}
                      title="Delete job"
                      style={{ width: 36, height: 36, border: '1px solid var(--border)' }}
                    >
                      <TrashIcon size={16} />
                    </IconButton>
                  </div>
                </div>
                {fig.label && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.86rem' }}>{fig.label}</span>
                    <span style={{ fontWeight: 700, fontSize: '1rem', fontVariantNumeric: 'tabular-nums' }}>{fig.value}</span>
                  </div>
                )}
                {needsAttention && (
                  <div style={{ color: 'var(--danger)', fontSize: '0.84rem', fontWeight: 600, marginTop: 6 }}>
                    {num(j.overdue_count) === 1 ? 'An invoice is overdue' : j.overdue_count + ' invoices are overdue'} — open the job to chase it
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Quotes and paperwork not tied to a job stay reachable */}
      <div style={{ textAlign: 'center', marginTop: 18, display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="ghost" size="sm" onClick={() => nav('/estimator')}>All quotes</Button>
        <Button variant="ghost" size="sm" onClick={() => nav('/documents')}>All documents</Button>
      </div>
    </div>
  );
}
