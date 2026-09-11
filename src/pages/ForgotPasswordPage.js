import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';

// Self-service recovery. Whatever the email, the server answers the same way,
// so the page never confirms whether an address has an account — it just
// tells people to check their inbox.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get('email') || '');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="auth-page">
      <div className="auth-bg-pattern" />
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-logo-mark">AI <span>QS</span></div>
            <h1>{sent ? 'Check your inbox' : 'Forgot your password?'}</h1>
            <p>
              {sent
                ? `If ${email} has an account, we've emailed it a sign-in link. Open it, and you'll be asked to set a new password.`
                : 'Enter the email you signed up with and we\'ll send you a link that signs you straight in — no password needed.'}
            </p>
          </div>
          {error && <div className="auth-error">{error}</div>}
          {sent ? (
            <div className="auth-footer" style={{ marginTop: 0 }}>
              <p style={{ marginBottom: 14 }}>The link lasts an hour. Nothing arrived? Check your spam folder, or <button type="button" onClick={() => setSent(false)} style={styles.linkButton}>try again</button>.</p>
              <Link to="/login">Back to sign in</Link>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="auth-form">
                <div className="form-field">
                  <label>Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required autoFocus />
                </div>
                <button type="submit" className="btn-primary full-width" disabled={loading}>
                  {loading ? 'Sending...' : 'Email me a sign-in link'}
                </button>
              </form>
              <div className="auth-footer">
                Signed up with Google? Just use <strong>Continue with Google</strong> on the <Link to="/login">sign-in page</Link>.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  linkButton: { background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' },
};
