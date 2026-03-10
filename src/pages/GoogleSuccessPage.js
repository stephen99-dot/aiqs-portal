import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { setToken } from '../utils/api';

export default function GoogleSuccessPage() {
  const [searchParams] = useSearchParams();
  const { setUserFromToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      navigate('/login?error=google_failed');
      return;
    }
    setToken(token);
    // Re-fetch user from /auth/me using the new token
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(user => {
        if (user && user.id) {
          setUserFromToken(user);
          navigate('/dashboard');
        } else {
          navigate('/login?error=google_failed');
        }
      })
      .catch(() => navigate('/login?error=google_failed'));
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
