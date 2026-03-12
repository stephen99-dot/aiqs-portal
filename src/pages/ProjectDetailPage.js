import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch, getToken } from '../utils/api';

// SVG icons for document types
const ExcelIcon = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect x="2" y="2" width="28" height="28" rx="4" fill="#107C41"/>
    <path d="M8 8h6v6H8V8zm0 10h6v6H8v-6zm10-10h6v6h-6V8zm0 10h6v6h-6v-6z" fill="#21A366"/>
    <text x="16" y="21" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="800" fontFamily="system-ui">X</text>
  </svg>
);

const WordIcon = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect x="2" y="2" width="28" height="28" rx="4" fill="#185ABD"/>
    <text x="16" y="21" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="800" fontFamily="system-ui">W</text>
  </svg>
);

const ClientCopyIcon = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect x="2" y="2" width="28" height="28" rx="4" fill="#7C3AED"/>
    <path d="M16 10v4m0 0v4m0-4h4m-4 0h-4" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M10 22h12" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const STATUS_MAP = {
  submitted: { label: 'Submitted', color: '#3B82F6', bg: 'rgba(59,130,246,0.1)', desc: 'Your project has been received. We\'ll begin review shortly.' },
  in_review: { label: 'In Review', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)', desc: 'We\'re reviewing your drawings and project brief.' },
  in_progress: { label: 'In Progress', color: '#A855F7', bg: 'rgba(168,85,247,0.1)', desc: 'Your BOQ is being prepared. We\'ll notify you when it\'s ready.' },
  completed: { label: 'Completed', color: '#10B981', bg: 'rgba(16,185,129,0.1)', desc: 'Your BOQ pack is complete and ready for download.' },
  delivered: { label: 'Delivered', color: '#10B981', bg: 'rgba(16,185,129,0.15)', desc: 'Your BOQ pack has been delivered.' },
};

const STEPS = ['submitted', 'in_review', 'in_progress', 'completed'];

export default function ProjectDetailPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null);
  const [showClientCopyModal, setShowClientCopyModal] = useState(false);
  const [clientCopySettings, setClientCopySettings] = useState({ contingency: 7.5, ohp: 12, vat: 0 });
  const [generatingClientCopy, setGeneratingClientCopy] = useState(false);
  const [clientCopyError, setClientCopyError] = useState('');

  useEffect(() => { loadProject(); }, [id]); // eslint-disable-line

  async function loadProject() {
    try {
      const data = await apiFetch(`/projects/${id}`);
      setProject(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload(filename, label) {
    setDownloading(filename);
    try {
      const token = localStorage.getItem('aiqs_token');
      const resp = await fetch(`/api/downloads/${filename}`, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download failed — the file may have expired. Please regenerate from the chat.');
    } finally {
      setDownloading(null);
    }
  }

  async function handleGenerateClientCopy() {
    setGeneratingClientCopy(true);
    setClientCopyError('');
    try {
      const token = getToken();
      const resp = await fetch(`/api/projects/${id}/client-copy`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(clientCopySettings)
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Failed to generate client copy');
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `ClientCopy_${project.title}.xlsx`;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setShowClientCopyModal(false);
    } catch (err) {
      setClientCopyError(err.message);
    } finally {
      setGeneratingClientCopy(false);
    }
  }

  function formatCurrency(v, cur) {
    const sym = cur === 'EUR' ? '€' : '£';
    return sym + (v || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  if (loading) {
    return (
      <div className="page">
        <div className="empty-state"><div className="loading-spinner" /><p>Loading project...</p></div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="page">
        <div className="empty-state">
          <h3>Project not found</h3>
          <Link to="/dashboard" className="btn-secondary" style={{ marginTop: 16 }}>Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  const status = STATUS_MAP[project.status] || STATUS_MAP.submitted;
  const currentStep = STEPS.indexOf(project.status);
  const hasDocuments = project.boq_filename || project.findings_filename;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Link to="/dashboard" className="back-link">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M11 17l-5-5m0 0l5-5m-5 5h12"/></svg>
            All Projects
          </Link>
          <h1 className="page-title">{project.title}</h1>
          <p className="page-subtitle">
            {project.project_type}
            {project.location ? ` · ${project.location}` : ''}
            {' · '}
            {new Date(project.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link to={`/project/${id}/variations`} className="btn-secondary" style={{ fontSize: 13 }}>
            📋 Variations
          </Link>
          <span className="status-badge large" style={{ color: status.color, background: status.bg }}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Progress tracker */}
      <div className="section-card">
        <div className="section-card-header">
          <h2>Progress</h2>
        </div>
        <div className="card-body">
          <div className="progress-track">
            {STEPS.map((step, i) => {
              const s = STATUS_MAP[step];
              const isActive = i <= currentStep;
              const isCurrent = i === currentStep;
              return (
                <div key={step} className={`progress-step ${isActive ? 'active' : ''} ${isCurrent ? 'current' : ''}`}>
                  <div className="step-dot">
                    {isActive && i < currentStep ? (
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7"/></svg>
                    ) : (
                      <span>{i + 1}</span>
                    )}
                  </div>
                  <div className="step-label">{s.label}</div>
                </div>
              );
            })}
          </div>
          <p className="progress-desc">{status.desc}</p>
        </div>
      </div>

      {/* Project description */}
      {project.description && (
        <div className="section-card">
          <div className="section-card-header">
            <h2>Project Brief</h2>
          </div>
          <div className="card-body">
            <p className="project-description">{project.description}</p>
          </div>
        </div>
      )}

      {/* Documents */}
      <div className="section-card">
        <div className="section-card-header">
          <h2>Documents</h2>
        </div>
        <div className="card-body">
          {hasDocuments ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Summary bar */}
              {(project.total_value > 0 || project.item_count > 0) && (
                <div style={{
                  display: 'flex', gap: 24, padding: '12px 16px',
                  background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)',
                  borderRadius: 10, marginBottom: 4,
                }}>
                  {project.total_value > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Project Value</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#10B981' }}>{formatCurrency(project.total_value, project.currency)}</div>
                    </div>
                  )}
                  {project.item_count > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Line Items</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{project.item_count}</div>
                    </div>
                  )}
                  {project.project_type && (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Type</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{project.project_type}</div>
                    </div>
                  )}
                </div>
              )}

              {/* BOQ Excel */}
              {project.boq_filename && (
                <button
                  onClick={() => handleDownload(project.boq_filename, 'BOQ')}
                  disabled={downloading === project.boq_filename}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 18px', borderRadius: 10, cursor: 'pointer',
                    background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)',
                    textAlign: 'left', width: '100%',
                    opacity: downloading === project.boq_filename ? 0.6 : 1,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(16,185,129,0.12)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(16,185,129,0.06)'}
                >
                  <ExcelIcon />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                      Bill of Quantities (Excel)
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {project.boq_filename}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#10B981', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {downloading === project.boq_filename ? (
                      'Downloading...'
                    ) : (
                      <>
                        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                        Download
                      </>
                    )}
                  </div>
                </button>
              )}

              {/* Findings Report Word doc */}
              {project.findings_filename && (
                <button
                  onClick={() => handleDownload(project.findings_filename, 'Findings Report')}
                  disabled={downloading === project.findings_filename}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 18px', borderRadius: 10, cursor: 'pointer',
                    background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)',
                    textAlign: 'left', width: '100%',
                    opacity: downloading === project.findings_filename ? 0.6 : 1,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.12)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(59,130,246,0.06)'}
                >
                  <WordIcon />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                      Findings Report (Word)
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {project.findings_filename}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#3B82F6', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {downloading === project.findings_filename ? (
                      'Downloading...'
                    ) : (
                      <>
                        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                        Download
                      </>
                    )}
                  </div>
                </button>
              )}

              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0', textAlign: 'center' }}>
                Need changes? Go back to the chat and say "regenerate documents" with any adjustments.
              </p>

              {/* Client Copy button */}
              {project.boq_filename && (
                <button
                  onClick={() => { setShowClientCopyModal(true); setClientCopyError(''); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 18px', borderRadius: 10, cursor: 'pointer',
                    background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)',
                    textAlign: 'left', width: '100%', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(168,85,247,0.12)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(168,85,247,0.06)'}
                >
                  <ClientCopyIcon />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                      Client Copy (Excel)
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Contingency & OH&P baked into rates — margin hidden
                    </div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#A855F7', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>
                    Configure
                  </div>
                </button>
              )}
            </div>
          ) : (
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <div style={{ marginBottom: 12 }}><svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="var(--text-muted)" strokeWidth="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg></div>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>
                No documents generated yet. Open the chat for this project and say "generate documents" to create your BOQ and Findings Report.
              </p>
              <Link
                to="/chat"
                style={{
                  display: 'inline-block', marginTop: 16, padding: '10px 20px',
                  background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)',
                  borderRadius: 8, color: '#F59E0B', fontSize: 13, fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                Go to Chat →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Client Copy Modal */}
      {showClientCopyModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--card-bg)', borderRadius: 14, padding: 32, width: 420, maxWidth: '90vw', border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Generate Client Copy</h3>
            <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 24, lineHeight: 1.5 }}>
              Set your uplift percentages. These will be baked into each line item rate — the client sees final prices only, with no margin visible.
            </p>

            {[
              { key: 'contingency', label: 'Contingency', hint: 'Risk allowance, typically 5–10%' },
              { key: 'ohp', label: 'Overhead & Profit', hint: 'Your margin, typically 10–15%' },
              { key: 'vat', label: 'VAT', hint: 'Set to 0 if quoting ex-VAT' },
            ].map(({ key, label, hint }) => (
              <div key={key} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>{label}</label>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>{clientCopySettings[key]}%</span>
                </div>
                <input
                  type="range" min="0" max={key === 'vat' ? 25 : 30} step="0.5"
                  value={clientCopySettings[key]}
                  onChange={e => setClientCopySettings(s => ({ ...s, [key]: parseFloat(e.target.value) }))}
                  style={{ width: '100%', accentColor: 'var(--primary)', marginBottom: 4 }}
                />
                <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>{hint}</p>
              </div>
            ))}

            {/* Live preview of total uplift */}
            <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, opacity: 0.7 }}>Total uplift on base rates</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--primary)' }}>
                +{((((1 + clientCopySettings.contingency / 100) * (1 + clientCopySettings.ohp / 100) * (1 + clientCopySettings.vat / 100)) - 1) * 100).toFixed(1)}%
              </span>
            </div>

            {clientCopyError && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 16, color: '#EF4444', fontSize: 13 }}>
                {clientCopyError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn-primary"
                style={{ flex: 1, background: '#A855F7', borderColor: '#A855F7' }}
                onClick={handleGenerateClientCopy}
                disabled={generatingClientCopy}
              >
                {generatingClientCopy ? '⏳ Generating...' : '↓ Generate & Download'}
              </button>
              <button className="btn-secondary" onClick={() => setShowClientCopyModal(false)} disabled={generatingClientCopy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
