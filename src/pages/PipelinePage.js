import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

const PIPELINE_STAGES = [
  { key: 'uploaded', label: 'Drawings Uploaded', icon: '📤' },
  { key: 'analysing', label: 'AI Analysis', icon: '🤖' },
  { key: 'measuring', label: 'Take-Off', icon: '📐' },
  { key: 'pricing', label: 'Rate Matching', icon: '💷' },
  { key: 'generating', label: 'BOQ Generation', icon: '📊' },
  { key: 'review', label: 'QA Review', icon: '👁️' },
  { key: 'complete', label: 'Complete', icon: '✅' },
];

const MOCK_JOBS = [
  { id: 'JOB-301', name: 'Turnkey Build — Joe', client: 'BES Construction', stage: 'pricing', startedAt: '2026-02-23T09:15:00', drawings: 12, pagesProcessed: 9, totalPages: 12, errors: 0, warnings: 1 },
  { id: 'JOB-302', name: 'Barge & Barrel Conversion', client: 'YDS (Leeds)', stage: 'measuring', startedAt: '2026-02-23T10:30:00', drawings: 5, pagesProcessed: 3, totalPages: 5, errors: 0, warnings: 0 },
  { id: 'JOB-303', name: 'Parkgate Avenue Extension', client: 'Penn Contracting', stage: 'review', startedAt: '2026-02-22T14:00:00', drawings: 5, pagesProcessed: 5, totalPages: 5, errors: 0, warnings: 2 },
];

export default function PipelinePage() {
  const { t } = useTheme();
  const stageCount = (key) => MOCK_JOBS.filter(j => j.stage === key).length;

  return (
    <div style={{ padding: '28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: t.text, margin: 0 }}>BOQ Pipeline</h1>
        <p style={{ fontSize: 13, color: t.textMuted, margin: '4px 0 0' }}>Track drawing processing from upload to final BOQ delivery</p>
      </div>

      {/* Stage Visualisation */}
      <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: 24, marginBottom: 24, boxShadow: t.shadowSm, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 700 }}>
          {PIPELINE_STAGES.map((stage, i) => {
            const count = stageCount(stage.key);
            const hasJobs = count > 0;
            return (
              <div key={stage.key} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    background: hasJobs ? t.accentGlow : t.surfaceHover,
                    border: `2px solid ${hasJobs ? t.accent : t.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, position: 'relative', transition: 'all 0.3s'
                  }}>
                    {stage.icon}
                    {hasJobs && (
                      <span style={{
                        position: 'absolute', top: -6, right: -6,
                        width: 20, height: 20, borderRadius: '50%',
                        background: t.accent, color: '#fff',
                        fontSize: 10, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>{count}</span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: hasJobs ? t.text : t.textMuted, fontWeight: hasJobs ? 600 : 400, textAlign: 'center' }}>
                    {stage.label}
                  </span>
                </div>
                {i < PIPELINE_STAGES.length - 1 && (
                  <div style={{ width: 30, height: 2, background: t.border, flexShrink: 0 }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Jobs */}
      <h2 style={{ fontSize: 16, fontWeight: 600, color: t.text, margin: '0 0 14px' }}>Active Jobs</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {MOCK_JOBS.map(job => {
          const stageIdx = PIPELINE_STAGES.findIndex(s => s.key === job.stage);
          return (
            <div key={job.id} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: 20, boxShadow: t.shadowSm }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>{job.name}</div>
                  <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>
                    {job.id} • {job.client} • Started {new Date(job.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{ padding: '6px 14px', borderRadius: 8, background: t.surfaceHover, border: `1px solid ${t.border}`, color: t.textSecondary, cursor: 'pointer', fontSize: 12 }}>Pause</button>
                  <button style={{ padding: '6px 14px', borderRadius: 8, background: t.surfaceHover, border: `1px solid ${t.border}`, color: t.textSecondary, cursor: 'pointer', fontSize: 12 }}>Restart</button>
                </div>
              </div>

              {/* Stage progress */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                {PIPELINE_STAGES.map((stage, i) => (
                  <div key={stage.key} style={{
                    flex: 1, height: 6, borderRadius: 3,
                    background: i < stageIdx ? t.success : i === stageIdx ? t.accent : t.border,
                    transition: 'all 0.5s'
                  }} />
                ))}
              </div>

              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, color: t.textMuted }}>Stage: <span style={{ color: t.accentLight, fontWeight: 600 }}>{PIPELINE_STAGES[stageIdx].label}</span></div>
                <div style={{ fontSize: 12, color: t.textMuted }}>Pages: <span style={{ color: t.text, fontWeight: 600 }}>{job.pagesProcessed}/{job.totalPages}</span></div>
                <div style={{ fontSize: 12, color: t.textMuted }}>Drawings: <span style={{ color: t.text, fontWeight: 600 }}>{job.drawings}</span></div>
                {job.warnings > 0 && <div style={{ fontSize: 12, color: t.warning, fontWeight: 500 }}>⚠️ {job.warnings} warning{job.warnings > 1 ? 's' : ''}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Upload Zone */}
      <div style={{
        background: t.card, border: `2px dashed ${t.border}`, borderRadius: 14,
        padding: 50, display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 12, cursor: 'pointer', transition: 'all 0.2s'
      }}>
        <div style={{ width: 60, height: 60, borderRadius: 16, background: t.accentGlow, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>📤</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>Upload Drawings to Pipeline</div>
        <div style={{ fontSize: 12, color: t.textMuted, textAlign: 'center' }}>Drag & drop PDFs here, or click to browse. Supports multi-page architectural drawings.</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {['PDF', 'DWG', 'PNG/JPG'].map(f => (
            <span key={f} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: t.surfaceHover, color: t.textMuted }}>{f}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
