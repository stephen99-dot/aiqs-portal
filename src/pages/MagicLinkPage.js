import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

// ═══════════════════════════════════════════════════════════════════════════════
// MAGIC LINK PAGE — src/pages/MagicLinkPage.js
// Handles /magic/:token URL, auto-logs user in, redirects to their project
// ═══════════════════════════════════════════════════════════════════════════════

const API_BASE = '/api';

export default function MagicLinkPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading, success, error
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('No magic link token provided');
      return;
    }

    const verifyMagicLink = async () => {
      try {
        const response = await fetch(`${API_BASE}/magic/${token}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Invalid or expired link');
        }

        // Store the JWT token and user info
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));

        setStatus('success');

        // Redirect to the specific project or dashboard
        setTimeout(() => {
          if (data.projectId) {
            navigate(`/project/${data.projectId}`, { replace: true });
          } else {
            navigate('/dashboard', { replace: true });
          }
        }, 1500);

      } catch (err) {
        setStatus('error');
        setError(err.message);
      }
    };

    verifyMagicLink();
  }, [token, navigate]);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #06080F 0%, #0C1528 50%, #0A0F1C 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', -apple-system, sans-serif",
    }}>
      <div style={{
        textAlign: 'center', padding: 48, maxWidth: 440,
        background: 'rgba(19,27,46,0.8)',
        border: '1px solid rgba(28,42,68,0.6)',
        borderRadius: 20,
        backdropFilter: 'blur(20px)',
      }}>
        {status === 'loading' && (
          <>
            <div style={{
              width: 56, height: 56, margin: '0 auto 24px',
              border: '3px solid rgba(37,99,235,0.2)',
              borderTopColor: '#2563EB',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: '#E8EDF5' }}>
              Opening your project...
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#5A6E87' }}>
              Verifying your access link
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{
              width: 56, height: 56, margin: '0 auto 24px',
              background: 'rgba(16,185,129,0.1)',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: '#E8EDF5' }}>
              You're in! ✨
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#5A6E87' }}>
              Redirecting to your project now...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{
              width: 56, height: 56, margin: '0 auto 24px',
              background: 'rgba(239,68,68,0.1)',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: '#E8EDF5' }}>
              Link Expired
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: 14, color: '#5A6E87' }}>
              {error || 'This magic link is no longer valid.'}
            </p>
            <a href="/login" style={{
              display: 'inline-block', padding: '12px 28px',
              background: '#2563EB', color: '#FFF', textDecoration: 'none',
              borderRadius: 10, fontSize: 14, fontWeight: 600,
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
