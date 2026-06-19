import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import {
  ZapIcon, RulerIcon, BuildingIcon, TrendingUpIcon, CreditCardIcon,
  FileTextIcon, LayersIcon, CheckCircleIcon, ArrowRightIcon, ClockIcon,
} from '../components/Icons';
import OfficeBoxArt from '../components/OfficeBoxArt';
import { OFFICE_PAYMENT_LINK, withUserRef } from '../utils/stripeLinks';

// Amber accent — matches the "Office in a Box" branding in the sidebar,
// rather than the portal's default blue accent.
const AMBER = '#F59E0B';
const AMBER_DIM = '#D97706';

const FEATURES = [
  { Icon: RulerIcon,      title: 'Speak a job, get a quote', blurb: "Describe the job like you'd tell your mate — out loud if you like. A priced, branded quote comes back in seconds, built on your own rates." },
  { Icon: CreditCardIcon, title: 'Get paid without chasing', blurb: 'Clients accept quotes and pay invoices on their phone. Polite reminders go out by themselves — due date, a week late, two weeks late.' },
  { Icon: TrendingUpIcon, title: 'CIS & VAT done right',     blurb: 'CIS deductions split labour from materials automatically, reverse-charge invoices carry the exact HMRC wording, and your accountant gets Xero/QuickBooks files in one tap.' },
  { Icon: BuildingIcon,   title: 'Every job in one place',   blurb: 'The quote, invoices, payments, changes, photos and paperwork for each job on one screen — with one-tap call and WhatsApp for the customer.' },
  { Icon: FileTextIcon,   title: 'Paperwork that writes itself', blurb: 'Contracts, terms and letters stamped with your logo. Need an awkward letter? Say what for, read the draft, send it.' },
  { Icon: LayersIcon,     title: 'Photos & site tools',      blurb: "Snap the rot before it's covered up and pin the photo to the change you price. Trade calculators and live materials prices included." },
];

const BENEFITS = [
  'Send a quote by WhatsApp — your client accepts it on their phone',
  'Automatic payment reminders and one-tap chasers, politely persistent',
  'CIS, reverse-charge VAT and retention handled on every invoice',
  'Branded to your company on every quote, invoice and letter',
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
  const isInterested = status === 'interested';

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

  // Send the user to Stripe for the £100/month subscription. The link is
  // stamped with their account id so the webhook flips on access the moment
  // they pay and lands them back on the success page.
  function startCheckout() {
    window.location.href = withUserRef(OFFICE_PAYMENT_LINK, user);
  }

  const cardBg = t.card;
  const softAmberBg = isDark ? 'rgba(245,158,11,0.07)' : 'rgba(245,158,11,0.06)';
  const amberBorder = isDark ? 'rgba(245,158,11,0.3)' : 'rgba(245,158,11,0.35)';
  const heroBg = isDark
    ? 'radial-gradient(90% 120% at 85% 0%, rgba(245,158,11,0.22) 0%, rgba(245,158,11,0.05) 45%, transparent 75%), #0E1626'
    : 'radial-gradient(90% 120% at 85% 0%, rgba(245,158,11,0.20) 0%, rgba(245,158,11,0.06) 45%, transparent 75%), #FFFFFF';

  const ctaLabel = submitting ? 'Saving…' : "Yes — I'm interested";

  return (
    <div style={{ padding: 24, color: t.text, maxWidth: 1060, margin: '0 auto' }}>
      <style>{`
        @keyframes oiab-cta-glow {
          0%,100% { box-shadow: 0 8px 22px rgba(245,158,11,0.35), 0 0 0 0 rgba(245,158,11,0.30); }
          50%     { box-shadow: 0 10px 30px rgba(245,158,11,0.50), 0 0 0 8px rgba(245,158,11,0); }
        }
        @keyframes oiab-sheen { 0% { transform: translateX(-60%); } 100% { transform: translateX(160%); } }
        .oiab-cta { animation: oiab-cta-glow 2.2s ease-in-out infinite; transition: transform .12s ease; }
        .oiab-cta:hover { transform: translateY(-2px); }
        .oiab-feat { transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease; }
        .oiab-feat:hover { transform: translateY(-3px); box-shadow: 0 10px 26px rgba(0,0,0,0.12); }
        @media (prefers-reduced-motion: reduce) { .oiab-cta { animation: none; } }
        @media (max-width: 880px) {
          .oiab-hero { grid-template-columns: 1fr !important; text-align: center; }
          .oiab-hero-art { order: -1; margin: 0 auto; }
          .oiab-hero-cta-row { justify-content: center; }
          .oiab-price-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {hasAddon && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '12px 16px', borderRadius: 12, marginBottom: 20,
          background: t.successBg, border: `1px solid ${t.success}`,
        }}>
          <span style={{ fontSize: 13.5, color: t.text, fontWeight: 500 }}>
            You already have Office in a Box on your account.
          </span>
          <button onClick={() => navigate('/office')} style={{
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
        borderRadius: 24, padding: '36px 34px',
        background: heroBg, border: `1px solid ${amberBorder}`,
        marginBottom: 26,
      }}>
        {/* moving sheen */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: '40%',
          background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.10), transparent)',
          animation: 'oiab-sheen 6s ease-in-out infinite', pointerEvents: 'none',
        }} />
        <div className="oiab-hero" style={{
          position: 'relative',
          display: 'grid', gridTemplateColumns: '1.25fr 0.75fr', gap: 24, alignItems: 'center',
        }}>
          <div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: AMBER_DIM, background: 'rgba(245,158,11,0.14)',
              border: `1px solid ${amberBorder}`, borderRadius: 999, padding: '5px 13px',
              marginBottom: 18,
            }}>
              <ClockIcon size={13} color={AMBER_DIM} /> Now live · 7-day free trial
            </span>
            <h1 style={{ margin: '0 0 14px', fontSize: 40, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.05 }}>
              Your whole office,{' '}
              <span style={{
                background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
                WebkitBackgroundClip: 'text', backgroundClip: 'text',
                WebkitTextFillColor: 'transparent', color: AMBER,
              }}>in one tab.</span>
            </h1>
            <p style={{ margin: '0 0 22px', fontSize: 16.5, lineHeight: 1.55, color: t.textSecondary, maxWidth: 540 }}>
              Say the job out loud and a priced quote comes back. Send it by WhatsApp,
              watch it get accepted, invoiced and paid — CIS and VAT handled. Built for
              the van, not the desk.
            </p>
            <div className="oiab-hero-cta-row" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
              {/* Primary action: subscribers open their tools; everyone else
                  is sent to Stripe to subscribe for £100/month. */}
              {hasAddon ? (
                <button
                  className="oiab-cta"
                  onClick={() => navigate('/office')}
                  style={{
                    padding: '14px 26px', borderRadius: 13, border: 'none',
                    background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
                    color: '#0A0F1C', fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em',
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9,
                  }}
                >
                  Open Office in a Box <ArrowRightIcon size={18} color="#0A0F1C" />
                </button>
              ) : (
                <button
                  className="oiab-cta"
                  onClick={startCheckout}
                  style={{
                    padding: '14px 26px', borderRadius: 13, border: 'none',
                    background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
                    color: '#0A0F1C', fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em',
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9,
                  }}
                >
                  Start 7-day free trial <ArrowRightIcon size={18} color="#0A0F1C" />
                </button>
              )}
              {hasAddon ? null : isInterested ? (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  fontSize: 15, fontWeight: 700, color: t.success,
                  background: t.successBg, border: `1px solid ${t.success}`,
                  borderRadius: 12, padding: '12px 18px',
                }}>
                  <CheckCircleIcon size={18} color={t.success} /> You're on the list — we'll be in touch
                </span>
              ) : (
                <>
                  <button
                    className="oiab-cta"
                    onClick={registerInterest}
                    disabled={submitting}
                    style={{
                      padding: '14px 26px', borderRadius: 13, border: `1.5px solid ${amberBorder}`,
                      background: 'transparent',
                      color: t.text, fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em',
                      cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.75 : 1,
                      display: 'inline-flex', alignItems: 'center', gap: 9,
                    }}
                  >
                    {ctaLabel} {!submitting && <ArrowRightIcon size={18} color={t.text} />}
                  </button>
                  <span style={{ fontSize: 13, color: t.textMuted, maxWidth: 230, lineHeight: 1.4 }}>
                    One tap — we already know it's you. No forms, no card.
                  </span>
                </>
              )}
              <button
                onClick={() => navigate('/office-demo')}
                style={{
                  padding: '13px 22px', borderRadius: 13,
                  border: `1.5px solid ${amberBorder}`, background: 'transparent',
                  color: t.text, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Try it with example data
              </button>
            </div>
            {error && <div style={{ fontSize: 12.5, color: t.danger, marginTop: 10 }}>{error}</div>}
          </div>

          <div className="oiab-hero-art">
            <OfficeBoxArt size={260} style={{ display: 'block', margin: '0 auto' }} />
          </div>
        </div>
      </div>

      {/* ── Features + price ── */}
      <div className="oiab-price-grid" style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
        gap: 16, marginBottom: 28,
      }}>
        {/* Features grid */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12,
          alignContent: 'start',
        }}>
          {FEATURES.map(f => (
            <div key={f.title} className="oiab-feat" style={{
              background: cardBg, border: `1px solid ${t.border}`, borderRadius: 16,
              padding: 17,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 11, marginBottom: 11,
                background: `linear-gradient(135deg, rgba(245,158,11,0.18), rgba(217,119,6,0.12))`,
                border: `1px solid ${amberBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <f.Icon size={19} color={AMBER} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5 }}>{f.title}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: t.textSecondary }}>{f.blurb}</div>
            </div>
          ))}
        </div>

        {/* Price card */}
        <div style={{
          background: cardBg, border: `1px solid ${amberBorder}`, borderRadius: 18,
          padding: 24, alignSelf: 'start', position: 'sticky', top: 16,
          boxShadow: isDark ? '0 12px 36px rgba(0,0,0,0.3)' : '0 12px 36px rgba(245,158,11,0.10)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(245,158,11,0.3)',
            }}>
              <ZapIcon size={18} color="#0A0F1C" />
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Office in a Box</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 46, fontWeight: 800, letterSpacing: '-0.03em', color: t.text }}>£100</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: t.textSecondary }}>/ month</span>
          </div>
          <div style={{ fontSize: 12.5, color: t.textSecondary, marginBottom: 18 }}>
            7 days free, then one flat price for everything. Added to your existing AI QS account — cancel anytime.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {BENEFITS.map(b => (
              <div key={b} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <CheckCircleIcon size={16} color={t.success} />
                <span style={{ fontSize: 12.5, lineHeight: 1.45, color: t.textSecondary }}>{b}</span>
              </div>
            ))}
          </div>

          {hasAddon ? (
            <button
              className="oiab-cta"
              onClick={() => navigate('/office')}
              style={{
                width: '100%', padding: '14px 18px', borderRadius: 12, border: 'none',
                background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
                color: '#0A0F1C', fontSize: 15.5, fontWeight: 800, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              Open Office in a Box <ArrowRightIcon size={17} color="#0A0F1C" />
            </button>
          ) : (
            <>
              <button
                className="oiab-cta"
                onClick={startCheckout}
                style={{
                  width: '100%', padding: '14px 18px', borderRadius: 12, border: 'none',
                  background: `linear-gradient(135deg, ${AMBER}, ${AMBER_DIM})`,
                  color: '#0A0F1C', fontSize: 15.5, fontWeight: 800, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                Start 7-day free trial <ArrowRightIcon size={17} color="#0A0F1C" />
              </button>
              <div style={{ fontSize: 11.5, color: t.textMuted, textAlign: 'center', marginTop: 10, lineHeight: 1.4 }}>
                7 days free, then £100/month. No charge today — cancel anytime before your trial ends.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
