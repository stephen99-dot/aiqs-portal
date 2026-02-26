import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';

export default function PaymentSuccessPage() {
  const { t } = useTheme();
  const navigate = useNavigate();
  const [status, setStatus] = useState('processing'); // processing, success, error
  const [project, setProject] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    activateProject();
  }, []);

  async function activateProject() {
    try {
      // Get the project ID we saved before redirecting to Stripe
      const projectId = localStorage.getItem('aiqs_pending_project');

      if (!projectId) {
        setStatus('error');
        setError('No pending project found. If you just paid, please contact us and we\'ll sort it out.');
        return;
      }

      // Call the backend to activate (mark as paid/submitted)
      const result = await apiFetch(`/projects/${projectId}/activate`, {
        method: 'POST',
      });

      setProject(result);
      setStatus('success');

      // Clear the pending project from storage
      localStorage.removeItem('aiqs_pending_project');
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Something went wrong activating your project. Please contact us.');
    }
  }

  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div style={{
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 20, padding: '48px 40px',
        maxWidth: 500, width: '100%', textAlign: 'center',
        boxShadow: t.shadow,
      }}>
        {status === 'processing' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: t.text, margin: '0 0 8px' }}>
              Processing Payment...
            </h2>
            <p style={{ fontSize: 14, color: t.textMuted }}>
              Activating your project. Just a moment.
            </p>
            <div className="loading-spinner" style={{ margin: '24px auto 0' }} />
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: t.text, margin: '0 0 8px' }}>
              Payment Successful!
            </h2>
            <p style={{ fontSize: 14, color: t.textMuted, marginBottom: 8, lineHeight: 1.7 }}>
              Your project has been submitted and is now in the queue.
              We'll get your BOQ started right away.
            </p>
            {project && (
              <div style={{
                background: t.surfaceHover, borderRadius: 10,
                padding: '14px 18px', margin: '20px 0',
                textAlign: 'left',
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{project.title}</div>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>
                  {project.project_type} {project.location ? `· ${project.location}` : ''}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
              {project && (
                <Link to={`/project/${project.id}`} style={{
                  padding: '12px 24px', borderRadius: 10,
                  background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                  color: '#0A0F1C', fontSize: 14, fontWeight: 700,
                  textDecoration: 'none',
                }}>
                  View Project
                </Link>
              )}
              <Link to="/dashboard" style={{
                padding: '12px 24px', borderRadius: 10,
                background: 'transparent', border: `1px solid ${t.border}`,
                color: t.text, fontSize: 14, fontWeight: 600,
                textDecoration: 'none',
              }}>
                Dashboard
              </Link>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: t.text, margin: '0 0 8px' }}>
              Something Went Wrong
            </h2>
            <p style={{ fontSize: 14, color: t.textMuted, marginBottom: 20, lineHeight: 1.7 }}>
              {error}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <a href="mailto:hello@crmwizardai.com?subject=Payment%20Issue" style={{
                padding: '12px 24px', borderRadius: 10,
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                color: '#0A0F1C', fontSize: 14, fontWeight: 700,
                textDecoration: 'none',
              }}>
                Contact Support
              </a>
              <Link to="/dashboard" style={{
                padding: '12px 24px', borderRadius: 10,
                background: 'transparent', border: `1px solid ${t.border}`,
                color: t.text, fontSize: 14, fontWeight: 600,
                textDecoration: 'none',
              }}>
                Dashboard
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
