import React from 'react';
import { Zap, Check, MessageCircle, Phone, Mail, ArrowRight, Star, Shield, Clock, FileText, TrendingUp } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════════
// PRICING PAGE — src/pages/PricingPage.js
// Shown when clients run out of free credits
// ═══════════════════════════════════════════════════════════════════════════════

const WHATSAPP_NUMBER = '447534808399'; // UPDATE THIS

const plans = [
  {
    name: 'Pay Per Project',
    price: 'From £149',
    period: 'per project',
    description: 'Perfect for one-off jobs or occasional use.',
    features: [
      'Full AI-powered BOQ generation',
      'UK Building Regs compliant',
      'PDF & Excel download',
      'Email support',
      '48hr turnaround',
    ],
    cta: 'Get Started',
    accent: '#2563EB',
    popular: false,
  },
  {
    name: 'Monthly Retainer',
    price: '£499',
    period: 'per month',
    description: 'For contractors with regular project flow.',
    features: [
      'Up to 5 projects per month',
      'Priority 24hr turnaround',
      'WhatsApp direct line',
      'Client-specific rate libraries',
      'Revision requests included',
      'Dedicated QS support',
    ],
    cta: 'Chat to Us',
    accent: '#8B5CF6',
    popular: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: 'tailored to you',
    description: 'For firms with high-volume or specialist needs.',
    features: [
      'Unlimited projects',
      'Same-day turnaround',
      'API integration available',
      'Custom rate libraries',
      'Dedicated account manager',
      'White-label options',
    ],
    cta: 'Contact Us',
    accent: '#D4A853',
    popular: false,
  },
];

export default function PricingPage({ theme }) {
  const isDark = theme?.bg === '#06080F' || (theme?.bg && theme?.bg.includes('0'));

  const openWhatsApp = (plan) => {
    const msg = encodeURIComponent(`Hi, I'm interested in the ${plan} plan for CRM Wizard AI. Can we discuss?`);
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`, '_blank');
  };

  return (
    <div style={{ padding: '40px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', borderRadius: 20,
          background: 'rgba(37,99,235,0.1)',
          border: '1px solid rgba(37,99,235,0.2)',
          marginBottom: 16,
        }}>
          <Zap size={14} style={{ color: '#2563EB' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#2563EB' }}>Upgrade Your Access</span>
        </div>

        <h1 style={{
          margin: '0 0 12px', fontSize: 34, fontWeight: 800,
          color: isDark ? '#E8EDF5' : '#0F172A',
          letterSpacing: '-0.03em',
        }}>
          Ready to scale your estimating?
        </h1>
        <p style={{
          margin: 0, fontSize: 16, color: isDark ? '#5A6E87' : '#94A3B8',
          maxWidth: 520, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6,
        }}>
          You've used your free project credit. Choose a plan to keep getting AI-powered BOQs delivered fast and accurately.
        </p>
      </div>

      {/* Plans Grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 20, marginBottom: 48,
      }}>
        {plans.map((plan, i) => (
          <div
            key={i}
            style={{
              background: isDark ? '#131B2E' : '#FFFFFF',
              border: `${plan.popular ? '2' : '1'}px solid ${plan.popular ? plan.accent : (isDark ? '#1C2A44' : '#E2E8F0')}`,
              borderRadius: 18, padding: 28, position: 'relative',
              boxShadow: plan.popular ? `0 8px 32px ${plan.accent}20` : 'none',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            {plan.popular && (
              <div style={{
                position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                padding: '4px 14px', borderRadius: 10,
                background: plan.accent, color: '#FFF',
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Star size={10} fill="#FFF" /> Most Popular
              </div>
            )}

            <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: isDark ? '#E8EDF5' : '#0F172A' }}>
              {plan.name}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: isDark ? '#5A6E87' : '#94A3B8' }}>
              {plan.description}
            </p>

            <div style={{ marginBottom: 20 }}>
              <span style={{ fontSize: 32, fontWeight: 800, color: plan.accent }}>{plan.price}</span>
              <span style={{ fontSize: 14, color: isDark ? '#5A6E87' : '#94A3B8', marginLeft: 6 }}>/{plan.period}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
              {plan.features.map((feature, j) => (
                <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <Check size={16} style={{ color: plan.accent, flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 14, color: isDark ? '#94A3B8' : '#475569', lineHeight: 1.4 }}>{feature}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => openWhatsApp(plan.name)}
              style={{
                width: '100%', padding: '13px', borderRadius: 12, border: 'none',
                background: plan.popular ? plan.accent : (isDark ? '#1C2A44' : '#F1F5F9'),
                color: plan.popular ? '#FFF' : (isDark ? '#E8EDF5' : '#0F172A'),
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'all 0.2s',
                boxShadow: plan.popular ? `0 4px 12px ${plan.accent}40` : 'none',
              }}
            >
              <MessageCircle size={16} /> {plan.cta} on WhatsApp
            </button>
          </div>
        ))}
      </div>

      {/* Trust signals */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16, marginBottom: 40,
      }}>
        {[
          { icon: Shield, label: 'UK Building Regs Compliant', sub: 'Part A through Part S' },
          { icon: Clock, label: 'Fast Turnaround', sub: 'Most BOQs in 24-48hrs' },
          { icon: TrendingUp, label: 'Proven Accuracy', sub: 'AI + human QS review' },
          { icon: FileText, label: 'Professional Output', sub: 'Excel, PDF, branded BOQs' },
        ].map(({ icon: Icon, label, sub }, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 18px', borderRadius: 12,
            background: isDark ? 'rgba(37,99,235,0.04)' : '#F8FAFC',
            border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
          }}>
            <Icon size={20} style={{ color: '#2563EB', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: isDark ? '#E8EDF5' : '#0F172A' }}>{label}</div>
              <div style={{ fontSize: 11, color: isDark ? '#5A6E87' : '#94A3B8' }}>{sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom CTA */}
      <div style={{
        textAlign: 'center', padding: '32px',
        background: isDark ? 'rgba(37,99,235,0.06)' : 'rgba(37,99,235,0.04)',
        border: `1px solid ${isDark ? 'rgba(37,99,235,0.15)' : 'rgba(37,99,235,0.1)'}`,
        borderRadius: 16,
      }}>
        <p style={{ margin: '0 0 16px', fontSize: 16, color: isDark ? '#94A3B8' : '#475569' }}>
          Not sure which plan is right? Let's have a quick chat.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => openWhatsApp('plans')}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 24px', borderRadius: 10, border: 'none',
              background: '#25D366', color: '#FFF', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <MessageCircle size={16} /> WhatsApp Us
          </button>
          <a href="mailto:hello@crmwizardai.com" style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 24px', borderRadius: 10, textDecoration: 'none',
            border: `1px solid ${isDark ? '#1C2A44' : '#E2E8F0'}`,
            color: isDark ? '#E8EDF5' : '#0F172A', fontSize: 14, fontWeight: 600,
          }}>
            <Mail size={16} /> Email Us
          </a>
        </div>
      </div>
    </div>
  );
}
