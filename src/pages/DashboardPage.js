import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import { withUserRef } from '../utils/stripeLinks';
import OnboardingTour, { TOUR_VERSION } from '../components/OnboardingTour';
import {
  FolderIcon, ClockIcon, PipelineIcon, CheckCircleIcon,
  ZapIcon, StarIcon, CrownIcon, BanIcon, ArrowRightIcon,
  UploadIcon, DownloadIcon, ChatIcon,
  BrainIcon,
} from '../components/Icons';

const STRIPE = {
  starter_payg:    'https://buy.stripe.com/fZu3cvebKenS2go4XW73G0g',  // £150 PAYG single BOQ
  professional:    'https://buy.stripe.com/dRmfZh9VucfK5sA0HG73G04',  // £347/mo Professional
  premium:         'https://buy.stripe.com/6oUaEX6Ji2FaaMU76473G05',  // £447/mo Premium
  extra_sub:       'https://buy.stripe.com/28E8wPd7Ggw0f3abmk73G06',  // £79 extra BOQ (subscribers)
  upgrade_premium: 'https://buy.stripe.com/6oUaEX6Ji2FaaMU76473G05',  // upgrade to premium
};

function UsageBar({ usage, t, user }) {
  if (!usage) return null;
  // Pull BOQ-specific fields from /usage. Fall back to legacy quota/used/remaining
  // (which were really project counts) only if the new fields aren't present yet.
  const { plan, planLabel, isPayg, monthName } = usage;
  const quota = usage.boqLimit != null ? usage.boqLimit : usage.quota;
  const used = usage.boqUsed != null ? usage.boqUsed : usage.used;
  const remaining = usage.boqRemaining != null ? usage.boqRemaining : usage.remaining;
  const atLimit = usage.boqAtLimit != null ? usage.boqAtLimit : usage.atLimit;

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
            {used} BOQ{used !== 1 ? 's' : ''} this month · £150 per BOQ
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* £150 per BOQ button */}
          <a href={withUserRef(STRIPE.starter_payg, user)} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '6px 12px', borderRadius: 7,
            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
            fontSize: 12, fontWeight: 700, color: '#0A0F1C', textDecoration: 'none',
            boxShadow: '0 2px 8px rgba(245,158,11,0.25)',
          }}>
            <ZapIcon size={11} color="#0A0F1C" /> £150 per BOQ
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
            <strong style={{ color: t.text }}>{used}</strong> of <strong style={{ color: t.text }}>{quota}</strong> BOQs used{monthName ? ` (${monthName})` : ' this month'}
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
              href={withUserRef(plan === 'professional' || plan === 'premium' ? STRIPE.extra_sub : STRIPE.starter_payg, user)}
              target="_blank" rel="noopener noreferrer"
              style={{
                padding: '7px 14px', borderRadius: 7,
                background: t.surfaceHover, border: `1px solid ${t.border}`,
                color: t.text, fontSize: 12, fontWeight: 600,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              Buy Extra BOQ — {plan === 'professional' || plan === 'premium' ? '£79' : '£150'}
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
  const { messagesUsed = 0, messagesLimit = 0, messagesRemaining = 0, messagesAtLimit, plan, planLabel, monthName } = usage;
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
            <strong style={{ color: t.text }}>{messagesUsed}</strong> of <strong style={{ color: t.text }}>{messagesLimit}</strong> messages used{monthName ? ` (${monthName})` : ' this month'}
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

// Submissions the QS team hasn't delivered yet — closes the loop between
// "I uploaded my drawings" and the finished project appearing below.
function SubmissionsTracker({ submissions, t }) {
  const pending = (submissions || []).filter(s => s.status !== 'delivered').slice(0, 5);
  if (pending.length === 0) return null;

  const STAGE = {
    received:    { label: 'With our QS team', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
    in_progress: { label: 'Being priced',     color: '#A855F7', bg: 'rgba(168,85,247,0.1)' },
  };

  function fmtDate(raw) {
    if (!raw) return '';
    const d = new Date(String(raw).replace(' ', 'T') + (String(raw).includes('Z') ? '' : 'Z'));
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  return (
    <div style={{
      background: t.card, border: `1px solid ${t.border}`,
      borderRadius: 12, padding: '16px 20px', marginBottom: 20, boxShadow: t.shadowSm,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <ClockIcon size={14} color="#F59E0B" />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>Drawings with our QS team</span>
      </div>
      <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 12 }}>
        Your BOQ and Findings Report will appear under Your Projects below — typically within 24 hours.
        Once delivered, open the project to amend numbers and produce a Client Copy with your own logo and colours.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pending.map(s => {
          const stage = STAGE[s.status] || STAGE.received;
          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              padding: '9px 12px', borderRadius: 8, background: t.surfaceHover,
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: t.text }}>
                {s.project_type || 'Project'}
              </span>
              <span style={{ fontSize: 11.5, color: t.textMuted, flex: 1 }}>
                {s.file_count} file{s.file_count !== 1 ? 's' : ''}{fmtDate(s.created_at) ? ` · sent ${fmtDate(s.created_at)}` : ''}
              </span>
              <span style={{
                fontSize: 10.5, fontWeight: 600, padding: '3px 9px', borderRadius: 6,
                color: stage.color, background: stage.bg, whiteSpace: 'nowrap',
              }}>
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GettingStarted({ projects, t }) {
  const steps = [
    { key: 'account', label: 'Create your account', done: true, icon: CheckCircleIcon },
    { key: 'submit', label: 'Submit your drawings — our QS team takes it from there', done: projects.length > 0, icon: UploadIcon },
    { key: 'boq', label: 'Receive your BOQ & Findings here, typically within 24 hours', done: projects.some(p => p.status === 'completed' || p.status === 'delivered'), icon: DownloadIcon },
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
  const [adminMessages, setAdminMessages] = useState([]);
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [submissions, setSubmissions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    function load(initial) {
      if (initial) setLoading(true);
      Promise.all([
        apiFetch('/projects'),
        apiFetch('/usage').catch(() => null),
        apiFetch('/my-messages').catch(() => ({ messages: [] })),
        apiFetch('/onboarding').catch(() => null),
        apiFetch('/submissions').catch(() => ({ submissions: [] })),
      ])
        .then(([proj, usg, msgs, onb, subs]) => {
          if (cancelled) return;
          setProjects(proj.projects || proj || []);
          setUsage(usg);
          setAdminMessages(msgs.messages || []);
          setOnboardingStatus(onb);
          setSubmissions(subs.submissions || []);
        })
        .catch(console.error)
        .finally(() => { if (!cancelled && initial) setLoading(false); });
    }
    load(true);
    // Re-pull projects when the tab regains focus, so a customer who left their
    // dashboard open in a background tab sees newly-delivered jobs as soon as
    // they switch back instead of having to hard-refresh.
    function onFocus() { load(false); }
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, []);

  async function dismissOnboardingBanner() {
    if (!window.confirm('Skip onboarding for now? You can always complete it later from the AI Memory page.')) return;
    try {
      await apiFetch('/onboarding', { method: 'POST', body: JSON.stringify({ skipped: true }) });
      setOnboardingStatus(s => ({ ...(s || {}), skipped: true }));
    } catch {}
  }

  const dismissMessage = async (msgId) => {
    try {
      await apiFetch('/my-messages/' + msgId + '/dismiss', { method: 'PUT' });
      setAdminMessages(prev => prev.filter(m => m.id !== msgId));
    } catch {}
  };

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

  const [showWhatsNew, setShowWhatsNew] = useState(false);

  useEffect(() => {
    if (!loading) {
      const tourKey = `aiqs_tour_complete_${user?.id || 'default'}`;
      const whatsNewKey = `aiqs_whats_new_v5_${user?.id || 'default'}`;
      try {
        const seen = localStorage.getItem(tourKey);
        // The stored value is the TOUR_VERSION the user last completed.
        // Bumping TOUR_VERSION re-shows the tour so existing users see new
        // features (intake, editable BOQ, AI Memory, Variations).
        const seenVersion = seen ? parseInt(seen, 10) : 0;
        if (seenVersion < TOUR_VERSION) {
          setShowTour(true);
        } else if (!localStorage.getItem(whatsNewKey)) {
          // Existing user who hasn't seen the latest updates — show What's New banner
          setShowWhatsNew(true);
        }
      } catch {}
    }
  }, [loading, user?.id]);

  const needsOnboarding = onboardingStatus
    && !onboardingStatus.completed_at
    && !onboardingStatus.skipped;

  const firstName = user?.fullName?.split(' ')[0] || user?.full_name?.split(' ')[0] || 'there';
  const projectList = Array.isArray(projects) ? projects : [];

  return (
    <div className="page" data-tour="welcome">
      {showTour && <OnboardingTour userId={user?.id} onComplete={() => setShowTour(false)} />}

      {/* Persistent AI profile prompt — shows until user completes or skips */}
      {needsOnboarding && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(217,119,6,0.04))',
          border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 12, padding: '18px 22px', marginBottom: 20, boxShadow: t.shadowSm,
          borderLeft: '3px solid #F59E0B',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 240 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: 'rgba(245,158,11,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20,
              }}><BrainIcon size={20} /></div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 3 }}>
                  Teach the AI how you work — 2 minutes
                </div>
                <div style={{ fontSize: 12.5, color: t.textSecondary, lineHeight: 1.5 }}>
                  Set your default contingency, standard exclusions, regions, and project types. Every future estimate will be grounded in your actual preferences.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={dismissOnboardingBanner} style={{
                background: 'none', border: 'none', color: t.textMuted, fontSize: 12, cursor: 'pointer',
                padding: '8px 12px', borderRadius: 8, fontFamily: 'inherit',
              }}>
                Not now
              </button>
              <Link to="/onboarding" style={{
                padding: '9px 18px', borderRadius: 8,
                background: 'linear-gradient(135deg,#F59E0B,#D97706)',
                color: '#0A0F1C', textDecoration: 'none',
                fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
              }}>
                Start onboarding
              </Link>
            </div>
          </div>
        </div>
      )}

      {showWhatsNew && (
        <div style={{
          background: t.card, border: `1px solid rgba(245,158,11,0.2)`,
          borderRadius: 12, padding: '18px 20px', marginBottom: 20, boxShadow: t.shadowSm,
          borderLeft: '3px solid #F59E0B',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ZapIcon size={14} color="#F59E0B" /> What's New
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: t.textSecondary, lineHeight: 1.8 }}>
                <li>
                  <strong style={{ color: t.text }}>Submit Drawings is now the main way to get a BOQ</strong> — our QS team prices your job and delivers it straight back to this portal, typically within 24 hours.{' '}
                  <Link to="/submit-drawings" style={{ color: '#F59E0B', textDecoration: 'none', fontWeight: 600 }}>Submit drawings →</Link>
                </li>
                <li><strong style={{ color: t.text }}>AI Chat is in a testing phase</strong> — feel free to explore it, but use Submit Drawings when you need numbers you can rely on</li>
                <li><strong style={{ color: t.text }}>Client Copy with your logo</strong> — open any delivered project to amend the numbers and download a branded copy to send to your client</li>
                <li>
                  <strong style={{ color: t.text }}>Your branding</strong> — upload your logo and pick your colours once, and every document wears them.{' '}
                  <Link to="/branding" style={{ color: '#F59E0B', textDecoration: 'none', fontWeight: 600 }}>Set up branding →</Link>
                </li>
              </ul>
            </div>
            <button onClick={() => {
              setShowWhatsNew(false);
              try { localStorage.setItem(`aiqs_whats_new_v5_${user?.id || 'default'}`, 'true'); } catch {}
            }} style={{
              background: 'none', border: 'none', color: t.textMuted, fontSize: 11, cursor: 'pointer',
              textDecoration: 'underline', textUnderlineOffset: 3, whiteSpace: 'nowrap', marginTop: 2,
            }}>Dismiss</button>
          </div>
        </div>
      )}

      {adminMessages.length > 0 && adminMessages.map(msg => (
        <div key={msg.id} style={{
          background: t.card, border: '1px solid rgba(37,99,235,0.25)',
          borderRadius: 12, padding: '16px 20px', marginBottom: 16, boxShadow: t.shadowSm,
          borderLeft: '3px solid #2563EB',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                background: 'rgba(37,99,235,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginTop: 1,
              }}>
                <ChatIcon size={14} color="#2563EB" />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#2563EB', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Message from AI QS</div>
                <div style={{ fontSize: 13.5, color: t.text, lineHeight: 1.5 }}>{msg.message}</div>
              </div>
            </div>
            <button onClick={() => dismissMessage(msg.id)} style={{
              background: 'none', border: 'none', color: t.textMuted, fontSize: 11, cursor: 'pointer',
              textDecoration: 'underline', textUnderlineOffset: 3, whiteSpace: 'nowrap', marginTop: 2,
            }}>Dismiss</button>
          </div>
        </div>
      ))}

      <div className="page-header">
        <div>
          <h1 className="page-title">Welcome back, {firstName}</h1>
          <p className="page-subtitle">Here's an overview of your projects</p>
        </div>
        <Link to="/submit-drawings" className="btn-primary" data-tour="submit-cta">
          <UploadIcon size={15} color="#0A0F1C" />
          Submit Drawings
        </Link>
      </div>

      <UsageBar usage={usage} t={t} user={user} />
      <MessageUsageBar usage={usage} t={t} />
      <GettingStarted projects={projectList} t={t} />
      <SubmissionsTracker submissions={submissions} t={t} />

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
            <p>Submit your drawings and our QS team will deliver your BOQ and Findings Report right here — typically within 24 hours.</p>
            <Link to="/submit-drawings" className="btn-primary" style={{ marginTop: 16 }}>
              Submit Your Drawings
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
                    <div className="project-info" style={{ minWidth: 0, flex: 1 }}>
                      <div className="project-title" style={{
                        fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 700,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{project.title}</div>
                      <div className="project-meta" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                      {project.deliverableCount > 0 && (
                        <span title="Files from your QS are ready to download" style={{
                          padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                          color: '#10B981', background: 'rgba(16,185,129,0.12)',
                          border: '1px solid rgba(16,185,129,0.3)', whiteSpace: 'nowrap',
                        }}>
                          {project.deliverableCount} doc{project.deliverableCount === 1 ? '' : 's'} ready
                        </span>
                      )}
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
