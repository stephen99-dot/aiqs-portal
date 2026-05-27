import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import {
  ZapIcon, RulerIcon, BuildingIcon, TrendingUpIcon, CreditCardIcon,
  FileTextIcon, LayersIcon, CheckCircleIcon, ArrowRightIcon, ClockIcon,
} from '../components/Icons';

// Amber accent — matches the "Office in a Box" branding in the sidebar,
// rather than the portal's default blue accent.
const AMBER = '#F59E0B';
const AMBER_DIM = '#D97706';

const FEATURES = [
  { Icon: RulerIcon,      title: 'Quotes & Estimates', blurb: 'Turn a priced BOQ into a polished, branded client quote in minutes — win more work with proposals that look the part.' },
  { Icon: BuildingIcon,   title: 'Project Manager',    blurb: 'Track every job from first enquiry to final account. Tasks, milestones and live status, all in one view.' },
  { Icon: TrendingUpIcon, title: 'Finance & Cashflow', blurb: "See what's owed, what's overdue and what's coming in. Job-level profit and overhead tracking that actually adds up." },
  { Icon: CreditCardIcon, title: 'Invoices & Payments',blurb: 'Raise invoices and payment schedules against each job. Clear, branded bills that get you paid faster.' },
  { Icon: FileTextIcon,   title: 'Documents',          blurb: 'Generate contracts, letters and certificates from templates — stamped with your logo and brand colours.' },
  { Icon: LayersIcon,     title: 'Trade Calculators',  blurb: 'Brick, block, concrete, plaster, roof and paint quantities — quick maths without leaving the portal.' },
];

const BENEFITS = [
  'Everything in one login — no more juggling spreadsheets and apps',
  'Branded to your company on every quote, invoice and document',
  'Built on the same AI QS pricing that produces your BOQs',
  'No setup, no migration — it just appears in your portal',
];

export default function OfficeInABoxPage() {
  const { t, mode } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isDark = mode === 'dark';

  const [status, setStatus] = useState(null);   // null | 'interested' | 'not_now'
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const hasAddon = !!user?.hasEstimator || user?.role === 'admin';

  useEffect(() => {
    let alive = true;
    apiFetch('/office-in-a-box/interest')
      .then(d => { if (alive && d.responded) setStatus(d.status); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  async function registerInterest() {
    setSubmitting(true);
    setError('');
    try {
      await apiFetch('/office-in-a-box/interest', {
        method: 'POST',
        body: JSON.stringify({ status: 'interested', source: 'page' }),
      });
      setStatus('interested');
      try { localStorage.setItem('aiqs_office_interest_v1', 'interested'); } catch (e) {}
    } catch (err) {
      setError(err.message || 'Could not register interest — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const cardBg = t.card;
  const softAmberBg = isDark ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.07)';
  const amberBorder = isDark ? 'rgba(245,158,11,0.3)' : 'rgba(245,158,11,0.35)';

  return (
    <div style={{ padding: 24, color: t.text, maxWidth: 1040, margin: '0 auto' }}>

      {hasAddon && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '12px 16px', borderRadius: 12, marginBottom: 20,
          background: t.successBg, border: `1px solid ${t.success}`,
        }}>
          <span style={{ fontSize: 13.5, color: t.text, fontWeight: 500 }}>
            You already have Office in a Box on your account.
          </span>
          <button onClick={() => navigate('/pm')} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: t.success, color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            Open your tools <ArrowRightIcon size={14} color="#fff" />
          </button>
        </div>
      )}

      {/* ── Hero ── */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: 20, padding: '40px 32px',
        background: softAmberBg, border: `1px solid ${amberBorder}`,
        marginBottom: 24,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: AMBER_DIM, background: 'rgba(245,158,11,0.14)',
          border: `1px solid ${amberBorder}`, borderRadius: 999, padding: '4px 12px',
          marginBottom: 16,
        }}>
          <ClockIcon size={13} color={AMBER_DIM} /> Coming soon
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, flexShrink: 0,
            background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(245,158,11,0.3)',
          }}>
            <ZapIcon size={24} color="#0A0F1C" />
          </div>
          <h1 style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em' }}>
            Office in a Box
          </h1>
        </div>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: t.textSecondary, maxWidth: 680 }}>
          Your entire building back-office, run from one place. Stop stitching together
          spreadsheets, Word templates and accounting apps — quoting, project management,
          invoicing, cashflow and documents all live inside your AI QS portal, powered by
          the same pricing intelligence that builds your BOQs.
        </p>
      </div>

      {/* ── Price + CTA ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
        gap: 16, marginBottom: 28,
      }} className="oiab-price-grid">
        {/* Features grid */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12,
        }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{
              background: cardBg, border: `1px solid ${t.border}`, borderRadius: 14,
              padding: 16,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 9, marginBottom: 10,
                background: softAmberBg, border: `1px solid ${amberBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <f.Icon size={18} color={AMBER} />
              </div>
              <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 5 }}>{f.title}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: t.textSecondary }}>{f.blurb}</div>
            </div>
          ))}
        </div>

        {/* Price card */}
        <div style={{
          background: cardBg, border: `1px solid ${amberBorder}`, borderRadius: 16,
          padding: 24, alignSelf: 'start', position: 'sticky', top: 16,
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Add-on price
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '6px 0 4px' }}>
            <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-0.03em', color: t.text }}>£50</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: t.textSecondary }}>/ month</span>
          </div>
          <div style={{ fontSize: 12.5, color: t.textSecondary, marginBottom: 18 }}>
            One flat price for everything below. Added to your existing AI QS account — cancel anytime.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 20 }}>
            {BENEFITS.map(b => (
              <div key={b} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <CheckCircleIcon size={16} color={t.success} />
                <span style={{ fontSize: 12.5, lineHeight: 1.45, color: t.textSecondary }}>{b}</span>
              </div>
            ))}
          </div>

          {status === 'interested' ? (
            <div style={{
              background: t.successBg, border: `1px solid ${t.success}`, borderRadius: 12,
              padding: '14px 16px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 4 }}>
                You're on the list 🎉
              </div>
              <div style={{ fontSize: 12.5, color: t.textSecondary, lineHeight: 1.45 }}>
                We've noted your interest and we'll email you the moment Office in a Box goes live.
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={registerInterest}
                disabled={submitting}
                style={{
                  width: '100%', padding: '13px 18px', borderRadius: 11, border: 'none',
                  background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
                  color: '#0A0F1C', fontSize: 14.5, fontWeight: 700, cursor: submitting ? 'wait' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: '0 4px 16px rgba(245,158,11,0.25)',
                }}
              >
                {submitting ? 'Saving…' : "I'm interested"}
                {!submitting && <ArrowRightIcon size={16} color="#0A0F1C" />}
              </button>
              <div style={{ fontSize: 11.5, color: t.textMuted, textAlign: 'center', marginTop: 10, lineHeight: 1.4 }}>
                You're logged in, so one tap is all it takes — we'll know it's you and get in touch with founder pricing.
              </div>
              {error && (
                <div style={{ fontSize: 12, color: t.danger, textAlign: 'center', marginTop: 8 }}>{error}</div>
              )}
            </>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .oiab-price-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
