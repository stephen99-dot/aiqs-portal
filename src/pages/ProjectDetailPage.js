import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';

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
  const fileInputRef = useRef(null);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadProject();
  }, [id]); // eslint-disable-line

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

  async function handleUploadMore(e) {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach(f => formData.append('drawings', f));
      await apiFetch(`/projects/${id}/files`, { method: 'POST', body: formData });
      await loadProject();
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  }

  function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getFileIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    const icons = { pdf: '📄', dwg: '📐', dxf: '📐', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', xlsx: '📊', docx: '📝', zip: '📦' };
    return icons[ext] || '📎';
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
        <span className="status-badge large" style={{ color: status.color, background: status.bg }}>
          {status.label}
        </span>
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

      {/* Files */}
      <div className="section-card">
        <div className="section-card-header">
          <h2>Uploaded Files</h2>
          <button
            className="btn-small"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading...' : '+ Add Files'}
          </button>
          <input
            ref={fileInputRef} type="file" multiple
            onChange={handleUploadMore}
            style={{ display: 'none' }}
            accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg,.xlsx,.docx,.zip"
          />
        </div>
        <div className="card-body">
          {project.files?.length > 0 ? (
            <div className="file-list">
              {project.files.map(file => (
                <div key={file.id} className="file-item">
                  <span className="file-icon">{getFileIcon(file.original_name)}</span>
                  <div className="file-info">
                    <div className="file-name">{file.original_name}</div>
                    <div className="file-size">
                      {formatFileSize(file.file_size)}
                      {' · '}
                      {new Date(file.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted">No files uploaded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
