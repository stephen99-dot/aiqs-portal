import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, setToken, clearToken } from '../utils/api';
import { useAuth } from '../context/AuthContext';

// Where the server sends the browser after a successful Google sign-in:
// /auth/google/success?token=<jwt>. Store the token, load the account, go in.
// (Before this page existed the token was dropped on the floor by the
// catch-all redirect and Google sign-in bounced straight back to /login.)
export default function OAuthSuccessPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = params.get('token');
    if (!token) { navigate('/login?error=google_failed', { replace: true }); return; }
    setToken(token);
    apiFetch('/auth/me')
      .then((me) => { loginWithToken(token, me); navigate('/dashboard', { replace: true }); })
      .catch(() => { clearToken(); setFailed(true); navigate('/login?error=google_failed', { replace: true }); });
  }, []);

  return (
    <div className="loading-screen">
      <div className="loading-mark">QS</div>
      <div className="loading-text">{failed ? 'Sign-in failed' : 'Signing you in…'}</div>
    </div>
  );
}
