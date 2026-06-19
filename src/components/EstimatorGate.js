import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import { ZapIcon } from './Icons';

// Office in a Box is a paid add-on, gated purely by has_estimator. This wrapper
// confirms the add-on is active before letting the estimator pages render; if
// it isn't, it shows a tidy "start your trial" screen rather than a broken page.
// The old beta password lock has been retired.

export default function EstimatorGate({ children }) {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [phase, setPhase] = useState('checking'); // checking | ready | not_enabled

  const verify = useCallback(async () => {
    try {
      await apiFetch('/estimator/stats');
      setPhase('ready');
    } catch (e) {
      // Only an inactive add-on blocks the page; anything else (a transient
      // error) lets the wrapped page render and surface its own message.
      if (e.data && e.data.code === 'ESTIMATOR_DISABLED') setPhase('not_enabled');
      else setPhase('ready');
    }
  }, []);

  useEffect(() => { verify(); }, [verify]);

  if (phase === 'ready') return children;

  if (phase === 'checking') {
    return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Loading…</div>;
  }

  // not_enabled — Office in a Box isn't on this account yet.
  return (
    <Wrap t={t}>
      <div style={{
        width: 52, height: 52, borderRadius: 14, margin: '0 auto 14px',
        background: 'linear-gradient(135deg, #F59E0B, #D97706)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <ZapIcon size={26} color="#0A0F1C" />
      </div>
      <h2 style={{ margin: 0, color: t.text }}>Office in a Box</h2>
      <p style={{ color: t.textSecondary, fontSize: 14.5, lineHeight: 1.55, marginTop: 12, marginBottom: 20 }}>
        Office in a Box isn't active on your account yet. Start your 7-day free
        trial and it switches on straight away — no charge today.
      </p>
      <button
        onClick={() => navigate('/office-in-a-box')}
        style={{
          width: '100%', minHeight: 48, borderRadius: 10, border: 'none',
          background: 'linear-gradient(135deg, #F59E0B, #D97706)', color: '#0A0F1C',
          fontSize: 15, fontWeight: 800, cursor: 'pointer',
        }}
      >
        Start 7-day free trial
      </button>
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
