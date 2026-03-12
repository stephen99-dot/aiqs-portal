import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import OnboardingTour, { TOUR_VERSION } from '../components/OnboardingTour';
import {
  FolderIcon, ClockIcon, PipelineIcon, CheckCircleIcon,
  ZapIcon, StarIcon, CrownIcon, BanIcon, ArrowRightIcon,
  NewProjectIcon, UploadIcon, DownloadIcon, ChatIcon,
} from '../components/Icons';

const STRIPE = {
  starter_payg:    'https://buy.stripe.com/7sY00j1oY4Ni5sAcqo73G01',  // £99 PAYG BOQ
  professional:    'https://buy.stripe.com/dRmfZh9VucfK5sA0HG73G04',  // £347/mo Professional
  premium:         'https://buy.stripe.com/6oUaEX6Ji2FaaMU76473G05',  // £447/mo Premium
  extra_sub:       'https://buy.stripe.com/28E8wPd7Ggw0f3abmk73G06',  // £79 extra BOQ (subscribers)
  upgrade_premium: 'https://buy.stripe.com/6oUaEX6Ji2FaaMU76473G05',  // upgrade to premium
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
            {used} BOQ{used !== 1 ? 's' : ''} this month · £99 per BOQ
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* £99 per BOQ button */}
          <a href={STRIPE.starter_payg} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '6px 12px', borderRadius: 7,
            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
            fontSize: 12, fontWeight: 700, color: '#0A0F1C', textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(245,158,11,0.25)',
          }}>
            <ZapIcon size={11} color="#0A0F1C" /> £99 per BOQ
          </a>
          <a href={STRIPE.professional} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '6px 12px', borderRadius: 7,
            background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
            fontSize: 12, fontWeight: 600, color: t.accent, textDecoration: 'none',
          }}>
            <StarIcon size={11} color={t.accent} /> Pro — £347/mo
          </a>
          <a href={STRIPE.premium} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '6px 12px', borderRadius: 7,
            background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.2)',
            fontSize: 12, fontWeight: 600, color: '#A78BFA', textDecoration: 'none',
          }}>
            <CrownIcon size={11} color="#A78BFA" /> Premium — £447/mo
          </a>
        </div>
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
            <strong style={{ color: t.text }}>{used}</strong> of <strong style={{ color: t.text }}>{quota}</strong> BOQs used this month
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
          marginTop: 12, padding: '14px 16px',
          background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.1)',
          borderRadius: 10,
        }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 2 }}>
              You've used all {quota} BOQs this month
            </div>
            <div style={{ fontSize: 11.5, color: t.textMuted }}>Upgrade your plan or buy an extra BOQ to continue</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {plan === 'professional' && (
              <a href={STRIPE.upgrade_premium} target="_blank" rel="noopener noreferrer" style={{
                padding: '7px 14px', borderRadius: 7,
                background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
                color: '#fff', fontSize: 12, fontWeight: 600,
                textDecoration: 'none', whiteSpace: 'nowrap',
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}>
                <CrownIcon size={12} color="#fff" /> Upgrade to Premium — £447/mo
              </a>
            )}
            <a
              href={plan === 'professional' || plan === 'premium' ? STRIPE.extra_sub : STRIPE.starter_payg}
              target="_blank" rel="noopener noreferrer"
              style={{
                padding: '7px 14px', borderRadius: 7,
                background: t.surfaceHover, border: `1px solid ${t.border}`,
                color: t.text, fontSize: 12, fontWeight: 600,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              Buy Extra BOQ — {plan === 'professional' || plan === 'premium' ? '£79' : '£99'}
            </a>
          </div>
        </div>
      )}

      {!atLimit && remaining <= 2 && remaining > 0 && (
        <div style={{
          marginTop: 10, fontSize: 12, color: '#F59E0B',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
        }}>
          <span>Only {remaining} BOQ{remaining !== 1 ? 's' : ''} left this month</span>
          {plan === 'professional' && (
            <a href={STRIPE.upgrade_premium} target="_blank" rel="noopener noreferrer" style={{
              fontSize: 11.5, fontWeight: 600, color: '#A78BFA', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}>
              Upgrade to Premium <ArrowRightIcon size={11} color="#A78BFA" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function MessageUsageBar({ usage, t }) {
  if (!usage || usage.messagesLimit == null) return null;
  const { messagesUsed = 0, messagesLimit = 0, messagesRemaining = 0, messagesAtLimit, plan, planLabel } = usage;
  if (messagesLimit <= 0) return null;

  const pct = messagesLimit > 0 ? Math.min(100, (messagesUsed / messagesLimit) * 100) : 0;
  const barColor = messagesAtLimit ? '#EF4444' : pct >= 80 ? '#F59E0B' : '#3B82F6';
  const PlanIcon = plan === 'premium' ? CrownIcon : StarIcon;
  const planIconColor = plan === 'premium' ? '#A78BFA' : t.accentLight;
  const planBg = plan === 'premium' ? 'rgba(124,58,237,0.1)' : t.accentGlow;

  return (
    <div style={{
      background: t.card, border: `1px solid ${messagesAtLimit ? 'rgba(239,68,68,0.25)' : t.border}`,
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
            <ChatIcon size={12} color={planIconColor} /> Messages
          </span>
          <span style={{ fontSize: 12.5, color: t.textSecondary }}>
            <strong style={{ color: t.text }}>{messagesUsed}</strong> of <strong style={{ color: t.text }}>{messagesLimit}</strong> messages used this month
          </span>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 11.5, fontWeight: 600,
          color: messagesAtLimit ? '#EF4444' : messagesRemaining <= 5 ? '#F59E0B' : t.textMuted,
        }}>
          {messagesAtLimit ? <><BanIcon size={12} color="#EF4444" /> Limit reached</> : `${messagesRemaining} remaining`}
        </span>
      </div>
      <div style={{ width: '100%', height: 5, borderRadius: 5, background: t.surfaceHover, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 5, background: barColor, transition: 'width 0.5s ease' }} />
      </div>
      {messagesAtLimit && (
        <div style={{
          marginTop: 10, fontSize: 12.5, color: '#EF4444',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          You've used all {messagesLimit} messages this month — upgrade your plan for more.
        </div>
      )}
      {!messagesAtLimit && messagesRemaining <= 5 && messagesRemaining > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#F59E0B' }}>
          Only {messagesRemaining} message{messagesRemaining !== 1 ? 's' : ''} left this month
        </div>
      )}
    </div>
  );
}

function GettingStarted({ projects, t }) {
  const steps = [
    { key: 'account', label: 'Create your account', done: true, icon: CheckCircleIcon },
    { key: 'chat', label: 'Start a chat — upload drawings (PDF, ZIP, Excel)', done: projects.length > 0, icon: UploadIcon },
    { key: 'boq', label: 'Generate your first BOQ (Excel & Word download)', done: projects.some(p => p.status === 'completed' || p.status === 'delivered'), icon: DownloadIcon },
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
        <Link to="/chat" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          marginTop: 12, padding: '9px 18px', borderRadius: 8,
          background: 'linear-gradient(135deg, #F59E0B, #D97706)',
          color: '#0A0F1C', fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
          boxShadow: '0 2px 10px rgba(245,158,11,0.18)',
        }}>
          Start Your First Project <ArrowRightIcon size={13} color="#0A0F1C" />
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

const STATUS_MAP = {
  submitted:        { label: 'Submitted',        color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
  completed:        { label: 'Completed',        color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  delivered:        { label: 'Delivered',        color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  in_progress:      { label: 'In Progress',      color: '#A855F7', bg: 'rgba(168,85,247,0.1)' },
  awaiting_payment: { label: 'Awaiting Payment', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
  in_review:        { label: 'In Review',        color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
};

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useTheme();
  const [projects, setProjects] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTour, setShowTour] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    Promise.all([apiFetch('/projects'), apiFetch('/usage').catch(() => null)])
      .then(([proj, usg]) => {
        setProjects(proj.projects || proj || []);
        setUsage(usg);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleDeleteProject(projectId) {
    if (!window.confirm('Delete this project? This cannot be undone.')) return;
    setDeletingId(projectId);
    try {
      await apiFetch(`/projects/${projectId}`, { method: 'DELETE' });
      setProjects(prev => prev.filter(p => p.id !== projectId));
    } catch (err) {
      alert('Failed to delete project. Please try again.');
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    if (!loading) {
      const key = `aiqs_tour_complete_${user?.id || 'default'}`;
      try {
        const seen = localStorage.getItem(key);
        // Show tour if never seen, or if tour content has been updated (version bump)
        if (!seen || Number(seen) < (TOUR_VERSION || 1)) setShowTour(true);
      } catch {}
    }
  }, [loading, user?.id]);

  const firstName = user?.fullName?.split(' ')[0] || user?.full_name?.split(' ')[0] || 'there';
  const projectList = Array.isArray(projects) ? projects : [];

  return (
    <div className="page" data-tour="welcome">
      {showTour && <OnboardingTour userId={user?.id} onComplete={() => setShowTour(false)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome back, {firstName}</h1>
          <p className="page-subtitle">Here's an overview of your projects</p>
        </div>
        <Link to="/chat" className="btn-primary" data-tour="start-chat">
          <NewProjectIcon size={15} color="#0A0F1C" />
          Start Chat
        </Link>
      </div>

      <UsageBar usage={usage} t={t} />
      <MessageUsageBar usage={usage} t={t} />
      <GettingStarted projects={projectList} t={t} />

      <div className="stats-row" data-tour="stats">
        <StatCard icon={FolderIcon} iconColor={t.accentLight} iconBg={t.accentGlow}
          value={projectList.length} label="Total Projects" t={t} />
        <StatCard icon={ClockIcon} iconColor="#F59E0B" iconBg="rgba(245,158,11,0.06)"
          value={projectList.filter(p => p.status === 'submitted' || p.status === 'in_review').length} label="In Queue" t={t} />
        <StatCard icon={PipelineIcon} iconColor="#A855F7" iconBg="rgba(168,85,247,0.06)"
          value={projectList.filter(p => p.status === 'in_progress').length} label="In Progress" t={t} />
        <StatCard icon={CheckCircleIcon} iconColor="#10B981" iconBg="rgba(16,185,129,0.06)"
          value={projectList.filter(p => p.status === 'completed' || p.status === 'delivered').length} label="Completed" t={t} accent />
      </div>

      <div className="section-card" data-tour="projects-list">
        <div className="section-card-header">
          <h2>Your Projects</h2>
          {projectList.length > 0 && (
            <span style={{ fontSize: 12, color: t.textMuted }}>{projectList.length} total</span>
          )}
        </div>

        {loading ? (
          <div className="empty-state">
            <div className="loading-spinner" />
            <p>Loading your projects...</p>
          </div>
        ) : projectList.length === 0 ? (
          <div className="empty-state">
            <div style={{
              width: 52, height: 52, borderRadius: 14, margin: '0 auto 14px',
              background: 'rgba(245,158,11,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <FolderIcon size={24} color="#F59E0B" />
            </div>
            <h3>No projects yet</h3>
            <p>Head to the chat, upload your drawings, and generate your first BOQ.</p>
            <Link to="/chat" className="btn-primary" style={{ marginTop: 16 }}>
              Start Your First Project
            </Link>
          </div>
        ) : (
          <div className="projects-list">
            {projectList.map(project => {
              const st = STATUS_MAP[project.status] || STATUS_MAP.submitted;
              return (
                <div
                  key={project.id}
                  className="project-row"
                  style={{ display: 'flex', alignItems: 'center' }}
                >
                  <Link
                    to={`/project/${project.id}`}
                    style={{ flex: 1, textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', minWidth: 0 }}
                  >
                    <div className="project-info">
                      <div className="project-title">{project.title}</div>
                      <div className="project-meta">
                        {project.item_count > 0 && <span>{project.item_count} items</span>}
                        {project.total_value > 0 && (
                          <span style={{ marginLeft: 8 }}>
                            {project.currency === 'EUR' ? '€' : '£'}{Math.round(project.total_value).toLocaleString()}
                          </span>
                        )}
                        {project.project_type && (
                          <span style={{ marginLeft: 8, opacity: 0.6 }}>{project.project_type}</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{
                        padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                        color: st.color, background: st.bg, whiteSpace: 'nowrap',
                      }}>
                        {st.label}
                      </span>
                      <span className="project-date" style={{ whiteSpace: 'nowrap' }}>
                        {new Date(project.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </span>
                    </div>
                  </Link>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDeleteProject(project.id);
                    }}
                    disabled={deletingId === project.id}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: t.textMuted, fontSize: 16, padding: '2px 6px',
                      borderRadius: 5, opacity: deletingId === project.id ? 0.4 : 0.5,
                      lineHeight: 1, flexShrink: 0, marginLeft: 8,
                    }}
                    title="Delete project"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
