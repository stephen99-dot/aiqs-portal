import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import { withUserRef } from '../utils/stripeLinks';
import {
  ZapIcon, StarIcon, CrownIcon, BanIcon, ArrowRightIcon,
  UploadIcon, XIcon, CreditCardIcon, ChatIcon,
  FileTextIcon, FileSpreadsheetIcon, FileImageIcon, FileArchiveIcon, PaperclipIcon,
} from '../components/Icons';
import {
  Button, IconButton, Card, Banner, PageHeader,
  Field, Input, Select, Textarea, Modal, ProgressBar,
} from '../ui';

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

const STRIPE_PAYG_LINK = 'https://buy.stripe.com/fZu3cvebKenS2go4XW73G0g';   // £150 single BOQ
const BOQ_5_PACK_LINK = 'https://buy.stripe.com/00w7sLgjSenSdZ6aig73G0h';    // £349 5-BOQ bundle
const BOQ_10_PACK_LINK = 'https://buy.stripe.com/9B628raZy2Fa4ow62073G0f';   // £580 10-BOQ bundle
const BOQ_20_PACK_LINK = 'https://buy.stripe.com/cNi4gz6Ji4Ni3ks2PO73G0l';   // £980 20-BOQ bundle

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

// One buy-more option row inside the limit modal: icon chip, label, price pill.
// The gradient price pills are bespoke brand accents, deliberately kept inline.
function OfferRow({ href, icon, iconBg, tintBg, tintBorder, title, subtitle, price, priceBg, priceColor }) {
  return (
    <a
      href={href}
      target={href.startsWith('mailto:') ? undefined : '_blank'}
      rel={href.startsWith('mailto:') ? undefined : 'noopener noreferrer'}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px', borderRadius: 10,
        background: tintBg,
        border: '1px solid ' + tintBorder,
        textDecoration: 'none', transition: 'all 0.12s',
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{subtitle}</div>
      </div>
      {price && (
        <span style={{
          padding: '5px 12px', borderRadius: 7,
          background: priceBg, color: priceColor,
          fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap',
        }}>{price}</span>
      )}
    </a>
  );
}

function LimitReachedModal({ usage, user, onClose }) {
  return (
    <Modal title="Monthly Limit Reached" onClose={onClose}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14, margin: '0 auto 14px',
          background: 'var(--danger-bg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <BanIcon size={24} color="var(--danger)" />
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
          You've used all <strong style={{ color: 'var(--text-primary)' }}>{usage.quota}</strong> projects
          included in your <strong style={{ color: 'var(--text-primary)' }}>{usage.planLabel}</strong> plan this month.
        </p>
      </div>

      <div style={{ background: 'var(--surface-hover)', borderRadius: 9, padding: '12px 16px', marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Usage this month</span>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--danger)' }}>{usage.used} / {usage.quota}</span>
        </div>
        <ProgressBar value={100} tone="danger" height={6} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
        {/* Buy Extra Project — always shown */}
        <OfferRow
          href={withUserRef(STRIPE_PAYG_LINK, user)}
          icon={<ZapIcon size={18} color="#10B981" />}
          iconBg="rgba(16,185,129,0.08)"
          tintBg="rgba(16,185,129,0.04)" tintBorder="rgba(16,185,129,0.15)"
          title="Buy Extra Project" subtitle="One-off project — processed within 2 hours"
          price="£150" priceBg="linear-gradient(135deg, #10B981, #059669)" priceColor="#fff"
        />

        {/* 5-BOQ bundle */}
        <OfferRow
          href={withUserRef(BOQ_5_PACK_LINK, user)}
          icon={<StarIcon size={18} color="#F59E0B" />}
          iconBg="rgba(245,158,11,0.08)"
          tintBg="rgba(245,158,11,0.04)" tintBorder="rgba(245,158,11,0.15)"
          title="5 BOQ Bundle" subtitle="Just £69.80 per BOQ — credits never expire"
          price="£349" priceBg="linear-gradient(135deg, #F59E0B, #D97706)" priceColor="#0A0F1C"
        />

        {/* 10-BOQ bundle */}
        <OfferRow
          href={withUserRef(BOQ_10_PACK_LINK, user)}
          icon={<CrownIcon size={18} color="#A855F7" />}
          iconBg="rgba(124,58,237,0.08)"
          tintBg="linear-gradient(135deg, rgba(124,58,237,0.06), rgba(124,58,237,0.03))"
          tintBorder="rgba(124,58,237,0.15)"
          title="10 BOQ Bundle" subtitle="Just £58 per BOQ — credits never expire"
          price="£580" priceBg="linear-gradient(135deg, #7C3AED, #6D28D9)" priceColor="#fff"
        />

        {/* 20-BOQ bundle */}
        <OfferRow
          href={withUserRef(BOQ_20_PACK_LINK, user)}
          icon={<CrownIcon size={18} color="#10B981" />}
          iconBg="rgba(16,185,129,0.08)"
          tintBg="linear-gradient(135deg, rgba(16,185,129,0.06), rgba(16,185,129,0.03))"
          tintBorder="rgba(16,185,129,0.15)"
          title="20 BOQ Bundle" subtitle="Best value — just £49 per BOQ, credits never expire"
          price="£980" priceBg="linear-gradient(135deg, #10B981, #059669)" priceColor="#fff"
        />

        {/* Contact */}
        <OfferRow
          href="mailto:hello@crmwizardai.com?subject=AI%20QS%20-%20Extra%20Projects"
          icon={<ChatIcon size={18} color="var(--text-muted)" />}
          iconBg="var(--surface-hover)"
          tintBg="transparent" tintBorder="var(--border)"
          title="Need a Custom Arrangement?" subtitle="Get in touch — we'll sort something out"
        />
      </div>

      <Button variant="secondary" full onClick={onClose}>Go Back to Dashboard</Button>
    </Modal>
  );
}

export default function NewProjectPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
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
        <LimitReachedModal usage={usage} user={user} onClose={() => { setShowLimitModal(false); if (usage.atLimit) navigate('/dashboard'); }} />
      )}

      <PageHeader
        title="New Project"
        subtitle="Upload your drawings and tell us about the job"
      />

      {isPayg && (
        <Banner tone="accent" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 12, padding: '14px 18px', marginBottom: 18,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 9,
              background: 'var(--accent-glow)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CreditCardIcon size={16} color="var(--accent)" />
            </div>
            <div>
              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>Pay As You Go — £150 per project</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>You'll be taken to Stripe to pay after submitting</div>
            </div>
          </div>
        </Banner>
      )}

      {usage && !usage.isPayg && !usage.atLimit && (
        <Card style={{ marginBottom: 18 }}>
          <Card.Body style={{
            padding: '10px 16px', fontSize: '0.8rem', color: 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <UploadIcon size={14} color="var(--text-muted)" />
            <span>
              <strong style={{ color: 'var(--text-primary)' }}>{usage.used}</strong> of <strong style={{ color: 'var(--text-primary)' }}>{usage.quota}</strong> projects used
              — <strong style={{ color: usage.remaining <= 2 ? 'var(--warning)' : 'var(--success)' }}>{usage.remaining} remaining</strong>
            </span>
          </Card.Body>
        </Card>
      )}

      <form onSubmit={handleSubmit}>
        {error && (
          <Banner tone="danger" style={{ color: 'var(--danger)', fontSize: '0.86rem' }}>
            {error}
          </Banner>
        )}

        <Card style={{ marginBottom: 16 }}>
          <Card.Header title="Project Details" />
          <Card.Body>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <Field label="Project Title *" style={{ flex: '1 1 240px' }}>
                <Input type="text" value={form.title} onChange={e => updateField('title', e.target.value)}
                  placeholder="e.g. Two-storey rear extension — 14 Oak Lane" required />
              </Field>
              <Field label="Project Type *" style={{ flex: '1 1 240px' }}>
                <Select value={form.projectType} onChange={e => updateField('projectType', e.target.value)} required>
                  <option value="">Select type...</option>
                  {PROJECT_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Location" style={{ marginTop: 14 }}>
              <Input type="text" value={form.location} onChange={e => updateField('location', e.target.value)}
                placeholder="e.g. Cardiff, South Wales" />
            </Field>
            <Field label="Project Brief / Notes" style={{ marginTop: 14 }}>
              <Textarea value={form.description} onChange={e => updateField('description', e.target.value)}
                placeholder="Tell us about the project — scope, spec requirements, anything we should know." rows={5} />
            </Field>
          </Card.Body>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <Card.Header
            title="Upload Drawings"
            extra="PDF, DWG, DXF, images, Excel, Word, ZIP — up to 50MB each"
          />
          <Card.Body>
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
                        background: 'var(--surface-hover)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <IconComp size={14} color="var(--text-muted)" />
                      </div>
                      <div className="file-info">
                        <div className="file-name">{file.name}</div>
                        <div className="file-size">{formatFileSize(file.size)}</div>
                      </div>
                      <IconButton onClick={() => removeFile(i)} aria-label="Remove file" title="Remove file">
                        <XIcon size={14} />
                      </IconButton>
                    </div>
                  );
                })}
              </div>
            )}
          </Card.Body>
        </Card>

        <div className="form-actions">
          <Button variant="secondary" onClick={() => navigate('/dashboard')}>Cancel</Button>
          <Button type="submit" disabled={submitting || (usage && usage.atLimit)}>
            {submitting ? (
              <><span className="loading-spinner small" />{isPayg ? 'Saving...' : 'Uploading...'}</>
            ) : usage && usage.atLimit ? (
              <><BanIcon size={14} color="currentColor" /> Limit Reached</>
            ) : isPayg ? (
              <>Submit & Pay £150 <ArrowRightIcon size={14} color="currentColor" /></>
            ) : (
              <>Submit Project <ArrowRightIcon size={14} color="currentColor" /></>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
