import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
    // Fetch the user with the new token, then log in via AuthContext so the
    // token is stored and user state is set before we enter a protected route.
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(user => {
        if (user && user.id) {
          loginWithToken(token, user);
          navigate(user.hasEstimator ? '/office' : '/dashboard', { replace: true });
        } else {
          navigate('/login?error=google_failed', { replace: true });
        }
      })
      .catch(() => navigate('/login?error=google_failed', { replace: true }));
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="auth-logo-mark" style={{ margin: '0 auto 16px' }}>QS</div>
        <p style={{ color: 'var(--text-secondary)' }}>Signing you in with Google...</p>
      </div>
    </div>
  );
}
