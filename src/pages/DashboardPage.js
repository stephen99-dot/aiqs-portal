import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import OnboardingTour from '../components/OnboardingTour';
import {
  FolderIcon, ClockIcon, PipelineIcon, CheckCircleIcon,
  ZapIcon, StarIcon, CrownIcon, BanIcon, ArrowRightIcon,
  NewProjectIcon, UploadIcon, DownloadIcon, DotIcon,
} from '../components/Icons';

const STATUS_MAP = {
  awaiting_payment: { label: 'Awaiting Payment', color: '#EF4444', bg: 'rgba(239,68,68,0.1)' },
  submitted: { label: 'Submitted', color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
  in_review: { label: 'In Review', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  in_progress: { label: 'In Progress', color: '#A855F7', bg: 'rgba(168,85,247,0.1)' },
  completed: { label: 'Completed', color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  delivered: { label: 'Delivered', color: '#10B981', bg: 'rgba(16,185,129,0.15)' },
};

function UsageBar({ usage, t }) {
  if (!usage) return null;
  const { plan, planLabel, quota, used, remaining, isPayg, atLimit } = usage;

  if (isPayg) {
    return (
      <div data-tour="usage-bar" style={{
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 12, padding: '16px 20px',
        marginBottom: 20, boxShadow: t.shadowSm,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 6,
            background: t.warningBg, color: t.warning,
            fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            <ZapIcon size={12} color={t.warning} /> Pay As You Go
          </span>
          <span style={{ fontSize: 12.5, color: t.textSecondary }}>
            {used} project{used !== 1 ? 's' : ''} this month
          </span>
        </div>
        <a href="https://theaiqs.co.uk/#pricing" target="_blank" rel="noopener noreferrer" style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 12, fontWeight: 600, color: t.accent, textDecoration: 'none',
        }}>
          Upgrade & Save <ArrowRightIcon size={12} color={t.accent} />
        </a>
      </div>
    );
  }

  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const barColor = atLimit ? '#EF4444' : pct >= 80 ? '#F59E0B' : '#10B981';
  const PlanIcon = plan === 'premium' ? CrownIcon : StarIcon;
  const planIconColor = plan === 'premium' ? '#A78BFA' : t.accentLight;
  const planBg = plan === 'premium' ? 'rgba(124,58,237,0.1)' : t.accentGlow;

  return (
    <div data-tour="usage-bar" style={{
      background: t.card, border: `1px solid ${atLimit ? 'rgba(239,68,68,0.25)' : t.border}`,
      borderRadius: 12, padding: '16px 20px', marginBottom: 20, boxShadow: t.shadowSm,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 6,
            background: planBg, color: planIconColor,
            fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            <PlanIcon size={12} color={planIconColor} /> {planLabel}
          </span>
          <span style={{ fontSize: 12.5, color: t.textSecondary }}>
            <strong style={{ color: t.text }}>{used}</strong> of <strong style={{ color: t.text }}>{quota}</strong> projects used this month
          </span>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11.5, fontWeight: 600,
          color: atLimit ? '#EF4444' : remaining <= 2 ? '#F59E0B' : t.textMuted,
        }}>
          {atLimit ? <><BanIcon size={12} color="#EF4444" /> Limit reached</> : `${remaining} remaining`}
        </span>
      </div>
      <div style={{ width: '100%', height: 5, borderRadius: 5, background: t.surfaceHover, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 5, background: barColor, transition: 'width 0.5s ease' }} />
      </div>
      {atLimit && (
        <div style={{
          marginTop: 12, padding: '12px 16px',
          background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.1)',
          borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 2 }}>
              You've used all {quota} projects this month
            </div>
            <div style={{ fontSize: 11.5, color: t.textMuted }}>Upgrade your plan or buy extra projects to continue</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {plan === 'professional' && (
              <a href="https://buy.stripe.com/6oUaEX6Ji2FaaMU76473G05" target="_blank" rel="noopener noreferrer" style={{
                padding: '7px 14px', borderRadius: 7,
                background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
                color: '#fff', fontSize: 12, fontWeight: 600,
                textDecoration: 'none', whiteSpace: 'nowrap',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}>
                <CrownIcon size={12} color="#fff" /> Upgrade to Premium
              </a>
            )}
            <a
              href={(plan === 'professional' || plan === 'premium') ? "https://buy.stripe.com/28E8wPd7Ggw0f3abmk73G06" : "https://buy.stripe.com/7sY00j1oY4Ni5sAcqo73G01"}
              target="_blank" rel="noopener noreferrer"
              style={{
                padding: '7px 14px', borderRadius: 7,
                background: t.surfaceHover, border: `1px solid ${t.border}`,
                color: t.text, fontSize: 12, fontWeight: 600,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              {'Buy Extra Project — ' + ((plan === 'professional' || plan === 'premium') ? '£79' : '£99')}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function GettingStarted({ projects, t }) {
  const steps = [
    { key: 'account', label: 'Create your account', done: true, icon: CheckCircleIcon },
    { key: 'first', label: 'Submit your first project', done: projects.length > 0, icon: UploadIcon },
    { key: 'boq', label: 'Receive your BOQ', done: projects.some(p => p.status === 'completed' || p.status === 'delivered'), icon: DownloadIcon },
  ];
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { try { if (localStorage.getItem('aiqs_checklist_dismissed') === 'true') setDismissed(true); } catch {} }, []);
  if (dismissed || steps.every(s => s.done)) return null;
  const completedCount = steps.filter(s => s.done).length;
  const pct = (completedCount / steps.length) * 100;

  return (
    <div style={{
      background: t.card, border: `1px solid ${t.border}`,
      borderRadius: 12, padding: '18px 20px', marginBottom: 20, boxShadow: t.shadowSm,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: t.text, marginBottom: 1 }}>Getting Started</div>
          <div style={{ fontSize: 11.5, color: t.textMuted }}>{completedCount} of {steps.length} complete</div>
        </div>
        <button onClick={() => { setDismissed(true); try { localStorage.setItem('aiqs_checklist_dismissed', 'true'); } catch {} }} style={{
          background: 'none', border: 'none', color: t.textMuted, fontSize: 11, cursor: 'pointer',
          textDecoration: 'underline', textUnderlineOffset: 3,
        }}>Dismiss</button>
      </div>
      <div style={{ width: '100%', height: 3, borderRadius: 3, background: t.surfaceHover, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: 'linear-gradient(135deg, #F59E0B, #D97706)', transition: 'width 0.5s ease' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map(s => (
          <div key={s.key} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 10px', borderRadius: 8,
            background: s.done ? 'rgba(16,185,129,0.03)' : t.surfaceHover,
            border: `1px solid ${s.done ? 'rgba(16,185,129,0.08)' : 'transparent'}`,
            opacity: s.done ? 0.65 : 1,
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: 7,
              background: s.done ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {s.done ? <CheckCircleIcon size={13} color="#10B981" /> : <s.icon size={13} color="#F59E0B" />}
            </div>
            <span style={{
              fontSize: 12.5, fontWeight: 500,
              color: s.done ? t.textMuted : t.text,
              textDecoration: s.done ? 'line-through' : 'none',
            }}>{s.label}</span>
          </div>
        ))}
      </div>
      {projects.length === 0 && (
        <Link to="/new-project" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          marginTop: 12, padding: '9px 18px', borderRadius: 8,
          background: 'linear-gradient(135deg, #F59E0B, #D97706)',
          color: '#0A0F1C', fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
          boxShadow: '0 2px 10px rgba(245,158,11,0.18)', transition: 'all 0.2s',
        }}>
          Submit Your First Project <ArrowRightIcon size={13} color="#0A0F1C" />
        </Link>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, iconColor, iconBg, value, label, t, accent }) {
  return (
    <div className={`stat-card ${accent ? 'accent' : ''}`}>
      <div style={{
        width: 34, height: 34, borderRadius: 9, background: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6,
      }}>
        <Icon size={16} color={iconColor} />
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useTheme();
  const [projects, setProjects] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    Promise.all([apiFetch('/projects'), apiFetch('/usage').catch(() => null)])
      .then(([proj, usg]) => { setProjects(proj); setUsage(usg); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!loading) {
      const key = `aiqs_tour_complete_${user?.id || 'default'}`;
      try { if (!localStorage.getItem(key)) setShowTour(true); } catch {}
    }
  }, [loading]);

  const firstName = user?.fullName?.split(' ')[0] || 'there';

  return (
    <div className="page" data-tour="welcome">
      {showTour && <OnboardingTour userId={user?.id} onComplete={() => setShowTour(false)} />}
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome back, {firstName}</h1>
          <p className="page-subtitle">Here's an overview of your projects</p>
        </div>
        <Link to="/new-project" className="btn-primary" data-tour="new-project">
          <NewProjectIcon size={15} color="#0A0F1C" />
          New Project
        </Link>
      </div>
      <UsageBar usage={usage} t={t} />
      <GettingStarted projects={projects} t={t} />
      <div className="stats-row" data-tour="stats">
        <StatCard icon={FolderIcon} iconColor={t.accentLight} iconBg={t.accentGlow} value={projects.length} label="Total Projects" t={t} />
        <StatCard icon={ClockIcon} iconColor="#F59E0B" iconBg="rgba(245,158,11,0.06)" value={projects.filter(p => p.status === 'submitted' || p.status === 'in_review').length} label="In Queue" t={t} />
        <StatCard icon={PipelineIcon} iconColor="#A855F7" iconBg="rgba(168,85,247,0.06)" value={projects.filter(p => p.status === 'in_progress').length} label="In Progress" t={t} />
        <StatCard icon={CheckCircleIcon} iconColor="#10B981" iconBg="rgba(16,185,129,0.06)" value={projects.filter(p => p.status === 'completed' || p.status === 'delivered').length} label="Completed" t={t} accent />
      </div>
      <div className="section-card" data-tour="projects-list">
        <div className="section-card-header"><h2>Your Projects</h2></div>
        {loading ? (
          <div className="empty-state"><div className="loading-spinner" /><p>Loading your projects...</p></div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <div style={{
              width: 52, height: 52, borderRadius: 14, margin: '0 auto 14px',
              background: 'rgba(245,158,11,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><FolderIcon size={24} color="#F59E0B" /></div>
            <h3>No projects yet</h3>
            <p>Upload your first set of drawings and we'll get your BOQ started.</p>
            <Link to="/new-project" className="btn-primary" style={{ marginTop: 16 }}>Submit Your First Project</Link>
          </div>
        ) : (
          <div className="projects-list">
            {projects.map(project => {
              const status = STATUS_MAP[project.status] || STATUS_MAP.submitted;
              const isPaid = project.status !== 'awaiting_payment';
              return (
                <Link to={`/project/${project.id}`} key={project.id} className="project-row">
                  <div className="project-info">
                    <div className="project-title">{project.title}</div>
                    <div className="project-meta">
                      <span className="project-type">{project.project_type}</span>
                      {project.location && <span className="project-location">&middot; {project.location}</span>}
                      <span className="project-files">&middot; {project.file_count || 0} file{(project.file_count || 0) !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <div className="project-right">
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 10.5, fontWeight: 600, padding: '3px 8px', borderRadius: 5,
                      background: isPaid ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                      color: isPaid ? '#10B981' : '#EF4444',
                    }}>
                      <DotIcon size={5} color={isPaid ? '#10B981' : '#EF4444'} />
                      {isPaid ? 'PAID' : 'UNPAID'}
                    </span>
                    <span className="status-badge" style={{ color: status.color, background: status.bg }}>{status.label}</span>
                    <span className="project-date">
                      {new Date(project.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
