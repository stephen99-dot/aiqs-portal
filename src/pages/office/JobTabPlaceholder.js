import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';

// Placeholder content for each tab during chunk 1. Chunk 2 swaps these for
// the existing feature components. Renders a friendly "moves in next" stub
// plus a small panel showing the job context is reaching the tab correctly.

export function makeTabPlaceholder(tabLabel, blurb) {
  return function TabPlaceholder() {
    const { t } = useTheme();
    const ctx = useOutletContext() || {};
    return (
      <div style={{
        background: t.card, border: '1px dashed ' + t.border, borderRadius: 12,
        padding: 40, textAlign: 'center', color: t.textSecondary,
      }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🚧</div>
        <div style={{ color: t.text, fontWeight: 600, fontSize: 16 }}>{tabLabel}</div>
        <div style={{ marginTop: 6, fontSize: 13 }}>{blurb}</div>
        {ctx.job && (
          <div style={{ marginTop: 14, fontSize: 11, color: t.textMuted }}>
            Job context wired up: <code style={{ background: t.bg, padding: '1px 6px', borderRadius: 3, color: t.text }}>{ctx.job.id}</code>
          </div>
        )}
      </div>
    );
  };
}

export const OverviewTab   = makeTabPlaceholder('Overview',   'Status, totals, margin vs break-even, this job\'s alerts, recent activity. Lands here in chunk 2.');
export const EstimateTab   = makeTabPlaceholder('Estimate',   'Existing estimator builder mounts here.');
export const VariationsTab = makeTabPlaceholder('Variations', 'Change orders + e-approval for this job mount here.');
export const InvoicesTab   = makeTabPlaceholder('Invoices',   'Invoices + payment schedule for this job mount here.');
export const DocumentsTab  = makeTabPlaceholder('Documents',  'Branded Word documents for this job — chunk 4.');
