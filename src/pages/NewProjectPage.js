import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';

const PROJECT_TYPES = [
  'Residential Extension',
  'New Build Housing',
  'Loft Conversion',
  'Refurbishment',
  'Commercial Fit-Out',
  'Structural Steelwork',
  'Metalwork / Fabrication',
  'Heritage / Conversion',
  'Other',
];

export default function NewProjectPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({
    title: '',
    projectType: '',
    location: '',
    description: '',
  });
  const [files, setFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function updateField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function handleFiles(fileList) {
    const newFiles = Array.from(fileList);
    setFiles(prev => [...prev, ...newFiles]);
  }

  function removeFile(index) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  function handleDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = {
      pdf: '📄', dwg: '📐', dxf: '📐',
      png: '🖼️', jpg: '🖼️', jpeg: '🖼️',
      xlsx: '📊', docx: '📝', zip: '📦',
    };
    return icons[ext] || '📎';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!form.title || !form.projectType) {
      setError('Please fill in the project title and type.');
      return;
    }

    if (files.length === 0) {
      setError('Please upload at least one drawing or document.');
      return;
    }

    setSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('title', form.title);
      formData.append('projectType', form.projectType);
      formData.append('location', form.location);
      formData.append('description', form.description);
      files.forEach(file => formData.append('drawings', file));

      const project = await apiFetch('/projects', {
        method: 'POST',
        body: formData,
      });

      navigate(`/project/${project.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">New Project</h1>
          <p className="page-subtitle">Upload your drawings and tell us about the job</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="section-card">
          <div className="section-card-header">
            <h2>Project Details</h2>
          </div>
          <div className="card-body">
            <div className="form-row">
              <div className="form-field">
                <label>Project Title *</label>
                <input
                  type="text" value={form.title}
                  onChange={e => updateField('title', e.target.value)}
                  placeholder="e.g. Two-storey rear extension — 14 Oak Lane"
                  required
                />
              </div>
              <div className="form-field">
                <label>Project Type *</label>
                <select value={form.projectType} onChange={e => updateField('projectType', e.target.value)} required>
                  <option value="">Select type...</option>
                  {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="form-field">
              <label>Location</label>
              <input
                type="text" value={form.location}
                onChange={e => updateField('location', e.target.value)}
                placeholder="e.g. Cardiff, South Wales"
              />
            </div>
            <div className="form-field">
              <label>Project Brief / Notes</label>
              <textarea
                value={form.description}
                onChange={e => updateField('description', e.target.value)}
                placeholder="Tell us about the project — scope, spec requirements, anything we should know. The more detail the better."
                rows={5}
              />
            </div>
          </div>
        </div>

        <div className="section-card">
          <div className="section-card-header">
            <h2>Upload Drawings</h2>
            <span className="header-hint">PDF, DWG, DXF, images, Excel, Word, ZIP — up to 50MB each</span>
          </div>
          <div className="card-body">
            {/* Drop zone */}
            <div
              className={`drop-zone ${dragActive ? 'active' : ''}`}
              onDragEnter={handleDrag} onDragOver={handleDrag}
              onDragLeave={handleDrag} onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef} type="file" multiple
                onChange={e => handleFiles(e.target.files)}
                style={{ display: 'none' }}
                accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg,.xlsx,.docx,.zip"
              />
              <div className="drop-icon">
                <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.2">
                  <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                </svg>
              </div>
              <p className="drop-text">Drag & drop your files here, or <span>browse</span></p>
              <p className="drop-hint">Plans, elevations, sections, specs — whatever you've got</p>
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="file-list">
                {files.map((file, i) => (
                  <div key={i} className="file-item">
                    <span className="file-icon">{getFileIcon(file.name)}</span>
                    <div className="file-info">
                      <div className="file-name">{file.name}</div>
                      <div className="file-size">{formatFileSize(file.size)}</div>
                    </div>
                    <button type="button" className="file-remove" onClick={() => removeFile(i)}>
                      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={() => navigate('/dashboard')}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? (
              <>
                <span className="loading-spinner small" />
                Uploading...
              </>
            ) : (
              <>
                Submit Project
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
