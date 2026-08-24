import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import { withUserRef } from '../utils/stripeLinks';
import OnboardingTour, { TOUR_VERSION } from '../components/OnboardingTour';
import {
  Button, IconButton, Card, Banner, Badge, StatusBadge,
  Input, PageHeader, Stat, EmptyState, SkeletonRows, ProgressBar, useToast,
} from '../ui';
import {
  FolderIcon, ClockIcon, PipelineIcon, CheckCircleIcon,
  ZapIcon, StarIcon, CrownIcon, BanIcon, ArrowRightIcon,
  UploadIcon, DownloadIcon, ChatIcon,
  BrainIcon, EditIcon,
} from '../components/Icons';

const STRIPE = {
  starter_payg: 'https://buy.stripe.com/fZu3cvebKenS2go4XW73G0g',  // £150 PAYG single BOQ
  boq_5_pack:   'https://buy.stripe.com/00w7sLgjSenSdZ6aig73G0h',  // £349 5-BOQ bundle
  boq_10_pack:  'https://buy.stripe.com/9B628raZy2Fa4ow62073G0f',  // £580 10-BOQ bundle
  boq_20_pack:  'https://buy.stripe.com/cNi4gz6Ji4Ni3ks2PO73G0l',  // £980 20-BOQ bundle
  // Retired: the £79 subscriber extra (buy.stripe.com/28E8wPd7Ggw0f3abmk73G06).
  // Everyone now buys extras at the flat £150 single-BOQ price.
};

// The bundle buy-links, rendered identically wherever they appear (PAYG bar,
// at-limit prompt). One primary action; bundles as quiet secondaries.
function BuyBoqButtons({ user, compact = false }) {
  const size = compact ? 'sm' : 'sm';
  const ext = { target: '_blank', rel: 'noopener noreferrer' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Button size={size} href={withUserRef(STRIPE.starter_payg, user)} {...ext}>
        <ZapIcon size={11} color="currentColor" /> £150 per BOQ
      </Button>
      <Button size={size} variant="soft" href={withUserRef(STRIPE.boq_5_pack, user)} {...ext}>
        5 BOQs — £349
      </Button>
      <Button size={size} variant="secondary" href={withUserRef(STRIPE.boq_10_pack, user)} {...ext}>
        10 BOQs — £580
      </Button>
      <Button size={size} variant="secondary" href={withUserRef(STRIPE.boq_20_pack, user)} {...ext}>
        20 BOQs — £980
      </Button>
    </div>
  );
}

function UsageBar({ usage, user }) {
  if (!usage) return null;
  // Pull BOQ-specific fields from /usage. Fall back to legacy quota/used/remaining
  // (which were really project counts) only if the new fields aren't present yet.
  const { plan, planLabel, isPayg } = usage;
  const quota = usage.boqLimit != null ? usage.boqLimit : usage.quota;
  const used = usage.boqUsed != null ? usage.boqUsed : usage.used;
  const remaining = usage.boqRemaining != null ? usage.boqRemaining : usage.remaining;
  const atLimit = usage.boqAtLimit != null ? usage.boqAtLimit : usage.atLimit;

  if (isPayg) {
    return (
      <Card data-tour="usage-bar" style={{ marginBottom: 16 }}>
        <Card.Body style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '14px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Badge tone="warning" size="sm"><ZapIcon size={11} color="currentColor" /> Pay As You Go</Badge>
            <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{remaining}</strong> BOQ{remaining !== 1 ? 's' : ''} available · £150 per BOQ
            </span>
          </div>
          <BuyBoqButtons user={user} compact />
        </Card.Body>
      </Card>
    );
  }

  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const planTone = plan === 'premium' ? 'violet' : 'accent';
  const PlanIcon = plan === 'premium' ? CrownIcon : StarIcon;

  return (
    <Card data-tour="usage-bar" style={{ marginBottom: 16, borderColor: atLimit ? 'var(--danger)' : undefined }}>
      <Card.Body style={{ padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Badge tone={planTone} size="sm"><PlanIcon size={11} color="currentColor" /> {planLabel}</Badge>
            <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{used}</strong> of <strong style={{ color: 'var(--text-primary)' }}>{quota}</strong> BOQs used
            </span>
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: '0.78rem', fontWeight: 600,
            color: atLimit ? 'var(--danger)' : remaining <= 2 ? 'var(--warning)' : 'var(--text-muted)',
          }}>
            {atLimit ? <><BanIcon size={12} color="currentColor" /> Limit reached</> : `${remaining} remaining`}
          </span>
        </div>
        <ProgressBar value={pct} tone="auto" />

        {atLimit && (
          <div style={{
            marginTop: 12, padding: '12px 14px', borderRadius: 10,
            background: 'var(--danger-bg)', border: '1px solid color-mix(in srgb, var(--danger) 15%, transparent)',
          }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
              You've used all your BOQ credits
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 10 }}>Buy more BOQs to continue</div>
            <BuyBoqButtons user={user} compact />
          </div>
        )}

        {!atLimit && remaining <= 2 && remaining > 0 && (
          <div style={{
            marginTop: 10, fontSize: '0.8rem', color: 'var(--warning)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
          }}>
            <span>Only {remaining} BOQ{remaining !== 1 ? 's' : ''} left</span>
            <a href={withUserRef(STRIPE.boq_5_pack, user)} target="_blank" rel="noopener noreferrer" style={{
              fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)', textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}>
              Save with a 5-BOQ bundle — £349 <ArrowRightIcon size={11} color="currentColor" />
            </a>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

function MessageUsageBar({ usage }) {
  if (!usage || usage.messagesLimit == null) return null;
  const { messagesUsed = 0, messagesLimit = 0, messagesRemaining = 0, messagesAtLimit } = usage;
  if (messagesLimit <= 0) return null;

  const pct = messagesLimit > 0 ? Math.min(100, (messagesUsed / messagesLimit) * 100) : 0;

  return (
    <Card style={{ marginBottom: 16, borderColor: messagesAtLimit ? 'var(--danger)' : undefined }}>
      <Card.Body style={{ padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Badge tone="info" size="sm"><ChatIcon size={11} color="currentColor" /> Messages</Badge>
            <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text-primary)' }}>{messagesUsed}</strong> of <strong style={{ color: 'var(--text-primary)' }}>{messagesLimit}</strong> messages used
            </span>
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: '0.78rem', fontWeight: 600,
            color: messagesAtLimit ? 'var(--danger)' : messagesRemaining <= 5 ? 'var(--warning)' : 'var(--text-muted)',
          }}>
            {messagesAtLimit ? <><BanIcon size={12} color="currentColor" /> Limit reached</> : `${messagesRemaining} remaining`}
          </span>
        </div>
        <ProgressBar value={pct} tone="auto" />
        {messagesAtLimit && (
          <div style={{ marginTop: 10, fontSize: '0.82rem', color: 'var(--danger)' }}>
            You've used all {messagesLimit} messages — contact us to top up your balance.
          </div>
        )}
        {!messagesAtLimit && messagesRemaining <= 5 && messagesRemaining > 0 && (
          <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--warning)' }}>
            Only {messagesRemaining} message{messagesRemaining !== 1 ? 's' : ''} left
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

// Submissions the QS team hasn't delivered yet — closes the loop between
// "I uploaded my drawings" and the finished project appearing below.
function SubmissionsTracker({ submissions }) {
  const pending = (submissions || []).filter(s => s.status !== 'delivered').slice(0, 5);
  if (pending.length === 0) return null;

  function fmtDate(raw) {
    if (!raw) return '';
    const d = new Date(String(raw).replace(' ', 'T') + (String(raw).includes('Z') ? '' : 'Z'));
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <Card.Body style={{ padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <ClockIcon size={14} color="var(--warning)" />
          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>Drawings with our QS team</span>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          Your BOQ and Findings Report will appear under Your Projects below — typically within 24 hours.
          Once delivered, open the project to amend numbers and produce a Client Copy with your own logo and colours.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {pending.map(s => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              padding: '9px 12px', borderRadius: 8, background: 'var(--surface-hover)',
            }}>
              <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {s.project_type || 'Project'}
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flex: 1 }}>
                {s.file_count} file{s.file_count !== 1 ? 's' : ''}{fmtDate(s.created_at) ? ` · sent ${fmtDate(s.created_at)}` : ''}
              </span>
              <StatusBadge status={s.status === 'in_progress' ? 'in_progress' : 'received'} />
            </div>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
}

function GettingStarted({ projects }) {
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
    <Card style={{ marginBottom: 16 }}>
      <Card.Body style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 1 }}>Getting Started</div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{completedCount} of {steps.length} complete</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setDismissed(true); try { localStorage.setItem('aiqs_checklist_dismissed', 'true'); } catch {} }}>
            Dismiss
          </Button>
        </div>
        <ProgressBar value={pct} tone="gradient" height={3} style={{ marginBottom: 14 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {steps.map(s => (
            <div key={s.key} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 10px', borderRadius: 8,
              background: s.done ? 'var(--success-bg)' : 'var(--surface-hover)',
              opacity: s.done ? 0.65 : 1,
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                background: s.done ? 'var(--success-bg)' : 'var(--accent-glow)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {s.done ? <CheckCircleIcon size={13} color="var(--success)" /> : <s.icon size={13} color="var(--accent)" />}
              </div>
              <span style={{
                fontSize: '0.84rem', fontWeight: 500,
                color: s.done ? 'var(--text-muted)' : 'var(--text-primary)',
                textDecoration: s.done ? 'line-through' : 'none',
              }}>{s.label}</span>
            </div>
          ))}
        </div>
        {projects.length === 0 && (
          <Button to="/chat" full style={{ marginTop: 12 }}>
            Start Your First Project <ArrowRightIcon size={13} color="currentColor" />
          </Button>
        )}
      </Card.Body>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [projects, setProjects] = useState([]);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTour, setShowTour] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [adminMessages, setAdminMessages] = useState([]);
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const navigate = useNavigate();

  // New signups go through onboarding before they see the dashboard or the
  // tour — whichever door they came in by (register, login, magic link).
  // Completing or skipping it clears the flag, so no loop.
  const mustOnboard = onboardingStatus
    && onboardingStatus.is_new_account
    && !onboardingStatus.completed_at
    && !onboardingStatus.skipped;

  useEffect(() => {
    if (mustOnboard) navigate('/onboarding', { replace: true });
  }, [mustOnboard, navigate]);

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
      toast.success('Project deleted');
    } catch (err) {
      toast.error(err?.message ? `Couldn't delete project: ${err.message}` : 'Failed to delete project. Please try again.');
    } finally {
      setDeletingId(null);
    }
  }

  // Inline project rename on the list
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  async function handleRenameProject(projectId) {
    const title = editTitle.trim();
    if (!title) return;
    setRenamingId(projectId);
    try {
      await apiFetch(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ title }) });
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, title } : p));
      setEditingId(null);
    } catch (err) {
      toast.error(err?.message ? `Couldn't rename project: ${err.message}` : 'Failed to rename project. Please try again.');
    } finally {
      setRenamingId(null);
    }
  }

  const [showWhatsNew, setShowWhatsNew] = useState(false);

  useEffect(() => {
    if (!loading && !mustOnboard) {
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
  }, [loading, user?.id, mustOnboard]);

  const needsOnboarding = onboardingStatus
    && !onboardingStatus.completed_at
    && !onboardingStatus.skipped;

  const firstName = user?.fullName?.split(' ')[0] || user?.full_name?.split(' ')[0] || 'there';
  const projectList = Array.isArray(projects) ? projects : [];

  // On their way to onboarding — don't flash the dashboard behind the redirect.
  if (mustOnboard) return null;

  return (
    <div className="page" data-tour="welcome">
      {showTour && <OnboardingTour userId={user?.id} onComplete={() => setShowTour(false)} />}

      {/* Persistent AI profile prompt — shows until user completes or skips */}
      {needsOnboarding && (
        <Banner tone="accent" style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 240 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: 'var(--accent-glow)', color: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><BrainIcon size={20} /></div>
              <div>
                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>
                  Teach the AI how you work — 2 minutes
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Tell us your trade, answer a few quick questions and add your logo. Our team tunes your account and every estimate prices from your rates, not generic figures.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <Button variant="ghost" size="sm" onClick={dismissOnboardingBanner}>Not now</Button>
              <Button to="/onboarding">Start onboarding</Button>
            </div>
          </div>
        </Banner>
      )}

      {showWhatsNew && (
        <Banner tone="accent">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ZapIcon size={14} color="var(--accent)" /> What's New
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>Submit Drawings is now the main way to get a BOQ</strong> — our QS team prices your job and delivers it straight back to this portal, typically within 24 hours.{' '}
                  <Link to="/submit-drawings" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Submit drawings →</Link>
                </li>
                <li><strong style={{ color: 'var(--text-primary)' }}>AI Chat is in a testing phase</strong> — feel free to explore it, but use Submit Drawings when you need numbers you can rely on</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Client Copy with your logo</strong> — open any delivered project to amend the numbers and download a branded copy to send to your client</li>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>Your branding</strong> — upload your logo and pick your colours once, and every document wears them.{' '}
                  <Link to="/branding" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Set up branding →</Link>
                </li>
              </ul>
            </div>
            <Button variant="ghost" size="sm" onClick={() => {
              setShowWhatsNew(false);
              try { localStorage.setItem(`aiqs_whats_new_v5_${user?.id || 'default'}`, 'true'); } catch {}
            }}>Dismiss</Button>
          </div>
        </Banner>
      )}

      {adminMessages.length > 0 && adminMessages.map(msg => (
        <Banner key={msg.id} tone="info">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                background: 'var(--info-bg)', color: 'var(--info)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginTop: 1,
              }}>
                <ChatIcon size={14} color="currentColor" />
              </div>
              <div>
                <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--info)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Message from AI QS</div>
                <div style={{ fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{msg.message}</div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => dismissMessage(msg.id)}>Dismiss</Button>
          </div>
        </Banner>
      ))}

      <PageHeader
        title={`Welcome back, ${firstName}`}
        subtitle="Here's an overview of your projects"
        actions={
          <Button to="/submit-drawings" data-tour="submit-cta">
            <UploadIcon size={15} color="currentColor" />
            Submit Drawings
          </Button>
        }
      />

      <UsageBar usage={usage} user={user} />
      <MessageUsageBar usage={usage} />
      <GettingStarted projects={projectList} />
      <SubmissionsTracker submissions={submissions} />

      <div className="stats-row" data-tour="stats">
        <Stat icon={FolderIcon} tone="accent"
          value={projectList.length} label="Total Projects" />
        <Stat icon={ClockIcon} tone="warning"
          value={projectList.filter(p => p.status === 'submitted' || p.status === 'in_review').length} label="In Queue" />
        <Stat icon={PipelineIcon} tone="violet"
          value={projectList.filter(p => p.status === 'in_progress').length} label="In Progress" />
        <Stat icon={CheckCircleIcon} tone="success" accent
          value={projectList.filter(p => p.status === 'completed' || p.status === 'delivered').length} label="Completed" />
      </div>

      <Card data-tour="projects-list">
        <Card.Header
          title="Your Projects"
          extra={projectList.length > 0 ? `${projectList.length} total` : null}
        />

        {loading ? (
          <SkeletonRows rows={4} />
        ) : projectList.length === 0 ? (
          <EmptyState
            icon={FolderIcon}
            title="No projects yet"
            body="Submit your drawings and our QS team will deliver your BOQ and Findings Report right here — typically within 24 hours."
            action={<Button to="/submit-drawings">Submit Your Drawings</Button>}
          />
        ) : (
          <div>
            {projectList.map(project => (
              <div key={project.id} className="ui-row">
                {editingId === project.id ? (
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameProject(project.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      style={{ flex: 1, minWidth: 0, fontWeight: 600 }}
                    />
                    <Button size="sm"
                      onClick={() => handleRenameProject(project.id)}
                      disabled={renamingId === project.id || !editTitle.trim()}
                    >{renamingId === project.id ? 'Saving…' : 'Save'}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                ) : (
                  <>
                    <Link to={`/project/${project.id}`} className="ui-row__main" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="ui-row__title" style={{ fontSize: '0.95rem', fontWeight: 700 }}>{project.title}</div>
                      <div className="ui-row__meta">
                        {project.item_count > 0 && <span>{project.item_count} items</span>}
                        {project.total_value > 0 && (
                          <span>
                            {project.currency === 'EUR' ? '€' : '£'}{Math.round(project.total_value).toLocaleString()}
                          </span>
                        )}
                        {project.project_type && <span style={{ opacity: 0.7 }}>{project.project_type}</span>}
                      </div>
                    </Link>
                    <div className="ui-row__side">
                      {project.deliverableCount > 0 && (
                        <Badge tone="success" outlined title="Files from your QS are ready to download">
                          {project.deliverableCount} doc{project.deliverableCount === 1 ? '' : 's'} ready
                        </Badge>
                      )}
                      <StatusBadge status={project.status} />
                      <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                        {new Date(project.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </span>
                      <IconButton
                        onClick={() => { setEditingId(project.id); setEditTitle(project.title || ''); }}
                        title="Rename project" aria-label="Rename project"
                      >
                        <EditIcon size={14} />
                      </IconButton>
                      <IconButton danger
                        onClick={() => handleDeleteProject(project.id)}
                        disabled={deletingId === project.id}
                        title="Delete project" aria-label="Delete project"
                      >
                        ✕
                      </IconButton>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
