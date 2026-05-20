import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { apiFetch } from '../../utils/api';
import EstimatorGate from '../../components/EstimatorGate';

// Office Jobs — the master list. Click any row to open the Job Workspace.
// "+ New Job" creates a job and drops the user straight into the Estimate
// tab (quoting IS creating a job — no separate "make a quote" flow).

const STATUSES = ['enquiry', 'quoting', 'won', 'in_progress', 'complete', 'lost'];

function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
function fmt(n) { return '£' + Math.round(num(n)).toLocaleString('en-GB'); }

export default function OfficeJobsPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', client_name: '', location: '' });

  const refresh = useCallback(async () => {
    setError('');
    try {
      const r = await apiFetch('/finance/jobs');
      setJobs(r.jobs || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const createJob = async () => {
    if (!draft.name.trim()) return;
    try {
      const r = await apiFetch('/finance/jobs', { method: 'POST', body: JSON.stringify(draft) });
      nav('/office/jobs/' + r.id + '/estimate');
    } catch (e) { setError(e.message); }
  };

  const filtered = filter ? jobs.filter(j => (j.status || 'enquiry') === filter) : jobs;

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;

  return (
    <div style={{ padding: 24, color: t.text, maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Office in a Box</div>
          <h1 style={{ margin: '4px 0 0 0', fontSize: 28, fontWeight: 700, letterSpacing: -0.4 }}>Jobs</h1>
          <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}>
            Every project, enquiry to final payment. Click any to open.
          </div>
        </div>
        <button onClick={() => setCreating(v => !v)} style={{
          background: t.accent, color: '#fff', border: 'none', borderRadius: 10,
          padding: '12px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(245,158,11,0.25)',
        }}>{creating ? 'Cancel' : '+ New Job'}</button>
      </div>

      {error && <div style={{ background: t.dangerBg, color: t.danger, padding: 10, borderRadius: 8, marginBottom: 12 }}>{error}</div>}

      {creating && (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Field t={t} label="Job name *" value={draft.name} onChange={v => setDraft({ ...draft, name: v })} placeholder="e.g. Smith kitchen extension" autoFocus />
            <Field t={t} label="Client" value={draft.client_name} onChange={v => setDraft({ ...draft, client_name: v })} placeholder="Mr & Mrs Smith" />
            <Field t={t} label="Location" value={draft.location} onChange={v => setDraft({ ...draft, location: v })} placeholder="Bristol" />
          </div>
          <div style={{ marginTop: 12 }}>
            <button onClick={createJob} disabled={!draft.name.trim()} style={{
              background: draft.name.trim() ? t.accent : t.surface, color: '#fff', border: 'none',
              borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 600,
              cursor: draft.name.trim() ? 'pointer' : 'not-allowed',
            }}>Create job & start estimate →</button>
          </div>
        </div>
      )}

      {/* Status filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        <Chip t={t} active={!filter} onClick={() => setFilter('')}>All ({jobs.length})</Chip>
        {STATUSES.map(s => {
          const count = jobs.filter(j => (j.status || 'enquiry') === s).length;
          if (count === 0 && filter !== s) return null;
          return <Chip key={s} t={t} active={filter === s} onClick={() => setFilter(s)}>{s.replace('_', ' ')} ({count})</Chip>;
        })}
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: t.card, border: '1px dashed ' + t.border, borderRadius: 12, padding: 40, textAlign: 'center', color: t.textSecondary }}>
          {jobs.length === 0
            ? <>No jobs yet. Click <strong>+ New Job</strong> to start your first one.</>
            : 'No jobs match this filter.'}
        </div>
      ) : (
        <div style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, overflow: 'hidden' }}>
          {filtered.map((j, i) => (
            <button key={j.id} onClick={() => nav('/office/jobs/' + j.id + '/overview')} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 16px', width: '100%', textAlign: 'left',
              background: 'transparent', border: 'none',
              borderTop: i === 0 ? 'none' : '1px solid ' + t.border,
              cursor: 'pointer', color: t.text,
            }}
              onMouseEnter={e => e.currentTarget.style.background = t.surface}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.name}</div>
                <div style={{ color: t.textSecondary, fontSize: 12, marginTop: 2 }}>
                  {j.client_name || 'No client'}{j.location ? ' · ' + j.location : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
                <StatusPill t={t} status={j.status} />
                <div style={{ color: t.textMuted, fontSize: 18 }}>›</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ t, status }) {
  const s = status || 'enquiry';
  const tone = s === 'won' || s === 'complete' ? { bg: t.successBg, fg: t.success }
    : s === 'lost' ? { bg: t.dangerBg, fg: t.danger }
    : s === 'in_progress' || s === 'quoting' ? { bg: t.warningBg, fg: t.warning }
    : { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary };
  return (
    <span style={{ background: tone.bg, color: tone.fg, padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {s.replace('_', ' ')}
    </span>
  );
}

function Chip({ t, active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? t.accent : 'transparent',
      color: active ? '#fff' : t.text,
      border: '1px solid ' + (active ? t.accent : t.border),
      borderRadius: 999, padding: '4px 12px', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize',
    }}>{children}</button>
  );
}

function Field({ t, label, value, onChange, placeholder, autoFocus }) {
  return (
    <div>
      <label style={{ display: 'block', color: t.textSecondary, fontSize: 12, marginBottom: 4 }}>{label}</label>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: t.bg, border: '1px solid ' + t.border, color: t.text,
          borderRadius: 6, padding: '8px 10px', fontSize: 14, outline: 'none',
        }}
      />
    </div>
  );
}
