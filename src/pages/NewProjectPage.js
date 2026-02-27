import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';
import {
  ZapIcon, StarIcon, CrownIcon, BanIcon, ArrowRightIcon,
  UploadIcon, XIcon, CreditCardIcon, ChatIcon,
  FileTextIcon, FileSpreadsheetIcon, FileImageIcon, FileArchiveIcon, PaperclipIcon,
} from '../components/Icons';

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

const STRIPE_PAYG_LINK = 'https://buy.stripe.com/7sY00j1oY4Ni5sAcqo73G01';

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    pdf: FileTextIcon, dwg: FileTextIcon, dxf: FileTextIcon,
    png: FileImageIcon, jpg: FileImageIcon, jpeg: FileImageIcon,
    xlsx: FileSpreadsheetIcon, xls: FileSpreadsheetIcon, csv: FileSpreadsheetIcon,
    docx: FileTextIcon, doc: FileTextIcon,
    zip: FileArchiveIcon, rar: FileArchiveIcon,
  };
  return map[ext] || PaperclipIcon;
}

function LimitReachedModal({ usage, t, onClose }) {
  const isSubscriber = usage.plan === 'professional' || usage.plan === 'premium';
  const isProfessional = usage.plan === 'professional';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }} onClick={onClose}>
      <div style={{
        background: t.card, border: `1px solid ${t.border}`,
        borderRadius: 16, padding: '32px 28px',
        maxWidth: 500, width: '100%',
        boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, margin: '0 auto 14px',
            background: 'rgba(239,68,68,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BanIcon size={24} color="#EF4444" />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: t.text, margin: '0 0 6px', fontFamily: "'DM Serif Display', Georgia, serif" }}>Monthly Limit Reached</h2>
          <p style={{ fontSize: 13, color: t.textMuted, margin: 0, lineHeight: 1.6 }}>
            You've used all <strong style={{ color: t.text }}>{usage.quota}</strong> projects
            included in your <strong style={{ color: t.text }}>{usage.planLabel}</strong> plan this month.
          </p>
        </div>

        <div style={{ background: t.surfaceHover, borderRadius: 9, padding: '12px 16px', marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 11.5, color: t.textMuted }}>Usage this month</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#EF4444' }}>{usage.used} / {usage.quota}</span>
          </div>
          <div style={{ width: '100%', height: 6, borderRadius: 5, background: t.border }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 5, background: '#EF4444' }} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>

          {/* Buy Extra Project — always shown */}
          <a
            href={isSubscriber ? "https://buy.stripe.com/28E8wPd7Ggw0f3abmk73G06" : "https://buy.stripe.com/7sY00j1oY4Ni5sAcqo73G01"}
            target="_blank" rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 16px', borderRadius: 10,
              background: 'rgba(16,185,129,0.04)',
              border: '1px solid rgba(16,185,129,0.15)',
              textDecoration: 'none', transition: 'all 0.12s',
            }}
          >
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: 'rgba(16,185,129,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <ZapIcon size={18} color="#10B981" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>Buy Extra Project</div>
              <div style={{ fontSize: 11.5, color: t.textMuted }}>One-off project — processed within 2 hours</div>
            </div>
            <span style={{
              padding: '5px 12px', borderRadius: 7,
              background: 'linear-gradient(135deg, #10B981, #059669)',
              color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
            }}>
              {isSubscriber ? '£79' : '£99'}
            </span>
          </a>

          {/* Go Professional — show for non-subscribers */}
          {!isSubscriber && (
            <a href="https://buy.stripe.com/dRmfZh9VucfK5sA0HG73G04" target="_blank" rel="noopener noreferrer" style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 16px', borderRadius: 10,
              background: 'rgba(245,158,11,0.04)',
              border: '1px solid rgba(245,158,11,0.15)',
              textDecoration: 'none', transition: 'all 0.12s',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: 'rgba(245,158,11,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <StarIcon size={18} color="#F59E0B" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>Go Professional</div>
                <div style={{ fontSize: 11.5, color: t.textMuted }}>10 projects/month — save up to 65%</div>
              </div>
              <span style={{
                padding: '5px 12px', borderRadius: 7,
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                color: '#0A0F1C', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
              }}>£347/mo</span>
            </a>
          )}

          {/* Upgrade to Premium — show for professional users */}
          {isProfessional && (
            <a href="https://buy.stripe.com/6oUaEX6Ji2FaaMU76473G05" target="_blank" rel="noopener noreferrer" style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 16px', borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(124,58,237,0.03))',
              border: '1px solid rgba(124,58,237,0.15)',
              textDecoration: 'none', transition: 'all 0.12s',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: 'rgba(124,58,237,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <CrownIcon size={18} color="#A855F7" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>Upgrade to Premium</div>
                <div style={{ fontSize: 11.5, color: t.textMuted }}>20 projects/month + dedicated support</div>
              </div>
              <span style={{
                padding: '5px 12px', borderRadius: 7,
                background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
                color: '#fff', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
              }}>£447/mo</span>
            </a>
          )}

          {/* Contact */}
          <a href="mailto:hello@crmwizardai.com?subject=AI%20QS%20-%20Extra%20Projects" style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 16px', borderRadius: 10,
            background: 'transparent',
            border: `1px solid ${t.border}`,
            textDecoration: 'none', transition: 'all 0.12s',
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: t.surfaceHover,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <ChatIcon size={18} color={t.textMuted} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: t.text }}>Need a Custom Arrangement?</div>
              <div style={{ fontSize: 11.5, color: t.textMuted }}>Get in touch — we'll sort something out</div>
            </div>
          </a>
        </div>

        <button onClick={onClose} style={{
          width: '100%', padding: '10px 18px', borderRadius: 8,
          background: 'transparent', border: `1px solid ${t.border}`,
          color: t.textSecondary, fontSize: 13, fontWeight: 500, cursor: 'pointer',
        }}>Go Back to Dashboard</button>
      </div>
    </div>
  );
}

export default function NewProjectPage() {
  const navigate = useNavigate();
  const { t } = useTheme();
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({ title: '', projectType: '', location: '', description: '' });
  const [files, setFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState(null);
  const [showLimitModal, setShowLimitModal] = useState(false);

  useEffect(() => {
    apiFetch('/usage')
      .then(data => {
        setUsage(data);
        if (data.atLimit) setShowLimitModal(true);
      })
      .catch(console.error);
  }, []);

  function updateField(field, value) { setForm(prev => ({ ...prev, [field]: value })); }
  function handleFiles(fileList) { setFiles(prev => [...prev, ...Array.from(fileList)]); }
  function removeFile(index) { setFiles(prev => prev.filter((_, i) => i !== index)); }
  function handleDrag(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }
  function handleDrop(e) {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (usage && usage.atLimit) { setShowLimitModal(true); return; }
    if (!form.title || !form.projectType) { setError('Please fill in the project title and type.'); return; }
    if (files.length === 0) { setError('Please upload at least one drawing or document.'); return; }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('title', form.title);
      formData.append('projectType', form.projectType);
      formData.append('location', form.location);
      formData.append('description', form.description);
      if (usage && usage.isPayg) formData.append('payg', 'true');
      files.forEach(file => formData.append('drawings', file));

      const project = await apiFetch('/projects', { method: 'POST', body: formData });

      if (usage && usage.isPayg && project.status === 'awaiting_payment') {
        localStorage.setItem('aiqs_pending_project', project.id);
        window.location.href = STRIPE_PAYG_LINK;
        return;
      }
      navigate(`/project/${project.id}`);
    } catch (err) {
      if (err.message === 'Monthly project limit reached') {
        try { const freshUsage = await apiFetch('/usage'); setUsage(freshUsage); } catch (_) {}
        setShowLimitModal(true);
      } else {
        setError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const isPayg = usage && usage.isPayg;

  return (
    <div className="page">
      {showLimitModal && usage && (
        <LimitReachedModal usage={usage} t={t} onClose={() => { setShowLimitModal(false); if (usage.atLimit) navigate('/dashboard'); }} />
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">New Project</h1>
          <p className="page-subtitle">Upload your drawings and tell us about the job</p>
        </div>
      </div>

      {isPayg && (
        <div style={{
          background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.15)',
          borderRadius: 10, padding: '14px 18px', marginBottom: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 9,
              background: 'rgba(245,158,11,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CreditCardIcon size={16} color="#F59E0B" />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Pay As You Go — £99 per project</div>
              <div style={{ fontSize: 11.5, color: t.textMuted }}>You'll be taken to Stripe to pay after submitting</div>
            </div>
          </div>
        </div>
      )}

      {usage && !usage.isPayg && !usage.atLimit && (
        <div style={{
          background: t.card, border: `1px solid ${t.border}`, borderRadius: 9,
          padding: '10px 16px', marginBottom: 18, fontSize: 12.5, color: t.textSecondary,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <UploadIcon size={14} color={t.textMuted} />
          <span>
            <strong style={{ color: t.text }}>{usage.used}</strong> of <strong style={{ color: t.text }}>{usage.quota}</strong> projects used
            — <strong style={{ color: usage.remaining <= 2 ? '#F59E0B' : '#10B981' }}>{usage.remaining} remaining</strong>
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="section-card">
          <div className="section-card-header"><h2>Project Details</h2></div>
          <div className="card-body">
            <div className="form-row">
              <div className="form-field">
                <label>Project Title *</label>
                <input type="text" value={form.title} onChange={e => updateField('title', e.target.value)}
                  placeholder="e.g. Two-storey rear extension — 14 Oak Lane" required />
              </div>
              <div className="form-field">
                <label>Project Type *</label>
                <select value={form.projectType} onChange={e => updateField('projectType', e.target.value)} required>
                  <option value="">Select type...</option>
                  {PROJECT_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                </select>
              </div>
            </div>
            <div className="form-field" style={{ marginTop: 14 }}>
              <label>Location</label>
              <input type="text" value={form.location} onChange={e => updateField('location', e.target.value)}
                placeholder="e.g. Cardiff, South Wales" />
            </div>
            <div className="form-field" style={{ marginTop: 14 }}>
              <label>Project Brief / Notes</label>
              <textarea value={form.description} onChange={e => updateField('description', e.target.value)}
                placeholder="Tell us about the project — scope, spec requirements, anything we should know." rows={5} />
            </div>
          </div>
        </div>

        <div className="section-card">
          <div className="section-card-header">
            <h2>Upload Drawings</h2>
            <span className="header-hint">PDF, DWG, DXF, images, Excel, Word, ZIP — up to 50MB each</span>
          </div>
          <div className="card-body">
            <div className={`drop-zone ${dragActive ? 'active' : ''}`}
              onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}>
              <input ref={fileInputRef} type="file" multiple onChange={e => handleFiles(e.target.files)}
                style={{ display: 'none' }} accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg,.xlsx,.docx,.zip" />
              <div className="drop-icon">
                <UploadIcon size={36} color="currentColor" />
              </div>
              <p className="drop-text">Drag & drop your files here, or <span>browse</span></p>
              <p className="drop-hint">Plans, elevations, sections, specs — whatever you've got</p>
            </div>
            {files.length > 0 && (
              <div className="file-list">
                {files.map((file, i) => {
                  const IconComp = getFileIcon(file.name);
                  return (
                    <div key={i} className="file-item">
                      <div style={{
                        width: 30, height: 30, borderRadius: 7,
                        background: t.surfaceHover,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <IconComp size={14} color={t.textMuted} />
                      </div>
                      <div className="file-info">
                        <div className="file-name">{file.name}</div>
                        <div className="file-size">{formatFileSize(file.size)}</div>
                      </div>
                      <button type="button" className="file-remove" onClick={() => removeFile(i)}>
                        <XIcon size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={() => navigate('/dashboard')}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={submitting || (usage && usage.atLimit)}>
            {submitting ? (
              <><span className="loading-spinner small" />{isPayg ? 'Saving...' : 'Uploading...'}</>
            ) : usage && usage.atLimit ? (
              <><BanIcon size={14} color="#0A0F1C" /> Limit Reached</>
            ) : isPayg ? (
              <>Submit & Pay £99 <ArrowRightIcon size={14} color="#0A0F1C" /></>
            ) : (
              <>Submit Project <ArrowRightIcon size={14} color="#0A0F1C" /></>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
