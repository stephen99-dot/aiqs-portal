import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, getToken, getEstimatorKey } from '../utils/api';
import compressImage from '../utils/compressImage';

// B4 — the photo strip. On the job page it manages a job's photos (add from
// the phone camera, view, delete). On a change/quote editor pass `attachTo`
// and tapping a photo toggles whether it prints on that document's PDF.
// Images are auth-gated, so thumbnails load as blobs (same pattern as the
// branding logo preview).

export default function JobPhotos({ t, jobId, attachTo }) {
  const [photos, setPhotos] = useState([]);
  const [thumbs, setThumbs] = useState({});      // photoId -> object URL
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState(null);    // photo being viewed full-size
  const [attaching, setAttaching] = useState(null); // photo id whose attach PATCH is in flight

  const authHeaders = useCallback(() => ({
    Authorization: 'Bearer ' + getToken(),
    'x-estimator-key': getEstimatorKey(),
  }), []);

  const load = useCallback(async () => {
    if (!jobId) return;
    try {
      const r = await apiFetch('/job-photos?job_id=' + jobId);
      setPhotos(r.photos || []);
    } catch (e) { /* photos are never worth blocking the page for */ }
  }, [jobId]);
  useEffect(() => { load(); }, [load]);

  // Fetch thumbnails as blobs (auth headers can't ride on <img src>).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of photos) {
        if (thumbs[p.id]) continue;
        try {
          const resp = await fetch('/api/job-photos/' + p.id + '/file', { headers: authHeaders() });
          if (!resp.ok) continue;
          const url = URL.createObjectURL(await resp.blob());
          if (cancelled) { URL.revokeObjectURL(url); return; }
          setThumbs(prev => ({ ...prev, [p.id]: url }));
        } catch (e) {}
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [photos]);

  const addPhotos = async (fileList) => {
    if (uploading) return;
    const files = Array.from(fileList || []).filter(f => f && /^image\//.test(f.type || ''));
    if (files.length === 0) return;
    setUploading(true); setError('');
    try {
      for (const file of files) {
        const compressed = await compressImage(file);
        const fd = new FormData();
        fd.append('photo', compressed, compressed.name || 'photo.jpg');
        fd.append('job_id', jobId);
        if (attachTo?.kind === 'variation') fd.append('variation_id', attachTo.id);
        if (attachTo?.kind === 'quote') fd.append('quote_id', attachTo.id);
        const resp = await fetch('/api/job-photos', { method: 'POST', headers: authHeaders(), body: fd });
        if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || 'Upload failed');
      }
      await load();
    } catch (e) { setError(e.message); }
    finally { setUploading(false); }
  };

  const isAttached = (p) => attachTo
    ? (attachTo.kind === 'variation' ? p.variation_id === attachTo.id : p.quote_id === attachTo.id)
    : false;

  const toggleAttach = async (p) => {
    if (attaching) return;
    const key = attachTo.kind === 'variation' ? 'variation_id' : 'quote_id';
    setAttaching(p.id);
    try {
      await apiFetch('/job-photos/' + p.id, {
        method: 'PATCH',
        body: JSON.stringify({ [key]: isAttached(p) ? null : attachTo.id }),
      });
      await load();
    } catch (e) { setError(e.message); }
    finally { setAttaching(null); }
  };

  const remove = async (p) => {
    if (!window.confirm('Delete this photo?')) return;
    try {
      await apiFetch('/job-photos/' + p.id, { method: 'DELETE' });
      setViewer(null);
      await load();
    } catch (e) { setError(e.message); }
  };

  return (
    <div>
      {error && <div style={{ color: t.danger, fontSize: 13, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
        {/* Two ways in: the camera (one shot), or the photo library (as many
            as you like). `capture` jumps straight to the camera on phones, so
            it gets its own tile rather than blocking gallery picks. */}
        <label style={{
          flexShrink: 0, width: 96, height: 96, borderRadius: 12, cursor: 'pointer',
          border: '2px dashed ' + t.border, color: t.textSecondary,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 600, textAlign: 'center', gap: 4,
          pointerEvents: uploading ? 'none' : 'auto', opacity: uploading ? 0.6 : 1,
        }}>
          <span style={{ fontSize: 22 }}>📷</span>
          {uploading ? 'Saving…' : 'Take a photo'}
          <input
            type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={uploading}
            onChange={e => { addPhotos(e.target.files); e.target.value = ''; }}
          />
        </label>
        <label style={{
          flexShrink: 0, width: 96, height: 96, borderRadius: 12, cursor: 'pointer',
          border: '2px dashed ' + t.border, color: t.textSecondary,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 600, textAlign: 'center', gap: 4,
          pointerEvents: uploading ? 'none' : 'auto', opacity: uploading ? 0.6 : 1,
        }}>
          <span style={{ fontSize: 22 }}>🖼️</span>
          {uploading ? 'Saving…' : 'Add photos'}
          <input
            type="file" accept="image/*" multiple style={{ display: 'none' }} disabled={uploading}
            onChange={e => { addPhotos(e.target.files); e.target.value = ''; }}
          />
        </label>

        {photos.map(p => (
          <button
            key={p.id}
            onClick={() => attachTo ? toggleAttach(p) : setViewer(p)}
            disabled={attachTo && attaching === p.id}
            style={{
              flexShrink: 0, width: 96, height: 96, borderRadius: 12, padding: 0,
              cursor: 'pointer', position: 'relative', overflow: 'hidden',
              border: attachTo && isAttached(p) ? '3px solid ' + t.success : '1px solid ' + t.border,
              background: t.surface,
              opacity: attachTo && attaching === p.id ? 0.6 : 1,
            }}
          >
            {thumbs[p.id]
              ? <img src={thumbs[p.id]} alt={p.caption || 'Site photo'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ color: t.textMuted, fontSize: 11 }}>…</span>}
            {attachTo && isAttached(p) && (
              <span style={{
                position: 'absolute', top: 4, right: 4, background: t.success, color: '#fff',
                borderRadius: 999, width: 22, height: 22, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 13, fontWeight: 700,
              }}>✓</span>
            )}
          </button>
        ))}
      </div>

      {attachTo && photos.length > 0 && (
        <div style={{ color: t.textMuted, fontSize: 12, marginTop: 6 }}>
          Tap a photo to include it — ticked ones print on the PDF.
        </div>
      )}

      {/* Full-size viewer */}
      {viewer && (
        <div onClick={() => setViewer(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.85)', zIndex: 1000,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          {thumbs[viewer.id]
            ? <img
                src={thumbs[viewer.id]} alt={viewer.caption || 'Site photo'}
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: 12, objectFit: 'contain' }}
              />
            : <span onClick={e => e.stopPropagation()} style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>Loading…</span>}
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={() => remove(viewer)} style={{
              minHeight: 48, padding: '0 20px', borderRadius: 12, border: 'none',
              background: '#EF4444', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}>Delete</button>
            <button onClick={() => setViewer(null)} style={{
              minHeight: 48, padding: '0 20px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.4)',
              background: 'transparent', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
