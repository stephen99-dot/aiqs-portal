import React, { useState, useEffect } from 'react';
import { Zap, Gift, ArrowRight, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// ═══════════════════════════════════════════════════════════════════════════════
// CREDIT BANNER — src/components/CreditBanner.js
// Shows remaining free credits at top of dashboard
// ═══════════════════════════════════════════════════════════════════════════════

const API_BASE = '/api';

export default function CreditBanner({ theme }) {
  const [credits, setCredits] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  const isDark = theme?.bg === '#06080F' || (theme?.bg && theme?.bg.includes('0'));

  useEffect(() => {
    const token = localStorage.getItem('aiqs_token');
    if (!token) return;

    fetch(`${API_BASE}/credits`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => setCredits(data))
      .catch(() => {});
  }, []);

  // Don't show for admins or if dismissed
  if (!credits || credits.is_admin || dismissed) return null;

  // Has credits — show green banner
  if (credits.free_credits > 0) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 18px', marginBottom: 20, borderRadius: 12,
        background: isDark ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)',
        border: '1px solid rgba(16,185,129,0.2)',
      }}>
        <Gift size={18} style={{ color: '#10B981', flexShrink: 0 }} />
        <p style={{ margin: 0, fontSize: 14, color: isDark ? '#6EE7B7' : '#059669', flex: 1 }}>
          <strong>You have {credits.free_credits} free project{credits.free_credits !== 1 ? 's' : ''} remaining!</strong> Upload your drawings to get started.
        </p>
        <button onClick={() => setDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#3B4D66' : '#94A3B8', padding: 2 }}>
          <X size={14} />
        </button>
      </div>
    );
  }

  // No credits — show upgrade banner
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 18px', marginBottom: 20, borderRadius: 12,
      background: isDark ? 'linear-gradient(135deg, rgba(37,99,235,0.1), rgba(139,92,246,0.08))' : 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(139,92,246,0.04))',
      border: `1px solid ${isDark ? 'rgba(37,99,235,0.2)' : 'rgba(37,99,235,0.15)'}`,
    }}>
      <Zap size={18} style={{ color: '#2563EB', flexShrink: 0 }} />
      <p style={{ margin: 0, fontSize: 14, color: isDark ? '#94A3B8' : '#475569', flex: 1 }}>
        You've used your free project. <strong style={{ color: isDark ? '#E8EDF5' : '#0F172A' }}>Upgrade to keep getting AI-powered BOQs.</strong>
      </p>
      <button
        onClick={() => navigate('/pricing')}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 16px', borderRadius: 8, border: 'none',
          background: '#2563EB', color: '#FFF',
          fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        View Plans <ArrowRight size={14} />
      </button>
      <button onClick={() => setDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#3B4D66' : '#94A3B8', padding: 2 }}>
        <X size={14} />
      </button>
    </div>
  );
}
