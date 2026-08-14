import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import {
  ZapIcon, RulerIcon, TrendingUpIcon, FileTextIcon, CalendarIcon,
  ClientsIcon, PipelineIcon, PackageIcon, ClockIcon, BarChartIcon,
  FilePenIcon, FolderIcon, ChatIcon, CheckIcon, CheckCircleIcon,
  ArrowRightIcon, ExternalLinkIcon,
} from '../components/Icons';

// AI Trades Pilot brand blue — deliberately distinct from the amber the old
// Office-in-a-Box upsell used, and matching aitradespilot.com.
const BLUE = '#0071F3';
const BLUE_DIM = '#0059CE';

const SITE_URL = 'https://www.aitradespilot.com';
const REGISTER_URL = 'https://app.aitradespilot.com/register';
const DEMO_URL = 'https://calendly.com/hello-crmwizardai/30min';

// The full platform, as sold on aitradespilot.com.
const FEATURES = [
  { Icon: FileTextIcon,  title: 'Document generation',      blurb: 'RAMS, contracts, quotes, invoices and POs — AI-drafted in minutes, on your branding.' },
  { Icon: PackageIcon,   title: 'Materials comparison',     blurb: 'Every line on the job priced across merchants, so you always order the best basket.' },
  { Icon: RulerIcon,     title: 'AI quantity surveying',    blurb: 'Upload drawings, get a priced Bill of Quantities back — QS pricing power without the QS bill.' },
  { Icon: TrendingUpIcon, title: 'Live cost tracker',       blurb: 'Planned versus actual on every job, with alerts the moment margin starts to slip.' },
  { Icon: BarChartIcon,  title: 'Cash-flow forecast',       blurb: "See your cash position weeks ahead — every claim, cost and change flows into a live forecast." },
  { Icon: CalendarIcon,  title: 'Programmes & schedules',   blurb: 'A build programme that draws itself from your start date, lookaheads included.' },
  { Icon: FilePenIcon,   title: 'Valuations & variations',  blurb: 'Interim valuations, RFIs and priced variation orders — with a client sign-off trail.' },
  { Icon: ClientsIcon,   title: 'Client CRM',               blurb: 'Every enquiry, quote and job in one pipeline — and AI writes the follow-up emails.' },
  { Icon: PipelineIcon,  title: 'Portal lead generation',   blurb: 'New tenders pulled from job portals straight into your pipeline, ready to price.' },
  { Icon: ClockIcon,     title: 'Material call-offs',       blurb: 'Delivery dates phased to the programme, so stock lands when the trade needs it.' },
  { Icon: FolderIcon,    title: 'Job photos & storage',     blurb: 'Snap progress on site — every plan, quote and photo kept on the job, from 10 GB.' },
  { Icon: ChatIcon,      title: 'Work phone + note-taker',  blurb: 'A business line that records and writes up every call — flagging variations against the job. Optional add-on.' },
];

const JOURNEY = [
  ['Drawings in', 'Upload the plans — PDF, DWG or a photo'],
  ['Priced BOQ', 'Fully priced, same day, at your rates'],
  ['Quote & win', 'Send a branded quote and win the job'],
  ['Programme', 'The build schedule plans itself'],
  ['Materials ordered', 'Call-offs dated to each stage'],
  ['Costs & cash', 'Live actuals vs budget, cash ahead'],
  ['Value & vary', 'Get paid for progress and changes'],
  ['Final account', 'Closed out, start to finish'],
];

// 2026-08 packaging: two packages plus the bundle of both. Prices per
// company, not per seat. Annual = pay 10 months, get 12.
const PLANS = [
  {
    key: 'sales', name: 'Sales & Marketing', monthly: 99, annual: 82,
    audience: 'For getting more of the right jobs in',
    summary: 'Fills your pipeline. Finds the work near you, prices it on the spot and gets your name through the right doors first.',
    jobsPill: { big: 'Win-the-work toolkit', small: 'CRM · planning leads · letters' },
    features: [
      ['CRM & customer list', 'Every enquiry, job and follow-up in one place; AI drafts the emails you hate writing'],
      ['Planning leads, found for you', 'Council registers scanned around your postcode — extensions, lofts, conversions, new builds'],
      ['Price a lead there and then', 'One tap prices it at your rates — an honest indicative range, not a guess'],
      ['Client letter generator', 'Headed intro and follow-up letters written for you, ready to post'],
      ['Tasks & follow-ups', 'Never lose track of who to chase next'],
    ],
  },
  {
    key: 'unlimited', name: 'Unlimited', monthly: 199, annual: 166, popular: true,
    audience: 'The whole platform — no counting',
    summary: 'Runs the whole job. Every set of drawings priced, every document written, every site tracked — unlimited.',
    jobsPill: { big: 'Unlimited AI QS jobs', small: 'priced by the system — same day' },
    features: [
      ['Unlimited AI QS priced jobs', 'Drawings in, priced Bill of Quantities back — same day, at your rates, no per-job fees'],
      ['Contracts, RAMS, quotes & invoices', 'Written for you in minutes, on your letterhead'],
      ['Live cost tracker & variations', 'Catch overspend early and get paid for every change, signed off online'],
      ['Materials comparison & call-offs', 'Every line priced across merchants; ordered on time, at the best basket'],
      ['Programmes, client sign-off & multi-site', 'The build schedule plans itself; every live job on one view'],
      ['Your whole team on site', 'Clock-in with geofence, photo reports, delegated tasks — unlimited staff, 500 GB storage'],
    ],
  },
  {
    key: 'bundle', name: 'Bundle', monthly: 249, annual: 207,
    audience: 'Both packages together — save £49 a month',
    summary: 'Win the work, then run it. Everything in Sales & Marketing and everything in Unlimited, on one subscription.',
    jobsPill: { big: 'Everything', small: 'both packages · unlimited AI QS jobs' },
    features: [
      ['Everything in Sales & Marketing', 'CRM, priced planning leads and the client letter generator'],
      ['Everything in Unlimited', 'Unlimited AI QS jobs, contracts, RAMS, cost tracking, materials and the site tools'],
      ['£49 a month off the pair', 'The two packages together are £298 — the Bundle is £249'],
    ],
  },
];

const GUARANTEES = [
  ['Same day, or it\'s free', 'Drawings in by 10am, priced BOQ back the same working day — or you don\'t pay for it.'],
  ['First BOQ, money back', 'If your first priced job isn\'t worth what you paid, we refund it — and you keep the report.'],
  ['No lock-in on monthly', 'Cancel monthly plans any time — one click, no phone call. Annual is optional, for two months free.'],
  ['Priced at your rates', 'Upload your invoices and every BOQ prices at your numbers, not a national average.'],
];

export default function AiTradesPilotPage() {
  const { t, mode } = useTheme();
  const isDark = mode === 'dark';
  const [cycle, setCycle] = useState('a'); // 'a' annual (default, 2 months free) | 'm' monthly

  const blueBorder = isDark ? 'rgba(0,113,243,0.35)' : 'rgba(0,113,243,0.30)';
  const softBlueBg = isDark ? 'rgba(0,113,243,0.10)' : 'rgba(0,113,243,0.06)';
  const heroBg = isDark
    ? 'radial-gradient(90% 120% at 85% 0%, rgba(0,113,243,0.28) 0%, rgba(0,113,243,0.06) 45%, transparent 75%), #0E1626'
    : 'radial-gradient(90% 120% at 85% 0%, rgba(0,113,243,0.16) 0%, rgba(0,113,243,0.05) 45%, transparent 75%), #FFFFFF';

  const primaryBtn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9,
    padding: '14px 26px', borderRadius: 13, border: 'none',
    background: `linear-gradient(135deg, ${BLUE}, ${BLUE_DIM})`,
    color: '#fff', fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em',
    cursor: 'pointer', textDecoration: 'none',
  };
  const ghostBtn = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '13px 22px', borderRadius: 13,
    border: `1.5px solid ${blueBorder}`, background: 'transparent',
    color: t.text, fontSize: 15, fontWeight: 700, cursor: 'pointer', textDecoration: 'none',
  };

  return (
    <div style={{ padding: 24, color: t.text, maxWidth: 1120, margin: '0 auto' }}>
      <style>{`
        @keyframes atp-cta-glow {
          0%,100% { box-shadow: 0 8px 22px rgba(0,113,243,0.35), 0 0 0 0 rgba(0,113,243,0.30); }
          50%     { box-shadow: 0 10px 30px rgba(0,113,243,0.50), 0 0 0 8px rgba(0,113,243,0); }
        }
        @keyframes atp-sheen { 0% { transform: translateX(-60%); } 100% { transform: translateX(160%); } }
        @keyframes atp-pulse-dot {
          0% { box-shadow: 0 0 0 0 rgba(245,158,11,0.45); } 70% { box-shadow: 0 0 0 8px rgba(245,158,11,0); } 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); }
        }
        .atp-cta { animation: atp-cta-glow 2.2s ease-in-out infinite; transition: transform .12s ease; }
        .atp-cta:hover { transform: translateY(-2px); }
        .atp-feat { transition: transform .14s ease, box-shadow .14s ease; }
        .atp-feat:hover { transform: translateY(-3px); box-shadow: 0 10px 26px rgba(0,0,0,0.12); }
        @media (prefers-reduced-motion: reduce) { .atp-cta { animation: none; } }
        .atp-plan-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14; }
        @media (max-width: 1080px) { .atp-plan-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }
        @media (max-width: 640px)  { .atp-plan-grid { grid-template-columns: 1fr !important; } }
        @media (max-width: 880px) {
          .atp-hero-cta-row { justify-content: center; }
          .atp-hero { text-align: center; }
        }
      `}</style>

      {/* ── Hero ── */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: 24, padding: '38px 34px',
        background: heroBg, border: `1px solid ${blueBorder}`,
        marginBottom: 26,
      }}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: '40%',
          background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.10), transparent)',
          animation: 'atp-sheen 6s ease-in-out infinite', pointerEvents: 'none',
        }} />
        <div className="atp-hero" style={{ position: 'relative', maxWidth: 720 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: isDark ? '#FFD37E' : '#B45309', background: 'rgba(245,158,11,0.14)',
            border: '1px solid rgba(245,158,11,0.45)', borderRadius: 999, padding: '6px 14px',
            marginBottom: 18,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#F59E0B', animation: 'atp-pulse-dot 1.6s ease-out infinite' }} />
            New product — from the team behind your BOQs
          </span>
          <h1 style={{ margin: '0 0 14px', fontSize: 42, fontWeight: 800, letterSpacing: '-0.035em', lineHeight: 1.05 }}>
            The AI{' '}
            <span style={{
              background: `linear-gradient(135deg, ${BLUE}, ${BLUE_DIM})`,
              WebkitBackgroundClip: 'text', backgroundClip: 'text',
              WebkitTextFillColor: 'transparent', color: BLUE,
            }}>Trades Pilot</span>
          </h1>
          <p style={{ margin: '0 0 22px', fontSize: 16.5, lineHeight: 1.55, color: t.textSecondary, maxWidth: 620 }}>
            One platform that prices the job, writes your quotes, RAMS &amp; contracts,
            tracks every pound while you build, and orders the materials. AI QS jobs
            are built into every plan — the same pricing engine behind this portal,
            with a whole back office around it.
          </p>
          <div className="atp-hero-cta-row" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
            <a className="atp-cta" href={REGISTER_URL} target="_blank" rel="noopener noreferrer" style={primaryBtn}>
              Start your 14-day free trial <ArrowRightIcon size={18} color="#fff" />
            </a>
            <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" style={ghostBtn}>
              <CalendarIcon size={16} color={BLUE} /> Book a 30-min demo
            </a>
          </div>
          <div style={{ marginTop: 14, fontSize: 12, letterSpacing: '0.08em', color: t.textMuted, fontWeight: 600 }}>
            14 DAYS FREE · 1 FREE AI QS JOB · CANCEL MONTHLY ANY TIME
          </div>
        </div>
      </div>

      {/* ── Journey ── */}
      <div style={{
        background: t.card, border: `1px solid ${t.border}`, borderRadius: 18,
        padding: '22px 24px', marginBottom: 26,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: BLUE, marginBottom: 4 }}>
          One system, start to finish
        </div>
        <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 16 }}>From drawings to final account</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          {JOURNEY.map(([title, blurb], i) => (
            <div key={title} style={{
              background: softBlueBg, border: `1px solid ${blueBorder}`,
              borderRadius: 12, padding: '12px 13px',
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', marginBottom: 8,
                background: `linear-gradient(135deg, ${BLUE}, ${BLUE_DIM})`, color: '#fff',
                fontSize: 11.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 3 }}>{title}</div>
              <div style={{ fontSize: 11.5, lineHeight: 1.45, color: t.textSecondary }}>{blurb}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Feature grid ── */}
      <div style={{ marginBottom: 30 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: BLUE, marginBottom: 4 }}>
            One platform
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>Everything the back office needs</div>
          <div style={{ fontSize: 14, color: t.textSecondary, marginTop: 6 }}>
            The jobs that used to need a QS, an estimator and an admin — in one place, priced per company.
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          {FEATURES.map(f => (
            <div key={f.title} className="atp-feat" style={{
              background: t.card, border: `1px solid ${t.border}`, borderRadius: 16, padding: 17,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 11, marginBottom: 11,
                background: softBlueBg, border: `1px solid ${blueBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <f.Icon size={19} color={BLUE} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5 }}>{f.title}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: t.textSecondary }}>{f.blurb}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Pricing ── */}
      <div style={{ marginBottom: 30 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: BLUE, marginBottom: 4 }}>
            Pricing
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>One subscription per company</div>
          <div style={{ fontSize: 14, color: t.textSecondary, marginTop: 6, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
            Not per seat — your whole team works from one plan. AI QS jobs are included
            every month, and the higher the tier, the more you get and the less an extra one costs.
          </div>
        </div>

        {/* Billing cycle toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
          {[['a', 'Annual'], ['m', 'Monthly']].map(([key, label]) => (
            <button key={key} onClick={() => setCycle(key)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '9px 18px', borderRadius: 999, cursor: 'pointer',
              border: `1.5px solid ${cycle === key ? BLUE : t.border}`,
              background: cycle === key ? softBlueBg : 'transparent',
              color: cycle === key ? (isDark ? '#7FB2FF' : BLUE_DIM) : t.textSecondary,
              fontSize: 13.5, fontWeight: 700,
            }}>
              {label}
              {key === 'a' && (
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
                  background: `linear-gradient(135deg, ${BLUE}, ${BLUE_DIM})`, color: '#fff',
                  borderRadius: 999, padding: '3px 8px',
                }}>2 MONTHS FREE</span>
              )}
            </button>
          ))}
        </div>

        <div className="atp-plan-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14 }}>
          {PLANS.map(plan => (
            <div key={plan.key} style={{
              position: 'relative', display: 'flex', flexDirection: 'column',
              background: t.card, borderRadius: 18, padding: 20,
              border: plan.popular ? `2px solid ${BLUE}` : `1px solid ${t.border}`,
              boxShadow: plan.popular ? '0 12px 36px rgba(0,113,243,0.18)' : 'none',
            }}>
              {plan.popular && (
                <span style={{
                  position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
                  background: `linear-gradient(135deg, ${BLUE}, ${BLUE_DIM})`, color: '#fff',
                  fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
                  borderRadius: 999, padding: '4px 12px', whiteSpace: 'nowrap',
                }}>Most popular</span>
              )}
              <div style={{ fontSize: 15, fontWeight: 800 }}>{plan.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, margin: '6px 0 2px' }}>
                <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em' }}>
                  £{cycle === 'a' ? plan.annual : plan.monthly}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600, color: t.textSecondary }}>/mo</span>
              </div>
              <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 8 }}>
                {cycle === 'a' ? `Billed annually — pay 10 months, get 12 (£${plan.monthly}/mo monthly)` : 'Billed monthly — cancel any time'}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.textSecondary, marginBottom: 8 }}>{plan.audience}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: t.textSecondary, marginBottom: 12 }}>{plan.summary}</div>
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 2,
                background: softBlueBg, border: `1px solid ${blueBorder}`, borderRadius: 10,
                padding: '9px 12px', marginBottom: 14,
              }}>
                <b style={{ fontSize: 14 }}>{plan.jobsPill.big}</b>
                <span style={{ fontSize: 11.5, color: t.textSecondary }}>{plan.jobsPill.small}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 16, flex: 1 }}>
                {plan.everythingIn && (
                  <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: t.textMuted }}>
                    Everything in {plan.everythingIn}, plus:
                  </div>
                )}
                {plan.features.map(([title, small]) => (
                  <div key={title} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <CheckIcon size={15} color={BLUE} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}>{title}</div>
                      <div style={{ fontSize: 11.5, lineHeight: 1.4, color: t.textMuted }}>{small}</div>
                    </div>
                  </div>
                ))}
              </div>
              <a
                className={plan.popular ? 'atp-cta' : undefined}
                href={`${REGISTER_URL}?plan=${plan.key}`}
                target="_blank" rel="noopener noreferrer"
                style={{
                  ...(plan.popular ? primaryBtn : ghostBtn),
                  width: '100%', padding: '12px 16px', fontSize: 14.5, boxSizing: 'border-box',
                }}
              >
                Start free trial
              </a>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', fontSize: 12.5, color: t.textSecondary, marginTop: 14, lineHeight: 1.5 }}>
          All plans are per company — bring the whole team. Unlimited and the Bundle include{' '}
          <b>unlimited AI QS priced jobs</b>: no quotas, no per-job fees. Pay annually and get two months free.
        </div>

        {/* Work phone add-on */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18,
          background: t.card, border: `1px solid ${t.border}`, borderRadius: 16,
          padding: '18px 22px', marginTop: 18,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: softBlueBg, border: `1px solid ${blueBorder}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ChatIcon size={20} color={BLUE} />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 3 }}>
              Optional add-on
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 4 }}>A proper work phone number</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: t.textSecondary }}>
              A dedicated business line so your mobile stays yours — unlimited UK calls and texts.
              Add the AI note-taker and every call is transcribed, summarised and checked for
              anything that sounds like a variation, filed against the right job.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ border: `1px solid ${t.border}`, borderRadius: 12, padding: '10px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: t.textMuted, fontWeight: 600 }}>Work Phone</div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>£15<span style={{ fontSize: 11, fontWeight: 600, color: t.textSecondary }}>/mo</span></div>
            </div>
            <div style={{ border: `1.5px solid ${BLUE}`, borderRadius: 12, padding: '10px 16px', textAlign: 'center', background: softBlueBg }}>
              <div style={{ fontSize: 11, color: t.textMuted, fontWeight: 600 }}>+ AI Note-Taker</div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>£29<span style={{ fontSize: 11, fontWeight: 600, color: t.textSecondary }}>/mo</span></div>
              <div style={{ fontSize: 10.5, color: t.textMuted }}>1,200 mins incl.</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Guarantees ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 30 }}>
        {GUARANTEES.map(([title, blurb]) => (
          <div key={title} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <CheckCircleIcon size={16} color={t.success} />
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</span>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: t.textSecondary }}>{blurb}</div>
          </div>
        ))}
      </div>

      {/* ── Final CTA ── */}
      <div style={{
        position: 'relative', overflow: 'hidden', textAlign: 'center',
        borderRadius: 20, padding: '32px 26px', marginBottom: 10,
        background: heroBg, border: `1px solid ${blueBorder}`,
      }}>
        <div style={{
          width: 46, height: 46, borderRadius: 13, margin: '0 auto 14px',
          background: `linear-gradient(135deg, ${BLUE}, ${BLUE_DIM})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 20px rgba(0,113,243,0.35)',
        }}>
          <ZapIcon size={22} color="#fff" />
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>
          Price your next job this week
        </div>
        <div style={{ fontSize: 14, color: t.textSecondary, maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.55 }}>
          Start free, send one set of drawings, and see the whole thing work — the BOQ,
          the paperwork, the priced basket, the call-off dates. Or grab 30 minutes with
          us and we'll walk you through it on one of your own jobs.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
          <a className="atp-cta" href={REGISTER_URL} target="_blank" rel="noopener noreferrer" style={primaryBtn}>
            Start your 14-day free trial <ArrowRightIcon size={18} color="#fff" />
          </a>
          <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" style={ghostBtn}>
            <CalendarIcon size={16} color={BLUE} /> Book a 30-min demo
          </a>
        </div>
        <div style={{ marginTop: 16, fontSize: 12, letterSpacing: '0.08em', color: t.textMuted, fontWeight: 600 }}>
          14 DAYS FREE · 1 FREE AI QS JOB · CANCEL MONTHLY ANY TIME
        </div>
        <a href={SITE_URL} target="_blank" rel="noopener noreferrer" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12,
          fontSize: 12.5, fontWeight: 600, color: BLUE, textDecoration: 'none',
        }}>
          Learn more at aitradespilot.com <ExternalLinkIcon size={13} color={BLUE} />
        </a>
      </div>
    </div>
  );
}
