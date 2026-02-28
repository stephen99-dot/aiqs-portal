import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, setToken } from '../utils/api';
import { useAuth } from '../context/AuthContext';

export default function MagicLinkPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('No magic link token provided');
      return;
    }

    // Clear any existing session first
    logout();

    const verifyMagicLink = async () => {
      try {
        const response = await fetch(`/api/auth/magic?token=${token}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Invalid or expired link');
        }

        // Store the JWT token using the app's standard method
        setToken(data.token);
        setUser(data.user);
        setStatus('success');

        // Show password change prompt
        setTimeout(() => setShowPasswordForm(true), 1000);

      } catch (err) {
        setStatus('error');
        setError(err.message);
      }
    };

    verifyMagicLink();
  }, [token]);

  async function handleSetPassword(e) {
    e.preventDefault();
    setPwError('');

    if (newPassword.length < 8) {
      setPwError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Passwords do not match');
      return;
    }

    setSaving(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'PUT',
        body: JSON.stringify({ password: newPassword }),
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setPwError(err.message || 'Failed to set password');
    } finally {
      setSaving(false);
    }
  }

  function handleSkip() {
    navigate('/dashboard', { replace: true });
  }

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
              Signing you in...
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#5A6E87' }}>
              Verifying your access link
            </p>
          </>
        )}

        {status === 'success' && !showPasswordForm && (
          <>
            <div style={{
              width: 48, height: 48, margin: '0 auto 20px',
              background: 'rgba(16,185,129,0.1)',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#E8EDF5' }}>
              Welcome{user ? `, ${user.fullName.split(' ')[0]}` : ''}!
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#5A6E87' }}>
              Setting up your account...
            </p>
          </>
        )}

        {status === 'success' && showPasswordForm && (
          <>
            <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: '#E8EDF5' }}>
              Set Your Password
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: 14, color: '#5A6E87', lineHeight: 1.5 }}>
              Create a password so you can log in anytime.
            </p>
            <form onSubmit={handleSetPassword} style={{ textAlign: 'left' }}>
              <label style={{ fontSize: 12, color: '#5A6E87', display: 'block', marginBottom: 4 }}>New Password</label>
              <input
                type="password" placeholder="At least 8 characters"
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
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
                marginBottom: 10, opacity: saving ? 0.6 : 1,
              }}>
                {saving ? 'Saving...' : 'Set Password & Continue'}
              </button>
              <button type="button" onClick={handleSkip} style={{
                width: '100%', padding: '11px', borderRadius: 10, fontSize: 14, fontWeight: 500,
                background: 'transparent', color: '#5A6E87', border: '1px solid rgba(28,42,68,0.6)',
                cursor: 'pointer',
              }}>
                Skip for now
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
              Link Expired
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: 14, color: '#5A6E87' }}>
              {error || 'This magic link is no longer valid.'}
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
