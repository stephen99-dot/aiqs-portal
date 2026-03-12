import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const reviews = [
  { text: "We submitted drawings on a Monday and had a fully priced BOQ back by Tuesday morning. The accuracy was spot-on — saved our estimator two full days of work.", author: "Mark Ellison", role: "Contracts Manager, Ellison Build Ltd", initials: "ME" },
  { text: "The findings reports are incredibly detailed. We used one to support a planning application and the consultant was genuinely impressed by the level of breakdown.", author: "Sarah Donovan", role: "Development Director, Donovan Homes", initials: "SD" },
  { text: "We've tried other estimating tools but nothing comes close for speed and quality. Our tender submissions look far more professional now.", author: "Tom Rafferty", role: "Director, Rafferty Contractors", initials: "TR" },
  { text: "As a smaller contractor, having access to AI-powered quantity surveying levels the playing field. We're winning more tenders than ever.", author: "Claire Hutchinson", role: "Owner, CH Construction Services", initials: "CH" },
];

const stats = [
  { value: "£2.5M+", label: "Largest single BOQ" },
  { value: "500+", label: "Rate library items" },
  { value: "70+", label: "UK location factors" },
];

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err === 'google_denied') setError('Google sign-in was cancelled.');
    else if (err === 'account_suspended') setError('Your account has been suspended. Please contact support.');
    else if (err) setError('Google sign-in failed. Please try again.');
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => { setCurrent(c => (c + 1) % reviews.length); setFading(false); }, 400);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const result = await login(email, password);
      navigate(result && result.forcePasswordChange ? '/change-password' : '/dashboard');
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  const review = reviews[current];

  return (
    <>
      <style>{`
        .auth-shell { display: flex; min-height: 100vh; width: 100%; }
        .auth-left-panel {
          flex: 1 1 50%;
          background: linear-gradient(135deg, #0d1b2e 0%, #1B2A4A 55%, #0f2340 100%);
          position: relative; display: flex; flex-direction: column;
          justify-content: center; padding: 48px 52px; overflow: hidden;
        }
        .auth-right-panel {
          flex: 1 1 50%;
          display: flex; align-items: center; justify-content: center;
          padding: 48px 40px;
        }
        @media (max-width: 768px) {
          .auth-left-panel { display: none !important; }
          .auth-right-panel { flex: 1 1 100% !important; padding: 32px 24px; }
        }
      `}</style>

      <div className="auth-shell">

        {/* LEFT PANEL */}
        <div className="auth-left-panel">
          <div style={styles.circle1} />
          <div style={styles.circle2} />
          <div style={styles.gridLines} />
          <div style={styles.brand}>
            <div style={styles.logoLeft}>QS</div>
            <span style={styles.brandName}>AI QS Portal</span>
          </div>
          <div style={styles.statsRow}>
            {stats.map(s => (
              <div key={s.label} style={styles.stat}>
                <span style={styles.statVal}>{s.value}</span>
                <span style={styles.statLabel}>{s.label}</span>
              </div>
            ))}
          </div>
          <div style={{ ...styles.card, opacity: fading ? 0 : 1, transition: 'opacity 0.4s ease' }}>
            <span style={styles.quoteIcon}>"</span>
            <p style={styles.reviewText}>{review.text}</p>
            <div style={styles.reviewer}>
              <div style={styles.avatar}>{review.initials}</div>
              <div>
                <div style={styles.authorName}>{review.author}</div>
                <div style={styles.authorRole}>{review.role}</div>
              </div>
            </div>
          </div>
          <div style={styles.dots}>
            {reviews.map((_, i) => (
              <button key={i} style={{ ...styles.dot, ...(i === current ? styles.dotActive : {}) }}
                onClick={() => { setFading(true); setTimeout(() => { setCurrent(i); setFading(false); }, 400); }} />
            ))}
          </div>
          <p style={styles.tagline}>Precision estimating, powered by AI.</p>
        </div>

        {/* RIGHT PANEL */}
        <div className="auth-right-panel">
          <div style={styles.formWrap}>
            <div className="auth-header" style={{ marginBottom: 28 }}>
              <div className="auth-logo-mark">QS</div>
              <h1>Welcome back</h1>
              <p>Sign in to your AI QS portal</p>
            </div>
            {error && <div className="auth-error">{error}</div>}
            <a href="/api/auth/google" style={styles.googleBtn}>
              <GoogleIcon />
              Continue with Google
            </a>
            <div style={styles.divider}>
              <span style={styles.dividerLine} />
              <span style={styles.dividerText}>or</span>
              <span style={styles.dividerLine} />
            </div>
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-field">
                <label>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required autoFocus />
              </div>
              <div className="form-field">
                <label>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
              </div>
              <button type="submit" className="btn-primary full-width" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
            <div className="auth-footer">
              Don't have an account? <Link to="/register">Create one</Link>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}

const styles = {
  circle1: { position: 'absolute', top: -120, right: -120, width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(245,166,35,0.18) 0%, transparent 70%)', pointerEvents: 'none' },
  circle2: { position: 'absolute', bottom: -80, left: -80, width: 300, height: 300, borderRadius: '50%', border: '1px solid rgba(245,166,35,0.12)', pointerEvents: 'none' },
  gridLines: { position: 'absolute', inset: 0, backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`, backgroundSize: '48px 48px', pointerEvents: 'none' },
  brand: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 40 },
  logoLeft: { width: 40, height: 40, borderRadius: 10, background: '#F5A623', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 15, color: '#fff' },
  brandName: { color: 'rgba(255,255,255,0.8)', fontSize: 16 },
  statsRow: { display: 'flex', gap: 32, marginBottom: 36 },
  stat: { display: 'flex', flexDirection: 'column', gap: 2 },
  statVal: { color: '#F5A623', fontSize: 22, fontWeight: 'bold' },
  statLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' },
  card: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '28px 32px', backdropFilter: 'blur(8px)', marginBottom: 20 },
  quoteIcon: { display: 'block', fontSize: 56, lineHeight: 0.8, color: '#F5A623', marginBottom: 12 },
  reviewText: { color: 'rgba(255,255,255,0.88)', fontSize: 15, lineHeight: 1.7, fontStyle: 'italic', margin: '0 0 20px' },
  reviewer: { display: 'flex', alignItems: 'center', gap: 12 },
  avatar: { width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg, #F5A623, #d47e00)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: 13, flexShrink: 0 },
  authorName: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  authorRole: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  dots: { display: 'flex', gap: 8, marginBottom: 32 },
  dot: { width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', padding: 0, transition: 'all 0.3s' },
  dotActive: { background: '#F5A623', width: 20, borderRadius: 3 },
  tagline: { color: 'rgba(255,255,255,0.25)', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 },
  formWrap: { width: '100%', maxWidth: 380 },
  googleBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '11px 14px', borderRadius: 10, border: '1.5px solid var(--border-input)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, textDecoration: 'none', width: '100%', boxSizing: 'border-box', transition: 'opacity 0.2s' },
  divider: { display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' },
  dividerLine: { flex: 1, height: 1, background: 'var(--border)' },
  dividerText: { color: 'var(--text-muted)', fontSize: 12 },
};
