import React, { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import { CheckCircleIcon, MailIcon } from '../components/Icons';

// ═══ After a MAX checkout, not signed in ══════════════════════════════════════
// The website sends visitors straight to Stripe, so they come back here without
// a session. Stripe adds the checkout id to the address; the server says which
// email bought which plan and whether that email has an account:
//
//   has an account   congratulations, it is unlocked — log in
//   no account yet   one step left — create your account with that email, and
//                    the plan attaches itself at sign-up
//   no checkout id   (links made before the id was added) both choices
//
// The same next step is in the email the webhook sends. Someone already signed
// in goes to the usual confirmation, which switches the plan on.

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function MaxWelcomePage() {
  const { t } = useTheme();
  const { user, loading } = useAuth();
  const [params] = useSearchParams();
  const sessionId = params.get('session_id') || '';
  const [info, setInfo] = useState(null);
  const [looked, setLooked] = useState(!sessionId);

  useEffect(() => {
    if (!sessionId || user || loading) return;
    let live = true;
    apiFetch('/public/max/checkout?session_id=' + encodeURIComponent(sessionId))
      .then((r) => { if (live) setInfo(r); })
      .catch(() => { if (live) setInfo(null); })
      .finally(() => { if (live) setLooked(true); });
    return () => { live = false; };
  }, [sessionId, user, loading]);

  if (loading) return <div className="loading-screen"><div className="loading-mark">QS</div></div>;
  if (user) return <Navigate to={'/payment-success?plan=max' + (sessionId ? '&session_id=' + encodeURIComponent(sessionId) : '')} replace />;

  const after = '/payment-success?plan=max';
  const email = (info && info.email) || '';
  const planName = (info && info.plan_name) || 'AI QS MAX';
  const trialEnds = info && info.status === 'trialing' ? fmtDate(info.trial_ends_at) : '';
  const q = (extra) => new URLSearchParams({ ...(email ? { email } : {}), ...extra, next: after }).toString();
  const registerHref = '/register?' + q({ from: 'max' });
  const loginHref = '/login?' + q({});

  const primary = { display: 'inline-block', padding: '13px 28px', borderRadius: 10, background: 'linear-gradient(135deg, #F59E0B, #D97706)', color: '#0A0F1C', fontSize: 15, fontWeight: 700, textDecoration: 'none' };
  const secondary = { display: 'inline-block', padding: '13px 24px', borderRadius: 10, border: `1px solid ${t.border}`, color: t.text, fontSize: 15, fontWeight: 600, textDecoration: 'none' };
  const para = { fontSize: 15, color: t.textMuted, lineHeight: 1.7, margin: '0 0 8px' };
  const trialNote = trialEnds && (
    <div style={{ margin: '20px 0 4px', padding: '12px 16px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', fontSize: 14, color: t.text, lineHeight: 1.6 }}>
      Free until <strong>{trialEnds}</strong>. Cancel on the Plans page before then and you pay nothing.
    </div>
  );

  let body;
  if (!looked) {
    body = (
      <>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: t.text, margin: '0 0 8px' }}>Confirming your checkout…</h1>
        <div className="loading-spinner" style={{ margin: '24px auto 0' }} />
      </>
    );
  } else if (info && info.has_account) {
    body = (
      <>
        <div style={{ marginBottom: 16 }}><CheckCircleIcon size={56} /></div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: t.text, margin: '0 0 10px' }}>Congratulations — {planName} is unlocked</h1>
        <p style={para}>It is on your AI QS account <strong style={{ color: t.text }}>{email}</strong>. Log in and MAX, Scan a room and LiDAR scanning are ready to use.</p>
        {trialNote}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <Link to={loginHref} style={primary}>Log in to use MAX</Link>
        </div>
      </>
    );
  } else if (info) {
    body = (
      <>
        <div style={{ marginBottom: 16 }}><CheckCircleIcon size={56} /></div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: t.text, margin: '0 0 10px' }}>{trialEnds ? 'Your free trial has started' : 'You are on ' + planName}</h1>
        <p style={para}>One step left: create your AI QS account with <strong style={{ color: t.text }}>{email}</strong> — the email you used at checkout — and {planName} switches on the moment you are in.</p>
        {trialNote}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <Link to={registerHref} style={primary}>Create my account</Link>
        </div>
        <p style={{ ...para, fontSize: 13, marginTop: 20 }}>We have emailed you this link too. Already have an account under a different email? <Link to={'/login?next=' + encodeURIComponent(after)} style={{ color: '#D97706', fontWeight: 600 }}>Log in</Link> and reply to our email — we will move {planName} across.</p>
      </>
    );
  } else {
    body = (
      <>
        <div style={{ marginBottom: 16 }}><MailIcon size={52} /></div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: t.text, margin: '0 0 10px' }}>Thanks — you are in</h1>
        <p style={para}>We have emailed you the next step. New to AI QS? Create your account with the email you used at checkout and MAX switches on straight away. Already have an account? Log in with that email.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <Link to={registerHref} style={primary}>Create my account</Link>
          <Link to={loginHref} style={secondary}>Log in</Link>
        </div>
      </>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
      <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 20, padding: '40px 32px', maxWidth: 520, width: '100%', textAlign: 'center', boxShadow: t.shadow }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: t.text, marginBottom: 24 }}>AI <span style={{ color: '#F59E0B' }}>QS</span></div>
        {body}
      </div>
    </div>
  );
}
