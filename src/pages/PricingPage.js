import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { withUserRef } from '../utils/stripeLinks';
import { StarIcon, ChatIcon, MailIcon } from '../components/Icons';

// ═══════════════════════════════════════════════════════════════════════════════
// PRICING PAGE — src/pages/PricingPage.js
// Matches theaiqs.co.uk pricing exactly: pay-as-you-go single BOQ, or save with
// a 5- or 10-BOQ bundle. No subscriptions.
// ═══════════════════════════════════════════════════════════════════════════════

const WHATSAPP_NUMBER = '447534808399';

const CheckIcon = ({ color }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const plans = [
  {
    name: 'Single BOQ',
    subtitle: 'Pay As You Go',
    price: '£150',
    period: 'per BOQ',
    description: 'Perfect for one-off jobs. Only pay when your documents are ready.',
    features: [
      'Full Excel Bill of Quantities',
      'Word Findings Report',
      'Current UK & Ireland market rates',
      'Location-adjusted pricing',
      '1 revision included',
      'No subscription — pay per job',
    ],
    cta: 'Get Your BOQ',
    stripeLink: 'https://buy.stripe.com/fZu3cvebKenS2go4XW73G0g',
    popular: false,
  },
  {
    name: '5 BOQ Bundle',
    subtitle: 'Bundle',
    price: '£349',
    period: 'per 5 BOQs',
    note: 'Just £69.80 per BOQ — save £401',
    description: 'For builders and contractors pricing jobs regularly. Five BOQs, one simple price.',
    features: [
      '5 × Excel BOQ + Word Findings Report',
      'Current UK & Ireland market rates',
      'Location-adjusted pricing',
      '1 revision per document',
      'Credits never expire',
      'Priority support',
    ],
    cta: 'Get the Bundle',
    stripeLink: 'https://buy.stripe.com/00w7sLgjSenSdZ6aig73G0h',
    badge: 'Most Popular',
    popular: true,
  },
  {
    name: '10 BOQ Bundle',
    subtitle: 'Bundle',
    price: '£580',
    period: 'per 10 BOQs',
    note: 'Just £58 per BOQ — save £920',
    description: 'Our best per-BOQ rate. For busy builders and QS firms pricing jobs week in, week out.',
    features: [
      '10 × Excel BOQ + Word Findings Report',
      'Current UK & Ireland market rates',
      'Location-adjusted pricing',
      '1 revision per document',
      'Credits never expire',
      'Priority support',
    ],
    cta: 'Get the Bundle',
    stripeLink: 'https://buy.stripe.com/9B628raZy2Fa4ow62073G0f',
    badge: 'Best Value',
    popular: false,
  },
];

export default function PricingPage() {
  const { t, mode } = useTheme();
  const { user } = useAuth();
  const isDark = mode === 'dark';

  const openWhatsApp = (plan) => {
    const msg = encodeURIComponent(`Hi, I'm interested in the ${plan} plan for AI QS. Can we discuss?`);
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, '_blank');
  };

  const handleCTA = (plan) => {
    if (plan.stripeLink) {
      // Stamp the logged-in account onto the checkout so the payment reliably
      // credits the right portal user.
      window.open(withUserRef(plan.stripeLink, user), '_blank');
    } else {
      openWhatsApp(plan.name);
    }
  };

  return (
    <div style={{ padding: '40px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', borderRadius: 20,
          background: isDark ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.06)',
          border: `1px solid ${isDark ? 'rgba(245,158,11,0.2)' : 'rgba(245,158,11,0.15)'}`,
          marginBottom: 16,
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#F59E0B' }}>Simple, Transparent Pricing</span>
        </div>

        <h1 style={{
          margin: '0 0 12px', fontSize: 32, fontWeight: 800,
          color: t.text,
          letterSpacing: '-0.03em',
        }}>
          No hidden fees. No surprise charges.
        </h1>
        <p style={{
          margin: 0, fontSize: 16, color: t.textSecondary,
          maxWidth: 520, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6,
        }}>
          Pay as you go, or save with a bundle — the more you buy, the less each BOQ costs. No subscriptions, no lock-in. Every BOQ includes a professional Excel bill and a Word findings report.
        </p>
      </div>

      {/* Plans Grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 18, marginBottom: 48,
      }}>
        {plans.map((plan, i) => (
          <div
            key={i}
            style={{
              background: isDark ? t.card : '#FFFFFF',
              border: `${plan.popular ? '2' : '1'}px solid ${plan.popular ? '#F59E0B' : t.border}`,
              borderRadius: 16, padding: 24, position: 'relative',
              boxShadow: plan.popular ? '0 8px 32px rgba(245,158,11,0.12)' : t.shadowSm,
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            {plan.badge && (
              <div style={{
                position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                padding: '4px 14px', borderRadius: 10,
                background: plan.popular ? '#F59E0B' : '#7C3AED',
                color: plan.popular ? '#0A0F1C' : '#FFFFFF',
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                whiteSpace: 'nowrap',
              }}>
                <StarIcon size={14} style={{ verticalAlign: 'middle' }} /> {plan.badge}
              </div>
            )}

            <div style={{ fontSize: 11, fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {plan.subtitle}
            </div>
            <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: t.text }}>
              {plan.name}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: t.textSecondary, lineHeight: 1.5 }}>
              {plan.description}
            </p>

            <div style={{ marginBottom: plan.note ? 6 : 20 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: '#F59E0B' }}>{plan.price}</span>
              <span style={{ fontSize: 13, color: t.textMuted, marginLeft: 6 }}>/{plan.period}</span>
            </div>
            {plan.note && (
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#F59E0B', marginBottom: 16 }}>
                {plan.note}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {plan.features.map((feature, j) => (
                <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <CheckIcon color={plan.popular ? '#F59E0B' : t.success} />
                  <span style={{ fontSize: 13, color: t.textSecondary, lineHeight: 1.4 }}>{feature}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => handleCTA(plan)}
              style={{
                width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                background: plan.popular ? '#F59E0B' : (isDark ? t.surfaceHover : '#F1F5F9'),
                color: plan.popular ? '#0A0F1C' : t.text,
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: plan.popular ? '0 4px 12px rgba(245,158,11,0.3)' : 'none',
              }}
            >
              {plan.cta} →
            </button>
          </div>
        ))}
      </div>

      {/* Bottom CTA */}
      <div style={{
        textAlign: 'center', padding: '28px',
        background: isDark ? 'rgba(245,158,11,0.04)' : 'rgba(245,158,11,0.03)',
        border: `1px solid ${isDark ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.08)'}`,
        borderRadius: 14,
      }}>
        <p style={{ margin: '0 0 14px', fontSize: 15, color: t.textSecondary }}>
          Not sure which plan is right? Let's have a quick chat.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => openWhatsApp('plans')}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '11px 22px', borderRadius: 10, border: 'none',
              background: '#25D366', color: '#FFF', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <ChatIcon size={16} /> WhatsApp Us
          </button>
          <a href="mailto:hello@crmwizardai.com" style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '11px 22px', borderRadius: 10, textDecoration: 'none',
            border: `1px solid ${t.border}`,
            color: t.text, fontSize: 14, fontWeight: 600,
          }}>
            <MailIcon size={16} /> Email Us
          </a>
        </div>
      </div>
    </div>
  );
}
