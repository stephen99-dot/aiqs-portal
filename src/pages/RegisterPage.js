import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: '', email: '', password: '', company: '', phone: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
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
            <div className="auth-logo-mark">QS</div>
            <h1>Create your account</h1>
            <p>Start getting professional BOQs in hours</p>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-row">
              <div className="form-field">
                <label>Full Name *</label>
                <input
                  type="text" value={form.fullName}
                  onChange={e => updateField('fullName', e.target.value)}
                  placeholder="John Smith"
                  required autoFocus
                />
              </div>
              <div className="form-field">
                <label>Company</label>
                <input
                  type="text" value={form.company}
                  onChange={e => updateField('company', e.target.value)}
                  placeholder="Smith Building Ltd"
                />
              </div>
            </div>
            <div className="form-field">
              <label>Email *</label>
              <input
                type="email" value={form.email}
                onChange={e => updateField('email', e.target.value)}
                placeholder="john@smithbuilding.co.uk"
                required
              />
            </div>
            <div className="form-row">
              <div className="form-field">
                <label>Phone</label>
                <input
                  type="tel" value={form.phone}
                  onChange={e => updateField('phone', e.target.value)}
                  placeholder="07700 900000"
                />
              </div>
              <div className="form-field">
                <label>Password *</label>
                <input
                  type="password" value={form.password}
                  onChange={e => updateField('password', e.target.value)}
                  placeholder="Min 8 characters"
                  required minLength={8}
                />
              </div>
            </div>
            <button type="submit" className="btn-primary full-width" disabled={loading}>
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <div className="auth-footer">
            Already have an account? <Link to="/login">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
