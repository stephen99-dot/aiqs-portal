import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch, getEstimatorKey, setEstimatorKey, clearEstimatorKey } from '../utils/api';
import { LockIcon } from './Icons';

// Wraps the estimator pages with a password prompt. Verifies the stored key
// against /api/estimator/stats on mount; if missing or wrong, shows a prompt.
// Backend returns { code: 'ESTIMATOR_PASSWORD_REQUIRED' } on a bad key and
// { code: 'ESTIMATOR_LOCKED' } if the server's ESTIMATOR_PASSWORD is not set.

export default function EstimatorGate({ children }) {
  const { t } = useTheme();
  const [phase, setPhase] = useState('checking'); // checking | locked | prompt | ready | server_unset
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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
      clearEstimatorKey();
      if (err.data && err.data.code === 'ESTIMATOR_LOCKED') {
        setPhase('server_unset');
      } else {
        setError('Wrong password. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (phase === 'ready') return children;

  if (phase === 'checking') {
    return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;
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
