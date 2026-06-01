import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import DeliverablesPanel from '../components/DeliverablesPanel';
import { ClipboardIcon } from '../components/Icons';

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

const STATUS_MAP = {
  submitted: { label: 'Submitted', color: '#3B82F6', bg: 'rgba(59,130,246,0.1)', desc: 'Your project has been received. We\'ll begin review shortly.' },
  in_review: { label: 'In Review', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)', desc: 'We\'re reviewing your drawings and project brief.' },
  in_progress: { label: 'In Progress', color: '#A855F7', bg: 'rgba(168,85,247,0.1)', desc: 'Your BOQ is being prepared. We\'ll notify you when it\'s ready.' },
  completed: { label: 'Completed', color: '#10B981', bg: 'rgba(16,185,129,0.1)', desc: 'Your BOQ pack is complete and ready for download.' },
  delivered: { label: 'Delivered', color: '#10B981', bg: 'rgba(16,185,129,0.15)', desc: 'Your BOQ pack has been delivered.' },
};

const STEPS = ['submitted', 'in_review', 'in_progress', 'completed', 'delivered'];

export default function ProjectDetailPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null);

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
            <ClipboardIcon size={16} style={{ verticalAlign: 'middle' }} /> Variations
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

      {/* Deliverables — files the QS sends back into the customer's portal */}
      <DeliverablesPanel projectId={id} project={project} />

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
                <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleDownload(project.findings_filename, 'Findings Report')}
                  disabled={downloading === project.findings_filename}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 18px', borderRadius: 10, cursor: 'pointer',
                    background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)',
                    textAlign: 'left', flex: 1,
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
                <Link
                  to={`/project/${id}/findings`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '0 16px', borderRadius: 10,
                    background: 'rgba(59,130,246,0.12)',
                    border: '1px solid rgba(59,130,246,0.3)',
                    textDecoration: 'none', color: '#3B82F6',
                    fontWeight: 700, fontSize: 12.5,
                  }}
                >Edit ↗</Link>
                </div>
              )}

              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0', textAlign: 'center' }}>
                Need to tweak content? Use <strong>Edit</strong> beside the Findings Report or open the Builder Pack to edit the BOQ line items.
              </p>

              {/* Builder Pack — full workspace (trade rollup, schedules, client copy) lives on its own page now. */}
              {project.boq_filename && (
                <Link
                  to={`/project/${id}/builder-pack`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '14px 18px', borderRadius: 10,
                    background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(168,85,247,0.06))',
                    border: '1px solid rgba(245,158,11,0.3)',
                    textDecoration: 'none', textAlign: 'left',
                  }}
                >
                  <div style={{
                    width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                    background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                    color: '#0A0F1C', fontWeight: 800, fontSize: 13,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>BP</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                        Open Builder Pack & Client Copy
                      </span>
                      <span style={{
                        fontSize: 9.5, fontWeight: 800, letterSpacing: '0.06em',
                        padding: '2px 7px', borderRadius: 4,
                        background: 'rgba(239,68,68,0.12)', color: '#EF4444',
                        border: '1px solid rgba(239,68,68,0.3)',
                        textTransform: 'uppercase',
                      }}>Testing · Beta</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Trade rollup, materials & labour schedules, per-trade OH&P, prelims, rounding, live preview.
                    </div>
                  </div>
                  <span style={{ color: '#F59E0B', fontSize: 18, fontWeight: 700 }}>→</span>
                </Link>
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

    </div>
  );
}
