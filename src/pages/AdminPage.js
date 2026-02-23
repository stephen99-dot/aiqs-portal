import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

const RATE_LIBRARIES = [
  { name: 'UK Residential', version: 'v3.2', items: 847, lastUpdated: '2026-02-15', regions: 'England, Wales, Scotland', custom: false },
  { name: 'Ireland Residential', version: 'v2.1', items: 623, lastUpdated: '2026-01-28', regions: 'Republic of Ireland, NI', custom: false },
  { name: 'UK Commercial', version: 'v2.8', items: 1042, lastUpdated: '2026-02-10', regions: 'England, Wales, Scotland', custom: false },
  { name: 'Metalwork v2 (Paul)', version: 'v2.0', items: 156, lastUpdated: '2026-02-12', regions: 'UK-wide', custom: true },
  { name: 'S Sira Custom (Sandeep)', version: 'v1.0', items: 89, lastUpdated: '2026-02-20', regions: 'London, SE England', custom: true },
];

const ACTIVITY_LOG = [
  { time: '10:42', action: 'BOQ generated', detail: 'Richmond Mews Coping — £61,503 total, 4 sheets', type: 'success' },
  { time: '10:30', action: 'Pipeline started', detail: 'Barge & Barrel Conversion — 5 drawings queued', type: 'info' },
  { time: '09:45', action: 'Rate mismatch flagged', detail: "Turnkey Build — Joe: 'acoustic board' not found in rate library", type: 'warning' },
  { time: '09:15', action: 'Pipeline started', detail: 'Turnkey Build — Joe — 12 drawings queued', type: 'info' },
  { time: 'Yesterday', action: 'Client signup', detail: 'YDS (Leeds) registered — Pro plan', type: 'success' },
  { time: 'Yesterday', action: 'Drawings uploaded', detail: 'Parkgate Avenue Extension — 5 files received from Penn Contracting', type: 'info' },
  { time: '2 days ago', action: 'Pipeline error', detail: 'Clive — Rear Extension: PDF extraction failed on page 3 (corrupt)', type: 'danger' },
  { time: '2 days ago', action: 'BOQ approved', detail: 'Portrack House Carport — client downloaded BOQ', type: 'success' },
];

const SYSTEM_SERVICES = [
  { label: 'Pipedream API', status: 'operational', uptime: '99.8%' },
  { label: 'Claude API (Anthropic)', status: 'operational', uptime: '99.5%' },
  { label: 'Google Drive Sync', status: 'operational', uptime: '100%' },
  { label: 'Rate Library', status: 'warning', uptime: '97.2%', note: '3 unmapped rate codes' },
];

function StatCard({ label, value, sub, emoji, t }) {
  return (
    <div style={{
      background: t.card, border: `1px solid ${t.border}`,
      borderRadius: 14, padding: '22px 18px', boxShadow: t.shadowSm
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 24 }}>{emoji}</span>
        {sub && <span style={{ fontSize: 11, color: t.textMuted }}>{sub}</span>}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: t.text }}>{value}</div>
      <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function OverviewTab({ t }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <StatCard emoji="👥" label="Total Clients" value="8" sub="4 Pro" t={t} />
        <StatCard emoji="📄" label="Drawings Processed" value="116" sub="this month" t={t} />
        <StatCard emoji="💷" label="Revenue" value="£14,400" sub="all time" t={t} />
        <StatCard emoji="⚡" label="Avg Processing" value="4.2 min" sub="per drawing" t={t} />
      </div>
      <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: 20, boxShadow: t.shadowSm }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: t.text, margin: '0 0 14px' }}>System Health</h3>
        {SYSTEM_SERVICES.map((svc, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 0',
            borderBottom: i < SYSTEM_SERVICES.length - 1 ? `1px solid ${t.border}` : 'none'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: svc.status === 'operational' ? t.success : t.warning }} />
              <span style={{ fontSize: 13, color: t.text }}>{svc.label}</span>
              {svc.note && (
                <span style={{ fontSize: 11, color: t.warning, background: t.warningBg, padding: '2px 8px', borderRadius: 6 }}>{svc.note}</span>
              )}
            </div>
            <span style={{ fontSize: 12, color: t.textMuted }}>{svc.uptime} uptime</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RatesTab({ t }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: t.text, margin: 0 }}>Rate Libraries</h3>
        <button style={{ padding: '8px 14px', borderRadius: 8, background: t.accent, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ New Library</button>
      </div>
      {RATE_LIBRARIES.map((lib, i) => (
        <div key={i} style={{
          background: t.card, border: `1px solid ${lib.custom ? t.gold + '30' : t.border}`,
          borderRadius: 12, padding: '16px 20px', boxShadow: t.shadowSm,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: lib.custom ? t.goldBg : t.accentGlow,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
            }}>{lib.custom ? '⭐' : '📚'}</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{lib.name}</span>
                {lib.custom && (
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: t.goldBg, color: t.gold, fontWeight: 600 }}>Custom</span>
                )}
                <span style={{ fontSize: 11, color: t.textDim }}>{lib.version}</span>
              </div>
              <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>{lib.items} items • {lib.regions} • Updated {lib.lastUpdated}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={{ padding: '6px 12px', borderRadius: 6, background: t.surfaceHover, border: `1px solid ${t.border}`, color: t.textSecondary, cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>Edit</button>
            <button style={{ padding: '6px 12px', borderRadius: 6, background: t.surfaceHover, border: `1px solid ${t.border}`, color: t.textSecondary, cursor: 'pointer', fontSize: 11, fontWeight: 500 }}>Export</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function LogsTab({ t }) {
  const typeStyle = (type) => {
    if (type === 'success') return { bg: t.successBg, icon: '✅' };
    if (type === 'warning') return { bg: t.warningBg, icon: '⚠️' };
    if (type === 'danger') return { bg: t.dangerBg, icon: '❌' };
    return { bg: t.accentGlow, icon: 'ℹ️' };
  };

  return (
    <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: 20, boxShadow: t.shadowSm }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: t.text, margin: '0 0 14px' }}>Activity Log</h3>
      {ACTIVITY_LOG.map((item, i) => {
        const s = typeStyle(item.type);
        return (
          <div key={i} style={{
            display: 'flex', gap: 12, padding: '12px 0',
            borderBottom: i < ACTIVITY_LOG.length - 1 ? `1px solid ${t.border}` : 'none'
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 7, background: s.bg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, marginTop: 2, fontSize: 13
            }}>{s.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: t.text }}>{item.action}</div>
              <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>{item.detail}</div>
            </div>
            <span style={{ fontSize: 11, color: t.textDim, whiteSpace: 'nowrap' }}>{item.time}</span>
          </div>
        );
      })}
    </div>
  );
}

function SettingsTab({ t }) {
  const sections = [
    { title: 'API Configuration', items: [
      { label: 'Anthropic API Key', value: 'sk-...7xQ4', type: 'secret' },
      { label: 'Pipedream Webhook URL', value: 'https://eo...pipedream.net/...', type: 'url' },
      { label: 'Google Drive Folder ID', value: '1abc...xyz', type: 'text' },
    ]},
    { title: 'Processing Defaults', items: [
      { label: 'Default Rate Library', value: 'UK Residential v3.2' },
      { label: 'Location Factor Auto-Adjust', value: 'Enabled' },
      { label: 'QA Review Required', value: 'Enabled' },
      { label: 'Auto-Email BOQ on Complete', value: 'Disabled' },
    ]},
    { title: 'Branding', items: [
      { label: 'Company Name', value: 'CRM Wizard AI' },
      { label: 'Report Header Logo', value: 'crm-wizard-logo.png' },
      { label: 'BOQ Excel Template', value: 'Dark navy + light blue style' },
    ]},
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sections.map((section, i) => (
        <div key={i} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: 20, boxShadow: t.shadowSm }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: t.text, margin: '0 0 14px' }}>{section.title}</h3>
          {section.items.map((item, j) => (
            <div key={j} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 0',
              borderBottom: j < section.items.length - 1 ? `1px solid ${t.border}` : 'none'
            }}>
              <span style={{ fontSize: 13, color: t.textSecondary }}>{item.label}</span>
              <span style={{
                fontSize: 13, color: t.text, fontWeight: 500, fontFamily: 'monospace',
                background: t.surfaceHover, padding: '4px 10px', borderRadius: 6
              }}>
                {item.type === 'secret' ? '••••••••' + item.value.slice(-4) : item.value}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function AdminPage() {
  const { t } = useTheme();
  const [tab, setTab] = useState('overview');

  const tabs = [
    { key: 'overview', label: '📊 Overview' },
    { key: 'rates', label: '📚 Rate Libraries' },
    { key: 'logs', label: '📋 Activity Log' },
    { key: 'settings', label: '⚙️ Settings' },
  ];

  return (
    <div style={{ padding: '28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: t.text, margin: 0 }}>Admin Panel</h1>
        <p style={{ fontSize: 13, color: t.textMuted, margin: '4px 0 0' }}>System configuration, rate management, and monitoring</p>
      </div>

      <div style={{
        display: 'flex', gap: 4, padding: 4, marginBottom: 24,
        background: t.surface, borderRadius: 12, border: `1px solid ${t.border}`
      }}>
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)} style={{
            flex: 1, padding: '10px 14px', borderRadius: 9,
            background: tab === tb.key ? t.card : 'transparent',
            color: tab === tb.key ? t.text : t.textMuted,
            border: tab === tb.key ? `1px solid ${t.border}` : '1px solid transparent',
            cursor: 'pointer', fontSize: 13,
            fontWeight: tab === tb.key ? 600 : 400,
            boxShadow: tab === tb.key ? t.shadowSm : 'none'
          }}>
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab t={t} />}
      {tab === 'rates' && <RatesTab t={t} />}
      {tab === 'logs' && <LogsTab t={t} />}
      {tab === 'settings' && <SettingsTab t={t} />}
    </div>
  );
}
