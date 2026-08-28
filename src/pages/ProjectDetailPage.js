import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import DeliverablesPanel from '../components/DeliverablesPanel';
import { ClipboardIcon } from '../components/Icons';
import PROJECT_TYPE_SUGGESTIONS from '../utils/projectTypes';
import {
  Button, Card, Badge, StatusBadge, PageHeader, EmptyState, Skeleton, useToast, Input,
} from '../ui';

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

const DownloadArrow = () => (
  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
);

// What each lifecycle state means for the customer. Labels/tones come from
// the kit's shared status map (StatusBadge); this only adds the description.
const STATUS_DESC = {
  submitted: "Your project has been received. We'll begin review shortly.",
  in_review: "We're reviewing your drawings and project brief.",
  in_progress: "Your BOQ is being prepared. We'll notify you when it's ready.",
  completed: 'Your BOQ pack is complete and ready for download.',
  delivered: 'Your BOQ pack has been delivered.',
};
const STEP_LABELS = {
  submitted: 'Submitted', in_review: 'In Review', in_progress: 'In Progress',
  completed: 'Completed', delivered: 'Delivered',
};

const STEPS = ['submitted', 'in_review', 'in_progress', 'completed', 'delivered'];

export default function ProjectDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(null);
  const [editingType, setEditingType] = useState(false);
  const [typeDraft, setTypeDraft] = useState('');
  const [savingType, setSavingType] = useState(false);

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

  // The project type is captured at submission and often lands as "Other" —
  // it prints on the client copy and on the quote / estimate, so it stays
  // editable here for as long as the project exists.
  async function saveProjectType() {
    const next = typeDraft.trim();
    if (next === (project.project_type || '')) { setEditingType(false); return; }
    setSavingType(true);
    try {
      const updated = await apiFetch(`/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ project_type: next }),
      });
      setProject((p) => ({ ...p, ...updated }));
      setEditingType(false);
      toast.success('Project type updated. Re-share the client copy to update a link your client already has.');
    } catch (err) {
      toast.error(err.message || 'Could not save the project type');
    } finally {
      setSavingType(false);
    }
  }

  async function handleDownload(filename) {
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
      toast.error('Download failed — the file may have expired. Please regenerate from the chat.');
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
        <div style={{ marginBottom: 24 }}>
          <Skeleton width={90} height={11} style={{ marginBottom: 12 }} />
          <Skeleton width="45%" height={26} style={{ marginBottom: 8 }} />
          <Skeleton width="30%" height={12} />
        </div>
        <Card style={{ marginBottom: 18 }}>
          <Card.Body>
            <Skeleton width="100%" height={64} style={{ marginBottom: 14 }} />
            <Skeleton width="60%" height={12} style={{ margin: '0 auto' }} />
          </Card.Body>
        </Card>
        <Card>
          <Card.Body>
            <Skeleton width="100%" height={56} style={{ marginBottom: 10 }} />
            <Skeleton width="100%" height={56} />
          </Card.Body>
        </Card>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="page">
        <EmptyState
          title="Project not found"
          body="It may have been deleted, or the link is out of date."
          action={<Button variant="secondary" to="/dashboard">Back to Dashboard</Button>}
        />
      </div>
    );
  }

  const currentStep = STEPS.indexOf(project.status);
  const hasDocuments = project.boq_filename || project.findings_filename;

  return (
    <div className="page">
      <PageHeader
        back={{ to: '/dashboard', label: 'All Projects' }}
        title={project.title}
        subtitle={
          [
            project.project_type,
            project.location,
            new Date(project.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
          ].filter(Boolean).join(' · ')
        }
        actions={
          <>
            <Button variant="secondary" size="sm" to={`/project/${id}/variations`}>
              <ClipboardIcon size={15} style={{ verticalAlign: 'middle' }} /> Variations
            </Button>
            <StatusBadge status={project.status} />
          </>
        }
      />

      {/* Progress tracker */}
      <Card style={{ marginBottom: 18 }}>
        <Card.Header title="Progress" />
        <Card.Body>
          <div className="progress-track">
            {STEPS.map((step, i) => {
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
                  <div className="step-label">{STEP_LABELS[step]}</div>
                </div>
              );
            })}
          </div>
          <p className="progress-desc">{STATUS_DESC[project.status] || STATUS_DESC.submitted}</p>
        </Card.Body>
      </Card>

      {/* Project type — editable: submissions often arrive as "Other" */}
      <Card style={{ marginBottom: 18 }}>
        <Card.Header title="Project type" />
        <Card.Body>
          {editingType ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Input
                type="text"
                list="project-type-suggestions"
                autoFocus
                value={typeDraft}
                onChange={(e) => setTypeDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveProjectType(); if (e.key === 'Escape') setEditingType(false); }}
                placeholder="e.g. Single-storey extension"
                style={{ flex: '1 1 220px', minWidth: 0 }}
              />
              <datalist id="project-type-suggestions">
                {PROJECT_TYPE_SUGGESTIONS.map((o) => <option key={o} value={o} />)}
              </datalist>
              <Button size="sm" onClick={saveProjectType} disabled={savingType}>
                {savingType ? 'Saving…' : 'Save'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditingType(false)} disabled={savingType}>
                Cancel
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {project.project_type || 'Not set'}
              </span>
              <Button size="sm" variant="secondary"
                onClick={() => { setTypeDraft(project.project_type || ''); setEditingType(true); }}>
                Edit
              </Button>
            </div>
          )}
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 8 }}>
            Shown on the client copy and on the quote / estimate you share.
          </div>
        </Card.Body>
      </Card>

      {/* Project description */}
      {project.description && (
        <Card style={{ marginBottom: 18 }}>
          <Card.Header title="Project Brief" />
          <Card.Body>
            <p className="project-description">{project.description}</p>
          </Card.Body>
        </Card>
      )}

      {/* Deliverables — files the QS sends back into the customer's portal */}
      <DeliverablesPanel projectId={id} project={project} />

      {/* Documents */}
      <Card style={{ marginBottom: 18 }}>
        <Card.Header title="Documents" />
        <Card.Body>
          {hasDocuments ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Summary bar */}
              {(project.total_value > 0 || project.item_count > 0) && (
                <div style={{
                  display: 'flex', gap: 24, padding: '12px 16px', flexWrap: 'wrap',
                  background: 'var(--success-bg)',
                  border: '1px solid color-mix(in srgb, var(--success) 20%, transparent)',
                  borderRadius: 10, marginBottom: 4,
                }}>
                  {project.total_value > 0 && (
                    <div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: 2 }}>Project Value</div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--success)' }}>{formatCurrency(project.total_value, project.currency)}</div>
                    </div>
                  )}
                  {project.item_count > 0 && (
                    <div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: 2 }}>Line Items</div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>{project.item_count}</div>
                    </div>
                  )}
                  {project.project_type && (
                    <div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: 2 }}>Type</div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>{project.project_type}</div>
                    </div>
                  )}
                </div>
              )}

              {/* BOQ Excel */}
              {project.boq_filename && (
                <button
                  className="ui-tile"
                  onClick={() => handleDownload(project.boq_filename)}
                  disabled={downloading === project.boq_filename}
                  style={{
                    '--tile-bg': 'var(--success-bg)',
                    '--tile-bg-hover': 'color-mix(in srgb, var(--success) 16%, transparent)',
                    '--tile-border': 'color-mix(in srgb, var(--success) 25%, transparent)',
                  }}
                >
                  <ExcelIcon />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="ui-tile__title">Bill of Quantities (Excel)</div>
                    <div className="ui-tile__meta">{project.boq_filename}</div>
                  </div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {downloading === project.boq_filename ? 'Downloading...' : <><DownloadArrow /> Download</>}
                  </div>
                </button>
              )}

              {/* Findings Report Word doc */}
              {project.findings_filename && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="ui-tile"
                    onClick={() => handleDownload(project.findings_filename)}
                    disabled={downloading === project.findings_filename}
                    style={{
                      flex: 1, width: 'auto',
                      '--tile-bg': 'var(--info-bg)',
                      '--tile-bg-hover': 'color-mix(in srgb, var(--info) 16%, transparent)',
                      '--tile-border': 'color-mix(in srgb, var(--info) 25%, transparent)',
                    }}
                  >
                    <WordIcon />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="ui-tile__title">Findings Report (Word)</div>
                      <div className="ui-tile__meta">{project.findings_filename}</div>
                    </div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--info)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {downloading === project.findings_filename ? 'Downloading...' : <><DownloadArrow /> Download</>}
                    </div>
                  </button>
                  <Link
                    to={`/project/${id}/findings`}
                    className="ui-tile"
                    style={{
                      width: 'auto', padding: '0 16px', alignSelf: 'stretch',
                      color: 'var(--info)', fontWeight: 700, fontSize: '0.8rem',
                      '--tile-bg': 'color-mix(in srgb, var(--info) 14%, transparent)',
                      '--tile-bg-hover': 'color-mix(in srgb, var(--info) 22%, transparent)',
                      '--tile-border': 'color-mix(in srgb, var(--info) 30%, transparent)',
                    }}
                  >Edit ↗</Link>
                </div>
              )}

              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '4px 0 0', textAlign: 'center' }}>
                Need to tweak content? Use <strong>Edit</strong> beside the Findings Report or open the Builder Pack to edit the BOQ line items.
              </p>

              {/* Builder Pack — full workspace (trade rollup, schedules, client copy) lives on its own page. */}
              {project.boq_filename && (
                <Link
                  to={`/project/${id}/builder-pack`}
                  className="ui-tile"
                  style={{
                    '--tile-bg': 'var(--accent-glow)',
                    '--tile-bg-hover': 'color-mix(in srgb, var(--accent) 18%, transparent)',
                    '--tile-border': 'var(--border-accent)',
                  }}
                >
                  <div style={{
                    width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                    background: 'var(--gradient-amber)',
                    color: '#0A0F1C', fontWeight: 800, fontSize: '0.82rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>BP</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                      <span className="ui-tile__title" style={{ marginBottom: 0 }}>
                        Amend numbers & generate your Client Copy
                      </span>
                      <Badge tone="accent" size="sm" outlined>New</Badge>
                    </div>
                    <div className="ui-tile__meta">
                      Adjust quantities and rates, add your margin, and download a branded copy with your logo — plus trade rollup and materials & labour schedules.
                    </div>
                  </div>
                  <span style={{ color: 'var(--accent)', fontSize: 18, fontWeight: 700 }}>→</span>
                </Link>
              )}

            </div>
          ) : (
            <EmptyState
              title="No documents yet"
              body='Open the chat for this project and say "generate documents" to create your BOQ and Findings Report.'
              action={<Button variant="soft" to="/chat">Go to Chat →</Button>}
            />
          )}
        </Card.Body>
      </Card>

    </div>
  );
}
