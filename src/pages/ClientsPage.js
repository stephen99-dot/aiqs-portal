import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

const MOCK_CLIENTS = [
  { id: 'CLI-001', name: 'Paul Metalwork', email: 'paul@metalwork.co.uk', plan: 'Pro', drawingsUsed: 14, drawingsLimit: 50, projects: 8, totalSpend: 4250, joined: '2025-11-01', rateCard: 'Metalwork v2' },
  { id: 'CLI-002', name: 'Marius', email: 'marius@qsconsult.com', plan: 'Standard', drawingsUsed: 22, drawingsLimit: 30, projects: 5, totalSpend: 2100, joined: '2025-12-15', rateCard: 'UK Residential' },
  { id: 'CLI-003', name: 'BES Construction', email: 'info@besconstruction.com', plan: 'Pro', drawingsUsed: 31, drawingsLimit: 50, projects: 3, totalSpend: 1800, joined: '2026-01-05', rateCard: 'UK Residential' },
  { id: 'CLI-004', name: 'Penn Contracting', email: 'office@penncontracting.ie', plan: 'Standard', drawingsUsed: 9, drawingsLimit: 30, projects: 4, totalSpend: 1550, joined: '2025-10-20', rateCard: 'Ireland Residential' },
  { id: 'CLI-005', name: 'Andy Craig', email: 'andy@craigbuild.co.uk', plan: 'Pay-as-you-go', drawingsUsed: 4, drawingsLimit: 10, projects: 2, totalSpend: 650, joined: '2026-02-01', rateCard: 'UK Residential' },
  { id: 'CLI-006', name: 'Jamie Cheffings', email: 'jamie@jcbuilders.co.uk', plan: 'Standard', drawingsUsed: 7, drawingsLimit: 30, projects: 2, totalSpend: 900, joined: '2026-01-18', rateCard: 'UK Residential' },
  { id: 'CLI-007', name: 'YDS (Leeds)', email: 'projects@ydsleeds.co.uk', plan: 'Pro', drawingsUsed: 18, drawingsLimit: 50, projects: 1, totalSpend: 750, joined: '2026-02-10', rateCard: 'UK Commercial' },
  { id: 'CLI-008', name: 'Sandeep — S Sira Group', email: 'sandeep@ssiragroup.com', plan: 'Pro', drawingsUsed: 11, drawingsLimit: 50, projects: 3, totalSpend: 2400, joined: '2026-01-22', rateCard: 'S Sira Custom' },
];

const PLAN_STYLES = {
  Pro: { color: '#2563EB', bg: 'rgba(37,99,235,0.1)' },
  Standard: { color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  'Pay-as-you-go': { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
};

export default function ClientsPage() {
  const { t } = useTheme();
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('all');

  const filtered = MOCK_CLIENTS.filter(c => {
    if (planFilter !== 'all' && c.plan !== planFilter) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.email.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ padding: '28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: t.text, margin: 0 }}>Clients</h1>
        <button style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 18px', borderRadius: 10,
          background: t.accent, color: '#fff', border: 'none',
          cursor: 'pointer', fontSize: 13, fontWeight: 600
        }}>+ Add Client</button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search clients..."
          style={{
            flex: 1, minWidth: 200, padding: '10px 14px', borderRadius: 10,
            border: `1px solid ${t.border}`, background: t.inputBg,
            color: t.text, fontSize: 13, outline: 'none'
          }}
        />
        {['all', 'Pro', 'Standard', 'Pay-as-you-go'].map(f => (
          <button key={f} onClick={() => setPlanFilter(f)} style={{
            padding: '8px 14px', borderRadius: 8,
            background: planFilter === f ? t.accentGlow : 'transparent',
            color: planFilter === f ? t.accentLight : t.textMuted,
            border: `1px solid ${planFilter === f ? t.accent + '30' : t.border}`,
            cursor: 'pointer', fontSize: 12, fontWeight: 500
          }}>
            {f === 'all' ? 'All Plans' : f}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {filtered.map(c => {
          const usagePct = Math.round((c.drawingsUsed / c.drawingsLimit) * 100);
          const ps = PLAN_STYLES[c.plan] || PLAN_STYLES.Standard;
          return (
            <div key={c.id} style={{
              background: t.card, border: `1px solid ${t.border}`,
              borderRadius: 14, padding: 20, boxShadow: t.shadowSm,
              cursor: 'pointer', transition: 'all 0.15s'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: 10,
                    background: ps.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, fontWeight: 700, color: ps.color
                  }}>{c.name.charAt(0)}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: t.textMuted }}>{c.email}</div>
                  </div>
                </div>
                <span style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 8,
                  background: ps.bg, color: ps.color, fontWeight: 600
                }}>{c.plan}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                <span style={{ color: t.textMuted }}>Drawings: {c.drawingsUsed}/{c.drawingsLimit}</span>
                <span style={{ color: usagePct > 80 ? t.warning : t.textMuted, fontWeight: usagePct > 80 ? 600 : 400 }}>{usagePct}%</span>
              </div>
              <div style={{ width: '100%', height: 4, borderRadius: 4, background: t.border, overflow: 'hidden', marginBottom: 14 }}>
                <div style={{
                  width: `${usagePct}%`, height: '100%', borderRadius: 4,
                  background: usagePct > 80 ? t.warning : `linear-gradient(90deg, ${t.accent}, ${t.accentLight})`,
                  transition: 'width 0.8s ease'
                }} />
              </div>

              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: t.textMuted }}>
                <span>{c.projects} projects</span>
                <span>£{c.totalSpend.toLocaleString()} spend</span>
                <span>Rate: {c.rateCard}</span>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: t.textMuted }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: t.textSecondary }}>No clients found</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Try adjusting your filters or search</div>
        </div>
      )}
    </div>
  );
}
