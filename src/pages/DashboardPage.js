import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';

const STATUS_MAP = {
  submitted: { label: 'Submitted', color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
  in_review: { label: 'In Review', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  in_progress: { label: 'In Progress', color: '#A855F7', bg: 'rgba(168,85,247,0.1)' },
  completed: { label: 'Completed', color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  delivered: { label: 'Delivered', color: '#10B981', bg: 'rgba(16,185,129,0.15)' },
};

function UsageBar({ usage, t }) {
  if (!usage) return null;

  const { plan, planLabel, quota, used, remaining, isPayg, atLimit } = usage;

  // PAYG users don't have a bar, just a label
  if (isPayg) {
    return (
      <div style={{
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 14, padding: '18px 22px',
        marginBottom: 20, boxShadow: t.shadowSm,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', borderRadius: 8,
            background: t.warningBg, color: t.warning,
            fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            ⚡ Pay As You Go
          </span>
          <span style={{ fontSize: 13, color: t.textSecondary }}>
            {used} project{used !== 1 ? 's' : ''} this month
          </span>
        </div>
        <Link to="/pricing" style={{
          fontSize: 12, fontWeight: 600, color: t.accent,
          textDecoration: 'none',
        }}>
          Upgrade & Save →
        </Link>
      </div>
    );
  }

  // Subscription users get a progress bar
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const barColor = atLimit ? '#EF4444' : pct >= 80 ? '#F59E0B' : '#10B981';

  return (
    <div style={{
      background: t.card, border: `1px solid ${atLimit ? 'rgba(239,68,68,0.3)' : t.border}`,
      borderRadius: 14, padding: '18px 22px',
      marginBottom: 20, boxShadow: t.shadowSm,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', borderRadius: 8,
            background: plan === 'premium' ? 'rgba(124,58,237,0.1)' : t.accentGlow,
            color: plan === 'premium' ? '#A78BFA' : t.accentLight,
            fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {plan === 'premium' ? '👑' : '⭐'} {planLabel}
          </span>
          <span style={{ fontSize: 13, color: t.textSecondary }}>
            <strong style={{ color: t.text }}>{used}</strong> of <strong style={{ color: t.text }}>{quota}</strong> projects used this month
          </span>
        </div>
        <span style={{
          fontSize: 12, fontWeight: 600,
          color: atLimit ? '#EF4444' : remaining <= 2 ? '#F59E0B' : t.textMuted,
        }}>
          {atLimit ? '🚫 Limit reached' : `${remaining} remaining`}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        width: '100%', height: 8, borderRadius: 6,
        background: t.surfaceHover,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 6,
          background: barColor,
          transition: 'width 0.5s ease, background 0.3s ease',
        }} />
      </div>

      {atLimit && (
        <div style={{
          marginTop: 14, padding: '14px 18px',
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.15)',
          borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 2 }}>
              You've used all {quota} projects this month
            </div>
            <div style={{ fontSize: 12, color: t.textMuted }}>
              Upgrade your plan or buy extra projects to continue
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {plan === 'professional' && (
              <a href="https://buy.stripe.com/6oUaEX6Ji2FaaMU76473G05" target="_blank" rel="noopener noreferrer" style={{
                padding: '8px 16px', borderRadius: 8,
                background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
                color: '#fff', fontSize: 12, fontWeight: 600,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}>
                Upgrade to Premium
              </a>
            )}
            <a href="https://buy.stripe.com/7sY00j1oY4Ni5sAcqo73G01" target="_blank" rel="noopener noreferrer" style={{
              padding: '8px 16px', borderRadius: 8,
              background: t.surfaceHover, border: `1px solid ${t.border}`,
              color: t.text, fontSize: 12, fontWeight: 600,
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}>
              Buy Extra Project — £79
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useTheme();
  const [projects, setProjects] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch('/projects'),
      apiFetch('/usage'),
    ])
      .then(([proj, usg]) => {
        setProjects(proj);
        setUsage(usg);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const firstName = user?.fullName?.split(' ')[0] || 'there';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome back, {firstName}</h1>
          <p className="page-subtitle">Here's an overview of your projects</p>
        </div>
        <Link to="/new-project" className="btn-primary">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M12 4v16m8-8H4"/></svg>
          New Project
        </Link>
      </div>

      {/* Usage Bar */}
      <UsageBar usage={usage} t={t} />

      {/* Stats row */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{projects.length}</div>
          <div className="stat-label">Total Projects</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{projects.filter(p => p.status === 'submitted' || p.status === 'in_review').length}</div>
          <div className="stat-label">In Queue</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{projects.filter(p => p.status === 'in_progress').length}</div>
          <div className="stat-label">In Progress</div>
        </div>
        <div className="stat-card accent">
          <div className="stat-value">{projects.filter(p => p.status === 'completed' || p.status === 'delivered').length}</div>
          <div className="stat-label">Completed</div>
        </div>
      </div>

      {/* Projects list */}
      <div className="section-card">
        <div className="section-card-header">
          <h2>Your Projects</h2>
        </div>

        {loading ? (
          <div className="empty-state">
            <div className="loading-spinner" />
            <p>Loading your projects...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📐</div>
            <h3>No projects yet</h3>
            <p>Upload your first set of drawings and we'll get your BOQ started.</p>
            <Link to="/new-project" className="btn-primary" style={{ marginTop: 16 }}>
              Submit Your First Project
            </Link>
          </div>
        ) : (
          <div className="projects-list">
            {projects.map(project => {
              const status = STATUS_MAP[project.status] || STATUS_MAP.submitted;
              return (
                <Link to={`/project/${project.id}`} key={project.id} className="project-row">
                  <div className="project-info">
                    <div className="project-title">{project.title}</div>
                    <div className="project-meta">
                      <span className="project-type">{project.project_type}</span>
                      {project.location && <span className="project-location">· {project.location}</span>}
                      <span className="project-files">· {project.file_count || 0} file{(project.file_count || 0) !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <div className="project-right">
                    <span className="status-badge" style={{ color: status.color, background: status.bg }}>
                      {status.label}
                    </span>
                    <span className="project-date">
                      {new Date(project.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric'
                      })}
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
