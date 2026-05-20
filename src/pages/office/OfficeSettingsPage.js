import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import EstimatorGate from '../../components/EstimatorGate';

// Office Settings — the "set once, applies everywhere" hub. Picker that
// links to existing pages (overheads, branding, my rates) and the new
// templates / calculators consolidation in chunks 4-5.

const TILES = [
  {
    id: 'overheads',
    label: 'Overheads & break-even',
    blurb: 'Your monthly fixed costs and the day-rate you have to clear.',
    icon: '📊',
    path: '/office/settings/overheads',
  },
  {
    id: 'business-profile',
    label: 'Business profile & branding',
    blurb: 'Company name, address, logo, colours — used on every PDF and document.',
    icon: '🏢',
    path: '/office/settings/branding',
  },
  {
    id: 'rates',
    label: 'My rates',
    blurb: 'Your saved rate library used by the estimator.',
    icon: '💷',
    path: '/office/settings/rates',
  },
  {
    id: 'templates',
    label: 'Document templates',
    blurb: 'Blank versions of every document — contracts, T&Cs, scope, RAMS, payment schedule.',
    icon: '📄',
    path: '/office/settings/templates',
  },
  {
    id: 'calculators',
    label: 'Calculators',
    blurb: 'Quick material-quantity tools (brick, concrete, plaster, roof, paint).',
    icon: '🧮',
    path: '/office/settings/calculators',
  },
  {
    id: 'alerts',
    label: 'Project Manager alerts',
    blurb: 'How many days before a stale variation or quote should be flagged.',
    icon: '🔔',
    path: '/office/settings/alerts',
  },
];

export default function OfficeSettingsPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();

  return (
    <div style={{ padding: 24, color: t.text, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Office in a Box</div>
        <h1 style={{ margin: '4px 0 0 0', fontSize: 28, fontWeight: 700, letterSpacing: -0.4 }}>Settings</h1>
        <div style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}>
          Set once — these apply across every job, document, and invoice.
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 12,
      }}>
        {TILES.map(tile => (
          <button key={tile.id} onClick={() => nav(tile.path)} style={{
            background: t.card, border: '1px solid ' + t.border, borderRadius: 12,
            padding: 18, textAlign: 'left', cursor: 'pointer', color: t.text,
            transition: 'transform 0.08s ease, box-shadow 0.12s ease',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div style={{ fontSize: 26, marginBottom: 8 }}>{tile.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{tile.label}</div>
            <div style={{ color: t.textSecondary, fontSize: 12, marginTop: 4 }}>{tile.blurb}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
