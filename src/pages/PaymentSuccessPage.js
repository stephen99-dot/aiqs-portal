import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import { CheckCircleIcon, AlertTriangleIcon, ClockIcon } from '../components/Icons';

export default function PaymentSuccessPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [status, setStatus] = useState('processing'); // processing, success, office, error
  const [project, setProject] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('office') === '1') activateOfficeAddon();
    else if (params.get('credits') === '1') confirmCredits();
    else activateProject();
  }, []);

  // Office in a Box subscription: verify directly with Stripe (reliable) and
  // fall back to polling /auth/me, until access switches on, then send them in.
  async function activateOfficeAddon() {
    for (let i = 0; i < 8; i++) {
      try {
        const r = await apiFetch('/office/verify', { method: 'POST' });
        if (r && r.activated) { await refreshUser(); setStatus('office'); return; }
      } catch (e) { /* keep trying */ }
      const fresh = await refreshUser();
      if (fresh && fresh.hasEstimator) { setStatus('office'); return; }
      await new Promise(r => setTimeout(r, 2000));
    }
    // Paid but not yet confirmed — show success anyway; verify runs again on /office.
    setStatus('office');
  }

  // BOQ credit top-up: credits are added by the Stripe webhook. Give it a few
  // seconds to land, refreshing the account so the new balance shows.
  async function confirmCredits() {
    for (let i = 0; i < 6; i++) {
      await refreshUser();
      await new Promise(r => setTimeout(r, 2000));
    }
    setStatus('credits');
  }

  async function activateProject() {
    try {
      // Get the project ID we saved before redirecting to Stripe
      const projectId = localStorage.getItem('aiqs_pending_project');

      if (!projectId) {
        setStatus('error');
        setError('No pending project found. If you just paid, please contact us and we\'ll sort it out.');
        return;
      }

      // Call the backend to activate (mark as paid/submitted)
      const result = await apiFetch(`/projects/${projectId}/activate`, {
        method: 'POST',
      });

      setProject(result);
      setStatus('success');

      // Clear the pending project from storage
      localStorage.removeItem('aiqs_pending_project');
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Something went wrong activating your project. Please contact us.');
    }
  }

  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 20, padding: '48px 40px',
        maxWidth: 500, width: '100%', textAlign: 'center',
        boxShadow: t.shadow,
      }}>
        {status === 'processing' && (
          <>
            <div style={{ marginBottom: 16 }}><ClockIcon size={48} /></div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: t.text, margin: '0 0 8px' }}>
              Processing Payment...
            </h2>
            <p style={{ fontSize: 14, color: t.textMuted }}>
              Confirming your payment. Just a moment.
            </p>
            <div className="loading-spinner" style={{ margin: '24px auto 0' }} />
          </>
        )}

        {status === 'office' && (
          <>
            <div style={{ marginBottom: 16 }}><CheckCircleIcon size={56} /></div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: t.text, margin: '0 0 8px' }}>
              Welcome to Office in a Box!
            </h2>
            <p style={{ fontSize: 14, color: t.textMuted, marginBottom: 8, lineHeight: 1.7 }}>
              Your trial is live and your account is unlocked. Speak your first job
              and a priced, branded quote comes straight back.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
              <Link to="/office" style={{
                padding: '12px 24px', borderRadius: 10,
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                color: '#0A0F1C', fontSize: 14, fontWeight: 700, textDecoration: 'none',
              }}>
                Open Office in a Box
              </Link>
            </div>
          </>
        )}

        {status === 'credits' && (
          <>
            <div style={{ marginBottom: 16 }}><CheckCircleIcon size={56} /></div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: t.text, margin: '0 0 8px' }}>
              You're topped up!
            </h2>
            <p style={{ fontSize: 14, color: t.textMuted, marginBottom: 8, lineHeight: 1.7 }}>
              Your BOQ credits have been added to your account. They never expire —
              use them whenever you like.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
              <Link to="/dashboard" style={{
                padding: '12px 24px', borderRadius: 10,
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                color: '#0A0F1C', fontSize: 14, fontWeight: 700, textDecoration: 'none',
              }}>
                Back to Dashboard
              </Link>
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ marginBottom: 16 }}><CheckCircleIcon size={56} /></div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: t.text, margin: '0 0 8px' }}>
              Payment Successful!
            </h2>
            <p style={{ fontSize: 14, color: t.textMuted, marginBottom: 8, lineHeight: 1.7 }}>
              Your project has been submitted and is now in the queue.
              We'll get your BOQ started right away.
            </p>
            {project && (
              <div style={{
                background: t.surfaceHover, borderRadius: 10,
                padding: '14px 18px', margin: '20px 0',
                textAlign: 'left',
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{project.title}</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>
                  {project.project_type} {project.location ? `· ${project.location}` : ''}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
              {project && (
                <Link to={`/project/${project.id}`} style={{
                  padding: '12px 24px', borderRadius: 10,
                  background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                  color: '#0A0F1C', fontSize: 14, fontWeight: 700,
                  textDecoration: 'none',
                }}>
                  View Project
                </Link>
              )}
              <Link to="/dashboard" style={{
                padding: '12px 24px', borderRadius: 10,
                background: 'transparent', border: `1px solid ${t.border}`,
                color: t.text, fontSize: 14, fontWeight: 600,
                textDecoration: 'none',
              }}>
                Dashboard
              </Link>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ marginBottom: 16 }}><AlertTriangleIcon size={48} /></div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: t.text, margin: '0 0 8px' }}>
              Something Went Wrong
            </h2>
            <p style={{ fontSize: 14, color: t.textMuted, marginBottom: 20, lineHeight: 1.7 }}>
              {error}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <a href="mailto:hello@crmwizardai.com?subject=Payment%20Issue" style={{
                padding: '12px 24px', borderRadius: 10,
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                color: '#0A0F1C', fontSize: 14, fontWeight: 700,
                textDecoration: 'none',
              }}>
                Contact Support
              </a>
              <Link to="/dashboard" style={{
                padding: '12px 24px', borderRadius: 10,
                background: 'transparent', border: `1px solid ${t.border}`,
                color: t.text, fontSize: 14, fontWeight: 600,
                textDecoration: 'none',
              }}>
                Dashboard
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
