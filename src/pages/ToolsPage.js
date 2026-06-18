import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import EstimatorGate from '../components/EstimatorGate';
import { CalculatorIcon, BrickIcon } from '../components/Icons';
import HelpTip from '../components/HelpTip';

// TOOLS — the reference tools re-homed off the main navigation.
// Calculators and Materials Pricing keep their own pages and URLs;
// this is just the doorway.

export default function ToolsPage() {
  return <EstimatorGate><Inner /></EstimatorGate>;
}

function Inner() {
  const { t } = useTheme();
  const nav = useNavigate();

  const tools = [
    {
      Icon: CalculatorIcon,
      label: 'Calculators',
      desc: 'Work out concrete, bricks, plasterboard, timber and more — on site, on your phone.',
      path: '/calculators',
    },
    {
      Icon: BrickIcon,
      label: 'Materials prices',
      desc: 'Look up current supplier prices and drop them straight into a quote.',
      path: '/materials',
    },
  ];

  return (
    <div style={{ padding: '20px 16px 32px', color: t.text, maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ color: '#F59E0B', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Office in a Box</div>
        <h1 data-tour="tools-title" style={{ margin: '4px 0 0 0', fontSize: 26, fontWeight: 700, letterSpacing: -0.4 }}>Tools <HelpTip t={t} title="Tools" text={"Reference tools for when you're on site: trade calculators (concrete, bricks, plasterboard…) and current supplier prices you can drop into a quote."} /></h1>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tools.map(tool => (
          <button key={tool.path} onClick={() => nav(tool.path)} style={{
            display: 'flex', alignItems: 'center', gap: 16, textAlign: 'left',
            background: t.card, border: '1px solid ' + t.border, boxShadow: t.shadowSm, borderRadius: 14,
            padding: '18px 18px', minHeight: 64, cursor: 'pointer', color: t.text,
          }}>
            <span style={{ color: t.accent, flexShrink: 0 }}><tool.Icon size={26} /></span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 16, fontWeight: 700 }}>{tool.label}</span>
              <span style={{ display: 'block', fontSize: 13, color: t.textSecondary, marginTop: 3, lineHeight: 1.4 }}>{tool.desc}</span>
            </span>
            <span style={{ color: t.textMuted, fontSize: 20 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
