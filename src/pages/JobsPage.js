import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import EstimatorGate from '../components/EstimatorGate';
import { jobStage, stageColours, stageFigure } from '../utils/jobStages';
import { FolderIcon } from '../components/Icons';

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

  const input = {
    width: '100%', boxSizing: 'border-box', minHeight: 44, padding: '10px 14px',
    background: t.bg, border: '1px solid ' + t.border, color: t.text,
    borderRadius: 10, fontSize: 15, outline: 'none',
  };

  return (
    <div style={{ padding: '20px 16px 32px', color: t.text, maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Office in a Box</div>
        <h1 style={{ margin: '4px 0 0 0', fontSize: 26, fontWeight: 700, letterSpacing: -0.4 }}>Jobs</h1>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 12, borderRadius: 10, marginBottom: 14 }}>{error}</div>}

      {/* Big actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        <button onClick={() => { setCreating(v => !v); setError(''); }} style={{
          minHeight: 52, borderRadius: 12, border: 'none', background: t.accent, color: '#fff',
          fontSize: 15, fontWeight: 700, cursor: 'pointer',
        }}>{creating ? 'Cancel' : '+ New job'}</button>
        <button onClick={() => nav('/estimator/new')} style={{
          minHeight: 52, borderRadius: 12, border: '1px solid ' + t.border, background: t.card,
          color: t.text, fontSize: 15, fontWeight: 700, cursor: 'pointer',
        }}>+ New quote</button>
      </div>

      {/* New job form */}
      {creating && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 16, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input style={input} placeholder="Job name — e.g. 12 Hill St extension" value={newJob.name} onChange={e => setNewJob({ ...newJob, name: e.target.value })} />
          <input style={input} placeholder="Customer name" value={newJob.client_name} onChange={e => setNewJob({ ...newJob, client_name: e.target.value })} />
          <input style={input} type="tel" placeholder="Customer phone (so you can call from here)" value={newJob.client_phone} onChange={e => setNewJob({ ...newJob, client_phone: e.target.value })} />
          <input style={input} placeholder="Address (optional)" value={newJob.location} onChange={e => setNewJob({ ...newJob, location: e.target.value })} />
          <button onClick={create} style={{ minHeight: 48, borderRadius: 10, border: 'none', background: t.accent, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            Create the job
          </button>
        </div>
      )}

      {/* Search */}
      {jobs.length > 3 && (
        <input
          style={{ ...input, marginBottom: 14 }}
          placeholder="Search jobs or customers…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      )}

      {loading ? (
        <div style={{ color: t.textSecondary, padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div style={{ background: t.card, border: '1px dashed ' + t.border, borderRadius: 12, padding: 36, textAlign: 'center' }}>
          <div style={{ marginBottom: 8, color: t.textSecondary }}><FolderIcon size={28} /></div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{search ? 'No jobs match that' : 'No jobs yet'}</div>
          <div style={{ color: t.textSecondary, fontSize: 14, marginBottom: 14 }}>
            {search ? 'Try a different name.' : 'A job keeps everything in one place — the quote, the invoices, the changes, the paperwork.'}
          </div>
          {!search && (
            <button onClick={() => setCreating(true)} style={{ minHeight: 48, padding: '0 22px', borderRadius: 10, border: 'none', background: t.accent, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              Start your first job
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map(j => {
            const stage = jobStage(j);
            const sc = stageColours(stage.key, t);
            const fig = stageFigure(j, fmt0);
            const needsAttention = num(j.overdue_count) > 0;
            return (
              <button key={j.id} onClick={() => nav('/jobs/' + j.id)} style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                background: t.card, color: t.text,
                border: '1px solid ' + (needsAttention ? (t.danger + '66') : t.border),
                borderRadius: 14, padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {[j.client_name, j.name].filter(Boolean).join(' — ') || j.name}
                    </div>
                    {j.location && <div style={{ color: t.textMuted, fontSize: 13, marginTop: 2 }}>{j.location}</div>}
                  </div>
                  <span style={{
                    background: sc.bg, color: sc.fg, padding: '4px 10px', borderRadius: 999,
                    fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                  }}>{stage.label}</span>
                </div>
                {fig.label && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
                    <span style={{ color: t.textSecondary, fontSize: 13 }}>{fig.label}</span>
                    <span style={{ fontWeight: 700, fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>{fig.value}</span>
                  </div>
                )}
                {needsAttention && (
                  <div style={{ color: t.danger, fontSize: 13, fontWeight: 600, marginTop: 6 }}>
                    {num(j.overdue_count) === 1 ? 'An invoice is overdue' : j.overdue_count + ' invoices are overdue'} — open the job to chase it
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Quotes and paperwork not tied to a job stay reachable */}
      <div style={{ textAlign: 'center', marginTop: 18, display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
        <button onClick={() => nav('/estimator')} style={{ background: 'transparent', border: 'none', color: t.textSecondary, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', minHeight: 44 }}>
          All quotes
        </button>
        <button onClick={() => nav('/documents')} style={{ background: 'transparent', border: 'none', color: t.textSecondary, fontSize: 13, cursor: 'pointer', textDecoration: 'underline', minHeight: 44 }}>
          All documents
        </button>
      </div>
    </div>
  );
}
