import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { CheckCircleIcon } from '../components/Icons';

// D — demo mode. A read-only sandbox seeded with one realistic job so a
// builder can FEEL the product before paying: quote accepted, deposit paid,
// stage payment overdue, a signed change, retention waiting. Everything is
// rendered client-side from this object — no DB writes, no API calls.

const DEMO = {
  money: { owed: 5400, overdue: 5400, quoted: 8200 },
  job: {
    client: 'Dave Patel', name: '5m x 4m rear extension', location: '12 Hill Street, Leeds',
    stage: 'In progress',
    strip: { quoted: 18550, invoiced: 9950, paid: 4550, toInvoice: 8600 },
    quote: { title: 'Quote · 12 May', detail: 'Rear extension · Q-20260512-3318', amount: 17700, status: 'Accepted', signed: 'Accepted by Dave Patel, 14 May — signed on his phone' },
    invoices: [
      { title: 'Invoice · 14 May', detail: 'Deposit (25%) · INV-2026-0007', amount: 4550, status: 'Paid', tone: 'success' },
      { title: 'Invoice · 26 May', detail: 'First fix complete · due 9 June · INV-2026-0009', amount: 5400, status: 'Overdue', tone: 'danger', chase: true },
    ],
    change: { title: 'Rot found behind the plaster', detail: 'VO-001 · signed by Dave Patel · photo attached', amount: 850, status: 'Approved' },
    retention: '5% retention (£927) held — due back 12 December. It will nag you so it never gets forgotten.',
  },
  attention: {
    headline: 'Dave Patel — 5m x 4m rear extension',
    situation: 'Invoice for £5,400 — 2 days overdue (reminder sent yesterday)',
    action: 'Chase it',
  },
};

export default function OfficeDemoPage() {
  const { t } = useTheme();
  const nav = useNavigate();
  const [note, setNote] = useState('');

  const fmt = (n) => '£' + n.toLocaleString('en-GB');
  const card = { background: t.card, border: '1px solid ' + t.border, borderRadius: 14, padding: 16, marginBottom: 12 };
  const chip = (bg, fg, label) => (
    <span style={{ background: bg, color: fg, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{label}</span>
  );
  const tones = {
    success: { bg: t.successBg, fg: t.success },
    danger: { bg: t.dangerBg, fg: t.danger },
    warning: { bg: t.warningBg, fg: t.warning },
  };

  const demoTap = (what) => setNote('In your account, that would ' + what + ' — here it\'s just the example.');

  return (
    <div style={{ padding: '16px 16px 110px', color: t.text, maxWidth: 720, margin: '0 auto' }}>
      {/* Always-visible banner: nothing here is real */}
      <div style={{
        background: 'rgba(245,158,11,0.1)', border: '1px solid #F59E0B', borderRadius: 12,
        padding: '12px 14px', marginBottom: 16, fontSize: 13.5, lineHeight: 1.45,
      }}>
        <strong>Example data — have a poke around.</strong> This is one job the way Office in a Box runs it: quote accepted on the client's phone, deposit paid, a payment being chased, a signed change. Nothing here is real or saved.
      </div>

      {note && (
        <div style={{ background: t.surface, border: '1px solid ' + t.border, borderRadius: 10, padding: '10px 12px', marginBottom: 12, color: t.textSecondary, fontSize: 13 }}>
          {note}
        </div>
      )}

      {/* Today-style numbers */}
      <div data-tour="demo-money" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[['Owed to you', fmt(DEMO.money.owed), t.text], ['Overdue', fmt(DEMO.money.overdue), t.danger], ['Quoted, awaiting answer', fmt(DEMO.money.quoted), t.text]].map(([label, value, colour]) => (
          <div key={label} style={{ background: t.card, border: '1px solid ' + t.border, borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ color: t.textSecondary, fontSize: 12.5, fontWeight: 600 }}>{label}</div>
            <div style={{ color: colour, fontSize: 28, fontWeight: 800, marginTop: 2 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Needs your attention */}
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Needs your attention</div>
      <div style={{ ...card, borderLeft: '4px solid ' + t.danger }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{DEMO.attention.headline}</div>
        <div style={{ color: t.textSecondary, fontSize: 13.5, marginTop: 4 }}>{DEMO.attention.situation}</div>
        <button onClick={() => demoTap('open a ready-written, polite chaser email for you to approve')} style={{
          marginTop: 10, minHeight: 44, padding: '0 18px', background: 'transparent',
          color: t.accent, border: '1.5px solid ' + t.accent, borderRadius: 10,
          fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>{DEMO.attention.action}</button>
      </div>

      {/* The job */}
      <div style={{ fontSize: 15, fontWeight: 700, margin: '18px 0 8px' }}>The job, all in one place</div>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{DEMO.job.client} — {DEMO.job.name}</div>
            <div style={{ color: t.textSecondary, fontSize: 13, marginTop: 2 }}>{DEMO.job.location}</div>
          </div>
          {chip('rgba(59,130,246,0.12)', '#3B82F6', DEMO.job.stage)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 12 }}>
          {[['Quoted', DEMO.job.strip.quoted], ['Invoiced', DEMO.job.strip.invoiced], ['Paid', DEMO.job.strip.paid], ['Still to invoice', DEMO.job.strip.toInvoice]].map(([label, v]) => (
            <div key={label} style={{ background: t.surface, border: '1px solid ' + t.border, borderRadius: 10, padding: '8px 10px' }}>
              <div style={{ color: t.textSecondary, fontSize: 11 }}>{label}</div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{fmt(v)}</div>
            </div>
          ))}
        </div>

        {/* Quote */}
        <div data-tour="demo-quote" style={{ borderTop: '1px solid ' + t.border, marginTop: 14, paddingTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{DEMO.job.quote.title}</div>
              <div style={{ color: t.textMuted, fontSize: 12 }}>{DEMO.job.quote.detail}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700 }}>{fmt(DEMO.job.quote.amount)}</div>
              {chip(tones.success.bg, tones.success.fg, DEMO.job.quote.status)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: t.success, fontSize: 12.5, marginTop: 6 }}>
            <CheckCircleIcon size={14} /> {DEMO.job.quote.signed}
          </div>
        </div>

        {/* Invoices */}
        {DEMO.job.invoices.map(inv => (
          <div key={inv.detail} data-tour={inv.chase ? 'demo-invoice' : undefined} style={{ borderTop: '1px dashed ' + t.border, marginTop: 10, paddingTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{inv.title}</div>
                <div style={{ color: t.textMuted, fontSize: 12 }}>{inv.detail}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700 }}>{fmt(inv.amount)}</div>
                {chip(tones[inv.tone].bg, tones[inv.tone].fg, inv.status)}
              </div>
            </div>
            {inv.chase && (
              <button data-tour="demo-chase" onClick={() => demoTap('draft the chaser and send it with the invoice attached')} style={{
                marginTop: 8, minHeight: 40, padding: '0 14px', borderRadius: 10, border: 'none',
                background: t.danger, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>Chase it</button>
            )}
          </div>
        ))}

        {/* Change */}
        <div data-tour="demo-change" style={{ borderTop: '1px dashed ' + t.border, marginTop: 10, paddingTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{DEMO.job.change.title}</div>
              <div style={{ color: t.textMuted, fontSize: 12 }}>{DEMO.job.change.detail}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700 }}>+{fmt(DEMO.job.change.amount)}</div>
              {chip(tones.success.bg, tones.success.fg, DEMO.job.change.status)}
            </div>
          </div>
        </div>

        <div data-tour="demo-retention" style={{ color: t.textMuted, fontSize: 12.5, marginTop: 12 }}>{DEMO.job.retention}</div>
      </div>

      {/* Sticky CTA */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, padding: '10px 16px calc(10px + env(safe-area-inset-bottom))',
        background: t.card, borderTop: '1px solid ' + t.border,
      }}>
        <button onClick={() => nav('/office-in-a-box')} style={{
          display: 'block', width: '100%', maxWidth: 720, margin: '0 auto', minHeight: 52,
          borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #F59E0B, #D97706)',
          color: '#0A0F1C', fontSize: 16, fontWeight: 800, cursor: 'pointer',
        }}>I want this for my jobs — £100/month</button>
      </div>
    </div>
  );
}
