import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const reviews = [
  {
    text: "We submitted drawings on a Monday and had a fully priced BOQ back by Tuesday morning. The accuracy was spot-on — saved our estimator two full days of work.",
    author: "Mark Ellison",
    role: "Contracts Manager, Ellison Build Ltd",
    initials: "ME",
  },
  {
    text: "The findings reports are incredibly detailed. We used one to support a planning application and the consultant was genuinely impressed by the level of breakdown.",
    author: "Sarah Donovan",
    role: "Development Director, Donovan Homes",
    initials: "SD",
  },
  {
    text: "We've tried other estimating tools but nothing comes close for speed and quality. Our tender submissions look far more professional now.",
    author: "Tom Rafferty",
    role: "Director, Rafferty Contractors",
    initials: "TR",
  },
  {
    text: "As a smaller contractor, having access to AI-powered quantity surveying levels the playing field. We're winning more tenders than ever.",
    author: "Claire Hutchinson",
    role: "Owner, CH Construction Services",
    initials: "CH",
  },
];

const stats = [
  { value: "£2.5M+", label: "Largest single BOQ" },
  { value: "500+", label: "Rate library items" },
  { value: "70+", label: "UK location factors" },
];

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
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setCurrent(c => (c + 1) % reviews.length);
        setFading(false);
      }, 400);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result && result.forcePasswordChange) {
        navigate('/change-password');
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const review = reviews[current];

  return (
    <div style={styles.shell}>

      {/* ── LEFT PANEL ── */}
      <div style={styles.left}>
        <div style={styles.circle1} />
        <div style={styles.circle2} />
        <div style={styles.gridLines} />

        {/* Brand */}
        <div style={styles.brand}>
          <div style={styles.logoLeft}>QS</div>
          <span style={styles.brandName}>AI QS Portal</span>
        </div>

        {/* Stats */}
        <div style={styles.statsRow}>
          {stats.map(s => (
            <div key={s.label} style={styles.stat}>
              <span style={styles.statVal}>{s.value}</span>
              <span style={styles.statLabel}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Review card */}
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

        {/* Dots */}
        <div style={styles.dots}>
          {reviews.map((_, i) => (
            <button
              key={i}
              style={{ ...styles.dot, ...(i === current ? styles.dotActive : {}) }}
              onClick={() => {
                setFading(true);
                setTimeout(() => { setCurrent(i); setFading(false); }, 400);
              }}
            />
          ))}
        </div>

        <p style={styles.tagline}>Precision estimating, powered by AI.</p>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={styles.right}>
        <div style={styles.formWrap}>
          <div className="auth-header" style={{ marginBottom: 28 }}>
            <div className="auth-logo-mark">QS</div>
            <h1>Welcome back</h1>
            <p>Sign in to your AI QS portal</p>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-field">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoFocus
              />
            </div>
            <div className="form-field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
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
  );
}

const styles = {
  shell: {
    display: 'flex',
    minHeight: '100vh',
    width: '100%',
  },

  /* LEFT */
  left: {
    flex: '1 1 50%',
    background: 'linear-gradient(135deg, #0d1b2e 0%, #1B2A4A 55%, #0f2340 100%)',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '48px 52px',
    overflow: 'hidden',
  },
  circle1: {
    position: 'absolute',
    top: -120,
    right: -120,
    width: 400,
    height: 400,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(245,166,35,0.18) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  circle2: {
    position: 'absolute',
    bottom: -80,
    left: -80,
    width: 300,
    height: 300,
    borderRadius: '50%',
    border: '1px solid rgba(245,166,35,0.12)',
    pointerEvents: 'none',
  },
  gridLines: {
    position: 'absolute',
    inset: 0,
    backgroundImage: `
      linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
    `,
    backgroundSize: '48px 48px',
    pointerEvents: 'none',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 40,
  },
  logoLeft: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: '#F5A623',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'bold',
    fontSize: 15,
    color: '#fff',
  },
  brandName: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 16,
  },
  statsRow: {
    display: 'flex',
    gap: 32,
    marginBottom: 36,
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  statVal: {
    color: '#F5A623',
    fontSize: 22,
    fontWeight: 'bold',
  },
  statLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  card: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 16,
    padding: '28px 32px',
    backdropFilter: 'blur(8px)',
    marginBottom: 20,
  },
  quoteIcon: {
    display: 'block',
    fontSize: 56,
    lineHeight: 0.8,
    color: '#F5A623',
    marginBottom: 12,
  },
  reviewText: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 15,
    lineHeight: 1.7,
    fontStyle: 'italic',
    margin: '0 0 20px',
  },
  reviewer: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #F5A623, #d47e00)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
    flexShrink: 0,
  },
  authorName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  authorRole: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
  },
  dots: {
    display: 'flex',
    gap: 8,
    marginBottom: 32,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.2)',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    transition: 'all 0.3s',
  },
  dotActive: {
    background: '#F5A623',
    width: 20,
    borderRadius: 3,
  },
  tagline: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 12,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    margin: 0,
  },

  /* RIGHT */
  right: {
    flex: '1 1 50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 40px',
  },
  formWrap: {
    width: '100%',
    maxWidth: 380,
  },
};
