import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

// Shown straight after a login whose account is flagged force_password_change
// (an admin reset the password from the Users page). The login page sends
// people here; without this route they land on the dashboard still holding
// the temporary password.
export default function ChangePasswordPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'PUT',
        body: JSON.stringify({ password }),
      });
      setUser(prev => (prev ? { ...prev, forcePasswordChange: false } : prev));
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-bg-pattern" />
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-logo-mark">AI <span>QS</span></div>
            <h1>Set a new password</h1>
            <p>Your password was reset by an admin. Choose a new one before continuing.</p>
          </div>
          {error && <div className="auth-error">{error}</div>}
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-field">
              <label>New Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" required autoFocus />
            </div>
            <div className="form-field">
              <label>Confirm Password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat your new password" required />
            </div>
            <button type="submit" className="btn-primary full-width" disabled={loading}>
              {loading ? 'Saving...' : 'Set New Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
