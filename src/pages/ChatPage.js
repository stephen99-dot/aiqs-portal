import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';

export default function ChatPage() {
  const { t } = useTheme();

  return (
    <div style={{
      minHeight: 'calc(100vh - 64px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      background: t.bg,
    }}>
      <div style={{
        maxWidth: 520,
        width: '100%',
        background: t.card,
        border: `1px solid ${t.border}`,
        borderRadius: 16,
        padding: '40px 32px',
        textAlign: 'center',
        boxShadow: t.shadow,
      }}>
        <div style={{
          width: 64,
          height: 64,
          margin: '0 auto 20px',
          borderRadius: '50%',
          background: t.warningBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={t.warning} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          color: t.text,
          margin: '0 0 12px',
        }}>
          Chat is down for scheduled maintenance
        </h1>

        <p style={{
          fontSize: 14.5,
          lineHeight: 1.6,
          color: t.textSecondary,
          margin: '0 0 28px',
        }}>
          We're making some improvements to the AI chat. It'll be back online soon.
          In the meantime, you can still create and manage projects from the dashboard.
        </p>

        <Link
          to="/dashboard"
          style={{
            display: 'inline-block',
            padding: '10px 22px',
            background: t.accent,
            color: '#fff',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
