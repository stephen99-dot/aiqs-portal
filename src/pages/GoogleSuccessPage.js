import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch, setToken, clearToken } from '../utils/api';

// Landing page for the Google OAuth callback. The server finishes the OAuth
// dance at /api/auth/google/callback and redirects here with a portal token in
// the query string; this page stores it, loads the account, and moves on.
//
// This is a live entry point, not dead code: without a route here the app's
// catch-all sends the browser back to /login with no message, the token is
// lost, and "Continue with Google" appears to do nothing.
export default function GoogleSuccessPage() {
  const [searchParams] = useSearchParams();
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      navigate('/login?error=google_failed', { replace: true });
      return;
    }
    setToken(token);
    apiFetch('/auth/me')
      .then(user => {
        if (!user || !user.id) throw new Error('No account returned');
        loginWithToken(token, user);
        navigate('/dashboard', { replace: true });
      })
      .catch(() => {
        clearToken();
        navigate('/login?error=google_failed', { replace: true });
      });
  }, []);

  return (
    <div className="auth-page">
      <div className="auth-bg-pattern" />
      <div className="auth-container" style={{ textAlign: 'center' }}>
        <div className="auth-logo-mark" style={{ margin: '0 auto 16px' }}>AI <span>QS</span></div>
        <p style={{ color: 'var(--text-secondary)' }}>Signing you in with Google...</p>
      </div>
    </div>
  );
}
