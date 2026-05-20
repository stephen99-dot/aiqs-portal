import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { apiFetch } from '../../utils/api';
import { useTheme } from '../../context/ThemeContext';

// Smart redirects for the old routes. Bookmarks and emails out in the wild
// keep working — they just land in the new Job Workspace shell.

// /finance/jobs/:id            -> /office/jobs/:id/overview
// /change-orders/:id           -> /office/jobs/:jobId/variations  (look up jobId by variation)
// /invoices/:id                -> /office/jobs/:jobId/invoices    (look up jobId by invoice)
// /documents/:id               -> /office/jobs/:jobId/documents   (or settings/templates if unattached)
// /estimator/quote/:id         -> /office/jobs/:jobId/estimate    (look up jobId by quote)

function Spinner() {
  const { t } = useTheme();
  return <div style={{ padding: 40, textAlign: 'center', color: t.textSecondary }}>Redirecting…</div>;
}

export function RedirectVariation() {
  const { id } = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  useEffect(() => {
    apiFetch('/change-orders/' + id)
      .then(r => {
        const jobId = r.variation?.job_id;
        if (jobId) nav('/office/jobs/' + jobId + '/variations', { replace: true });
        else nav('/office/jobs', { replace: true });
      })
      .catch(e => setErr(e.message));
  }, [id, nav]);
  return err ? <div style={{ padding: 40 }}>{err}</div> : <Spinner />;
}

export function RedirectInvoice() {
  const { id } = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  useEffect(() => {
    apiFetch('/invoices/' + id)
      .then(r => {
        const jobId = r.invoice?.job_id;
        if (jobId) nav('/office/jobs/' + jobId + '/invoices', { replace: true });
        else nav('/office/jobs', { replace: true });
      })
      .catch(e => setErr(e.message));
  }, [id, nav]);
  return err ? <div style={{ padding: 40 }}>{err}</div> : <Spinner />;
}

export function RedirectQuote() {
  const { id } = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  useEffect(() => {
    apiFetch('/estimator/quotes/' + id)
      .then(r => {
        const jobId = r.quote?.job_id;
        if (jobId) nav('/office/jobs/' + jobId + '/estimate', { replace: true });
        else nav('/office/jobs', { replace: true });
      })
      .catch(e => setErr(e.message));
  }, [id, nav]);
  return err ? <div style={{ padding: 40 }}>{err}</div> : <Spinner />;
}

export function RedirectDocument() {
  const { id } = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  useEffect(() => {
    apiFetch('/documents/' + id)
      .then(r => {
        const jobId = r.document?.job_id;
        if (jobId) nav('/office/jobs/' + jobId + '/documents', { replace: true });
        else nav('/office/settings/templates', { replace: true });
      })
      .catch(e => setErr(e.message));
  }, [id, nav]);
  return err ? <div style={{ padding: 40 }}>{err}</div> : <Spinner />;
}

// Simple path-mapping redirects (no API call needed).
export function RedirectJob() {
  const { id } = useParams();
  return <Navigate to={'/office/jobs/' + id + '/overview'} replace />;
}
