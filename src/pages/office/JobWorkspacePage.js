import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation, Outlet, NavLink } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { apiFetch } from '../../utils/api';
import EstimatorGate from '../../components/EstimatorGate';

// ─── The Job Workspace ──────────────────────────────────────────────────────
//
// Single screen for everything about ONE job. A persistent header (client,
// project, status, totals, margin vs break-even, "< Jobs" link) stays on
// screen; tabs run left-to-right in the natural journey order:
//
//   Overview · Estimate · Variations · Invoices · Documents
//
// Each tab is its own child route under /office/jobs/:id/<tab>, so deep
// links work. Editing a record (a quote, a variation, an invoice, a doc)
// opens as a drawer / modal OVER this page — the header + tabs are always
// visible, the user is never stranded.
//
// Chunk 1 ships the skeleton: header + tab bar render correctly, each tab
// shows a "moves in next chunk" placeholder. Chunk 2 swaps the placeholders
// for the existing feature components.

const TABS = [
  { id: 'overview',   label: 'Overview',   path: 'overview' },
  { id: 'estimate',   label: 'Estimate',   path: 'estimate' },
  { id: 'variations', label: 'Variations', path: 'variations' },
  { id: 'invoices',   label: 'Invoices',   path: 'invoices' },
  { id: 'documents',  label: 'Documents',  path: 'documents' },
];

function num(v, fb = 0) { const n = parseFloat(v); return Number.isFinite(n) ? n : fb; }
function fmtMoney(n) { const v = num(n); return '£' + Math.round(v).toLocaleString('en-GB'); }

export default function JobWorkspacePage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();

  const [job, setJob] = useState(null);
  const [budget, setBudget] = useState(null);
  const [latestQuote, setLatestQuote] = useState(null);
  const [variationsApproved, setVariationsApproved] = useState(0);
  const [breakEven, setBreakEven] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await apiFetch('/finance/jobs/' + id);
      setJob(r.job || null);
      setBudget(r.budget || null);
      setLatestQuote(r.latest_quote || null);
      try {
        const vr = await apiFetch('/change-orders/job/' + id);
        setVariationsApproved(vr.approved_total || 0);
      } catch (e) {}
      try {
        const fr = await apiFetch('/finance/dashboard');
        if (fr.overheads && fr.overheads.break_even_day) setBreakEven(num(fr.overheads.break_even_day));
      } catch (e) {}
    } catch (e) {
      setError(e.message || 'Failed to load job.');
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Auto-redirect /office/jobs/:id (no tab) -> /office/jobs/:id/overview.
  useEffect(() => {
    const lastSegment = location.pathname.replace(/\/$/, '').split('/').pop();
    if (lastSegment === id) {
      nav('/office/jobs/' + id + '/overview', { replace: true });
    }
  }, [location.pathname, id, nav]);

  // Headline figures for the header strip.
  const contractValue = useMemo(() => {
    const quote = num(latestQuote?.grand_total);
    const vars = num(variationsApproved);
    return quote + vars;
  }, [latestQuote, variationsApproved]);

  const plannedCost = useMemo(() => {
    if (!budget) return 0;
    return num(budget.planned_labour) + num(budget.planned_materials)
      + num(budget.planned_overheads) + num(budget.planned_other);
  }, [budget]);

  const marginAbsolute = useMemo(() => {
    if (!budget || plannedCost <= 0) return null;
    const revenue = num(budget.planned_revenue) || contractValue;
    if (revenue <= 0) return null;
    return revenue - plannedCost;
  }, [budget, plannedCost, contractValue]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;
  }
  if (!job) {
    return (
      <div style={{ padding: 24, color: t.text }}>
        <button onClick={() => nav('/office/jobs')} style={btnLink(t)}>← Jobs</button>
        <div style={{ marginTop: 16, color: t.danger }}>{error || 'Job not found.'}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 50px)' }}>
      {/* Persistent header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: t.bg,
        borderBottom: '1px solid ' + t.border,
      }}>
        <div style={{ padding: '14px 24px 0', maxWidth: 1200, margin: '0 auto' }}>
          {/* Breadcrumb + back */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: t.textMuted, marginBottom: 8 }}>
            <button onClick={() => nav('/office/jobs')} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: t.textSecondary, fontSize: 12, padding: 0,
            }}>‹ Jobs</button>
            <span>·</span>
            <span style={{ color: t.text, fontWeight: 500 }}>{job.name}</span>
          </div>

          {/* Title row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: t.text, letterSpacing: -0.3 }}>{job.name}</h1>
              <div style={{ color: t.textSecondary, fontSize: 13, marginTop: 2 }}>
                {job.client_name || 'No client'}{job.location ? ' · ' + job.location : ''}
                <JobStatusPill t={t} status={job.status} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <Metric t={t} label="Contract value" value={contractValue > 0 ? fmtMoney(contractValue) : '—'} />
              <Metric t={t} label="Planned cost" value={plannedCost > 0 ? fmtMoney(plannedCost) : '—'} />
              <Metric
                t={t}
                label="Margin"
                value={marginAbsolute != null ? fmtMoney(marginAbsolute) : '—'}
                tone={marginAbsolute != null
                  ? (marginAbsolute < 0 ? 'danger' : (breakEven && plannedCost > 0 && contractValue > 0 && (contractValue / Math.max(1, plannedCost / Math.max(breakEven, 1))) < breakEven ? 'warning' : 'success'))
                  : undefined}
              />
            </div>
          </div>

          {/* Tab bar */}
          <nav style={{
            marginTop: 14,
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid ' + t.border,
            overflowX: 'auto',
            scrollbarWidth: 'none',
          }} className="job-workspace-tabs">
            {TABS.map(tab => (
              <NavLink
                key={tab.id}
                to={'/office/jobs/' + id + '/' + tab.path}
                style={{ textDecoration: 'none' }}
              >
                {({ isActive }) => (
                  <div style={{
                    padding: '10px 16px',
                    fontSize: 13,
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? t.text : t.textSecondary,
                    borderBottom: '2px solid ' + (isActive ? t.accent : 'transparent'),
                    marginBottom: -1,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'color 0.15s',
                  }}>{tab.label}</div>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* Tab content */}
      <main style={{ flex: 1, padding: '20px 24px', maxWidth: 1200, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <Outlet context={{ job, budget, latestQuote, variationsApproved, breakEven, contractValue, plannedCost, marginAbsolute, reload: load }} />
      </main>
    </div>
  );
}

function JobStatusPill({ t, status }) {
  if (!status) return null;
  const tone = status === 'won' ? { bg: t.successBg, fg: t.success }
    : status === 'lost' ? { bg: t.dangerBg, fg: t.danger }
    : status === 'in_progress' ? { bg: t.warningBg, fg: t.warning }
    : status === 'complete' ? { bg: t.successBg, fg: t.success }
    : { bg: 'rgba(148,163,184,0.15)', fg: t.textSecondary };
  return (
    <span style={{ marginLeft: 8, background: tone.bg, color: tone.fg, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
      {status.replace('_', ' ')}
    </span>
  );
}

function Metric({ t, label, value, tone }) {
  const colour = tone === 'danger' ? (t.danger || '#EF4444')
    : tone === 'warning' ? (t.warning || '#F59E0B')
    : tone === 'success' ? (t.success || '#10B981')
    : t.text;
  return (
    <div>
      <div style={{ color: t.textMuted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
      <div style={{ color: colour, fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function btnLink(t) {
  return { background: 'transparent', border: 'none', color: t.textSecondary, fontSize: 13, cursor: 'pointer', padding: 0 };
}
