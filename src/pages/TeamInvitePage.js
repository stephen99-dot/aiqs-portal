import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// A colleague invited via "Authorized sign-in emails" on the admin Users page
// lands here from their invite email, sets their own password, and is signed
// straight in to the account they've been given access to.
export default function TeamInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { loginWithToken, logout } = useAuth();
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('No invite token provided');
      return;
    }

    // Clear any existing session first
    logout();

    fetch(`/api/auth/team-invite?token=${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Invalid or expired invite');
        setInvite(data);
        setStatus('ready');
      })
      .catch((err) => {
        setStatus('error');
        setError(err.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setPwError('');
    if (password.length < 8) { setPwError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setPwError('Passwords do not match'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/team-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to set password');
      loginWithToken(data.token, data.user);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setPwError(err.message || 'Failed to set password');
    } finally {
      setSaving(false);
    }
  }

  const ownerLabel = invite ? (invite.ownerCompany || invite.ownerName || 'this account') : '';

  const inputStyle = {
    width: '100%', padding: '12px 16px', borderRadius: 10, fontSize: 16,
    background: 'rgba(10,15,28,0.8)', border: '1px solid rgba(28,42,68,0.6)',
    color: '#E8EDF5', outline: 'none', marginBottom: 12,
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #06080F 0%, #0C1528 50%, #0A0F1C 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Instrument Sans', -apple-system, sans-serif",
      padding: 20,
    }}>
      <div style={{
        textAlign: 'center', padding: 40, maxWidth: 420, width: '100%',
        background: 'rgba(19,27,46,0.8)',
        border: '1px solid rgba(28,42,68,0.6)',
        borderRadius: 20,
        backdropFilter: 'blur(20px)',
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#E8EDF5' }}>
            AI <span style={{ color: '#F59E0B' }}>QS</span>
          </div>
          <div style={{ fontSize: 9, letterSpacing: 3, color: '#5A6E87', textTransform: 'uppercase', marginTop: 2 }}>
            Quantity Surveying
          </div>
        </div>

        {status === 'loading' && (
          <>
            <div style={{
              width: 48, height: 48, margin: '0 auto 20px',
              border: '3px solid rgba(245,158,11,0.2)',
              borderTopColor: '#F59E0B',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#E8EDF5' }}>
              Loading your invite...
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#5A6E87' }}>
              Verifying your access link
            </p>
          </>
        )}

        {status === 'ready' && (
          <>
            <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: '#E8EDF5' }}>
              Set Your Password
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: 14, color: '#5A6E87', lineHeight: 1.5 }}>
              You've been given access to <strong style={{ color: '#E8EDF5' }}>{ownerLabel}</strong>'s portal.
              Create a password for <strong style={{ color: '#E8EDF5' }}>{invite.email}</strong> to sign in.
            </p>
            <form onSubmit={handleSubmit} style={{ textAlign: 'left' }}>
              <label style={{ fontSize: 12, color: '#5A6E87', display: 'block', marginBottom: 4 }}>New Password</label>
              <input
                type="password" placeholder="At least 8 characters"
                value={password} onChange={e => setPassword(e.target.value)}
                style={inputStyle}
              />
              <label style={{ fontSize: 12, color: '#5A6E87', display: 'block', marginBottom: 4 }}>Confirm Password</label>
              <input
                type="password" placeholder="Confirm your password"
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                style={inputStyle}
              />
              {pwError && (
                <div style={{ fontSize: 13, color: '#EF4444', marginBottom: 12 }}>{pwError}</div>
              )}
              <button type="submit" disabled={saving} style={{
                width: '100%', padding: '13px', borderRadius: 10, fontSize: 15, fontWeight: 700,
                background: '#F59E0B', color: '#0F172A', border: 'none', cursor: 'pointer',
                opacity: saving ? 0.6 : 1,
              }}>
                {saving ? 'Setting up...' : 'Set Password & Sign In'}
              </button>
            </form>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{
              width: 48, height: 48, margin: '0 auto 20px',
              background: 'rgba(239,68,68,0.1)',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#E8EDF5' }}>
              Invite Not Valid
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: 14, color: '#5A6E87' }}>
              {error || 'This invite link is no longer valid.'}
            </p>
            <a href="/login" style={{
              display: 'inline-block', padding: '13px 32px',
              background: '#F59E0B', color: '#0F172A', textDecoration: 'none',
              borderRadius: 10, fontSize: 14, fontWeight: 700,
            }}>
              Go to Login
            </a>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
