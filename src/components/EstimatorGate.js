import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch, getEstimatorKey, setEstimatorKey, clearEstimatorKey } from '../utils/api';
import { LockIcon, ZapIcon, CheckCircleIcon } from './Icons';

// Wraps the estimator pages with a password prompt. Verifies the stored key
// against /api/estimator/stats on mount; if missing or wrong, shows a prompt.
// Backend returns { code: 'ESTIMATOR_PASSWORD_REQUIRED' } on a bad key,
// { code: 'ESTIMATOR_LOCKED' } if the server's ESTIMATOR_PASSWORD is not set,
// and { code: 'ESTIMATOR_DISABLED' } if the add-on isn't enabled on the account
// (beta is owner-approved) — that last case shows a tidy "request access" screen
// rather than letting the wrapped page render broken.

export default function EstimatorGate({ children }) {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [phase, setPhase] = useState('checking'); // checking | locked | prompt | ready | server_unset | not_enabled
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [requested, setRequested] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const verify = useCallback(async () => {
    if (!getEstimatorKey()) {
      setPhase('prompt');
      return;
    }
    try {
      await apiFetch('/estimator/stats');
      setPhase('ready');
    } catch (e) {
      if (e.data && e.data.code === 'ESTIMATOR_LOCKED') {
        setPhase('server_unset');
      } else if (e.data && e.data.code === 'ESTIMATOR_PASSWORD_REQUIRED') {
        clearEstimatorKey();
        setPhase('prompt');
      } else if (e.data && e.data.code === 'ESTIMATOR_DISABLED') {
        setPhase('not_enabled');
      } else {
        // Not a password failure — let the wrapped page render and surface its own error.
        setPhase('ready');
      }
    }
  }, []);

  useEffect(() => { verify(); }, [verify]);

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (!input.trim()) return;
    setSubmitting(true);
    setError('');
    setEstimatorKey(input.trim());
    try {
      await apiFetch('/estimator/stats');
      setPhase('ready');
    } catch (err) {
      if (err.data && err.data.code === 'ESTIMATOR_LOCKED') {
        clearEstimatorKey();
        setPhase('server_unset');
      } else if (err.data && err.data.code === 'ESTIMATOR_DISABLED') {
        // Password was fine (or never reached) — the add-on just isn't on yet.
        setPhase('not_enabled');
      } else {
        clearEstimatorKey();
        setError('Wrong password. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const requestAccess = async () => {
    setRequesting(true);
    try {
      await apiFetch('/office-in-a-box/interest', {
        method: 'POST',
        body: JSON.stringify({ status: 'interested', source: 'beta_request' }),
      });
    } catch (e) { /* best-effort — still acknowledge to the user */ }
    setRequesting(false);
    setRequested(true);
  };

  if (phase === 'ready') return children;

  if (phase === 'checking') {
    return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;
  }

  if (phase === 'not_enabled') {
    return (
      <Wrap t={t}>
        <div style={{
          width: 52, height: 52, borderRadius: 14, margin: '0 auto 14px',
          background: 'linear-gradient(135deg, #F59E0B, #D97706)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ZapIcon size={26} color="#0A0F1C" />
        </div>
        <h2 style={{ margin: 0, color: t.text }}>Office in a Box — beta</h2>
        {requested ? (
          <div style={{
            marginTop: 16, padding: '14px 16px', borderRadius: 12,
            background: t.successBg, border: `1px solid ${t.success}`,
            display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center',
          }}>
            <CheckCircleIcon size={18} color={t.success} />
            <span style={{ color: t.text, fontSize: 14, fontWeight: 600 }}>
              Request sent — we'll switch it on and be in touch.
            </span>
          </div>
        ) : (
          <>
            <p style={{ color: t.textSecondary, fontSize: 14.5, lineHeight: 1.55, marginTop: 12, marginBottom: 20 }}>
              Your account isn't switched on for the beta yet. Request access and we'll
              enable it for you — you'll get an email the moment it's live on your account.
            </p>
            <button
              onClick={requestAccess}
              disabled={requesting}
              style={{
                width: '100%', minHeight: 48, borderRadius: 10, border: 'none',
                background: 'linear-gradient(135deg, #F59E0B, #D97706)', color: '#0A0F1C',
                fontSize: 15, fontWeight: 800, cursor: requesting ? 'wait' : 'pointer',
                opacity: requesting ? 0.75 : 1,
              }}
            >
              {requesting ? 'Sending…' : 'Request beta access'}
            </button>
          </>
        )}
        <button
          onClick={() => navigate('/office-in-a-box')}
          style={{
            width: '100%', minHeight: 44, marginTop: 10, borderRadius: 10,
            background: 'transparent', border: `1px solid ${t.border}`, color: t.text,
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >
          See what's included
        </button>
      </Wrap>
    );
  }

  if (phase === 'server_unset') {
    return (
      <Wrap t={t}>
        <div style={{ marginBottom: 8 }}><LockIcon size={32} /></div>
        <h2 style={{ margin: 0, color: t.text }}>Estimator is locked</h2>
        <p style={{ color: t.textSecondary, fontSize: 14, marginTop: 12 }}>
          The server doesn't have <code style={code(t)}>ESTIMATOR_PASSWORD</code> configured yet.
          Set it in Render and redeploy, then come back here.
        </p>
      </Wrap>
    );
  }

  // 'prompt'
  return (
    <Wrap t={t}>
      <div style={{ marginBottom: 8 }}><LockIcon size={32} /></div>
      <h2 style={{ margin: 0, color: t.text }}>Password required</h2>
      <p style={{ color: t.textSecondary, fontSize: 14, marginTop: 12, marginBottom: 20 }}>
        The estimator is temporarily restricted. Enter the access password to continue.
      </p>
      <form onSubmit={submit}>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Password"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: t.bg, border: '1px solid ' + t.border, color: t.text,
            borderRadius: 8, padding: '10px 12px', fontSize: 15, outline: 'none',
          }}
        />
        {error && (
          <div style={{ marginTop: 10, color: t.danger, fontSize: 13 }}>{error}</div>
        )}
        <button
          type="submit"
          disabled={submitting || !input.trim()}
          style={{
            marginTop: 14, width: '100%',
            background: submitting ? t.surface : t.accent, color: '#fff', border: 'none',
            borderRadius: 8, padding: '10px 14px', fontSize: 15, fontWeight: 600,
            cursor: submitting ? 'wait' : 'pointer',
          }}
        >
          {submitting ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </Wrap>
  );
}

function Wrap({ t, children }) {
  return (
    <div style={{ padding: 32, color: t.text }}>
      <div style={{
        maxWidth: 420, margin: '80px auto', padding: 32, borderRadius: 12,
        background: t.card, border: '1px solid ' + t.border, textAlign: 'center',
      }}>
        {children}
      </div>
    </div>
  );
}

function code(t) {
  return {
    background: t.bg, color: t.text, padding: '2px 6px', borderRadius: 4,
    border: '1px solid ' + t.border, fontFamily: 'monospace', fontSize: 13,
  };
}
