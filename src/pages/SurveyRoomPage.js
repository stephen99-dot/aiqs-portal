import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { apiFetch, apiUpload, resolveUrl } from '../utils/api';
import compressImage from '../utils/compressImage';
import downloadFile from '../utils/downloadFile';
import useIsMobile from '../utils/useIsMobile';
import useMaxVoice from '../hooks/useMaxVoice';
import { fmtMoney2 } from '../utils/max';
import { lidarStatus, scanRoom } from '../native/roomScan';
import { Button, Badge, Modal, Input, Field, EmptyState, SkeletonCard, useToast } from '../ui';
import {
  CameraIcon, ImageIcon, ScanIcon, MeasureIcon, DoorIcon, SparklesIcon, PoundIcon, MicIcon, MicOffIcon, PlusIcon, TrashIcon,
  CheckIcon, XIcon, AlertTriangleIcon, ArrowLeftIcon, ArrowRightIcon, FileTextIcon, LayersIcon, UploadIcon, InfoIcon, EditIcon,
  OrbitIcon, ClipboardIcon, BoltIcon, PaletteIcon, MessageIcon, ExternalLinkIcon, LightbulbIcon,
} from '../components/Icons';
import RoomPlanSketch from '../components/survey/RoomPlanSketch';
import PhotoLightbox from '../components/survey/PhotoLightbox';
import BeforeAfter from '../components/survey/BeforeAfter';
import { quantities, wallsOf, sceneOf, SOURCE_LABEL, SOURCE_TONE, ROOM_TYPES, FLOOR_LEVELS, QUICK_FEATURES, HAZARD_PRESETS, OPENING_DEFAULTS, num } from '../utils/surveyGeometry';

const Room3D = React.lazy(() => import('../components/survey/Room3D'));

// ═══ One room: capture it, measure it, say what's wanted, survey and price ══
// Everything saves as it is typed (a short debounce, one PATCH per burst).
// On a phone the page is a four-step flow — Photos, Size, Details, Work —
// with Review at the end; on a desktop it is all on one screen with the
// sketch, the quantities and the actions pinned on the right.

const STEPS = [
  { key: 'photos', label: 'Photos', Icon: CameraIcon },
  { key: 'size', label: 'Size', Icon: MeasureIcon },
  { key: 'details', label: 'Details', Icon: ClipboardIcon },
  { key: 'work', label: 'Work', Icon: EditIcon },
  { key: 'review', label: 'Review', Icon: SparklesIcon },
];
const STATUS = { draft: ['neutral', 'Capturing'], surveyed: ['info', 'Surveyed'], priced: ['success', 'Priced'] };
const KIND_LABEL = { corner: 'Corner', wall: 'Wall', floor: 'Floor', ceiling: 'Ceiling', detail: 'Detail', general: '', render: 'Finished' };
const RENDER_LINES = ['Reading the photo…', 'Painting the work in — the new finishes, the fittings…', 'Keeping the walls, window and camera angle as they are…', 'Nearly there…'];
const BUSY_LINES = ['Looking at the photos…', 'Finding the walls, doors and windows…', 'Counting sockets, switches and lights…', 'Checking the finishes and their condition…', 'Working out the quantities…'];
const FINISH_KEYS = [['floor', 'Floor'], ['walls', 'Walls'], ['ceiling', 'Ceiling'], ['woodwork', 'Woodwork']];
const FINISH_HINTS = { floor: ['Laminate', 'Carpet', 'Tiles', 'Vinyl', 'Engineered wood', 'Floorboards', 'Concrete'], walls: ['Painted plaster', 'Wallpaper', 'Tiled', 'Bare plaster', 'Artex', 'Panelling'], ceiling: ['Painted plaster', 'Artex', 'Plasterboard', 'Coved', 'Lath and plaster'], woodwork: ['Painted', 'Stained', 'Varnished', 'Bare', 'MDF'] };
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const fmtAt = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

function SecHead({ Icon, title, hint, right }) {
  return (
    <div className="sr-sec__head">
      <div>
        <div className="sr-sec__title"><i><Icon size={15} /></i>{title}</div>
        {hint && <div className="sr-sec__hint" style={{ marginTop: 3 }}>{hint}</div>}
      </div>
      {right}
    </div>
  );
}
function Src({ s }) { return s && s !== 'user' ? <span className={'sr-src sr-src--' + s}>{s === 'ai' ? 'AI' : 'Measured'}</span> : null; }
function Stepper({ value, onChange, min = 0 }) {
  return <span className="sr-stepper"><button type="button" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Fewer">−</button><span>{value}</span><button type="button" onClick={() => onChange(value + 1)} aria-label="More">+</button></span>;
}
const ShapeRect = () => <svg viewBox="0 0 44 34" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="4" y="4" width="36" height="26" rx="1" /></svg>;
const ShapeL = () => <svg viewBox="0 0 44 34" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 4h36v14H24v12H4z" /></svg>;
const ShapeCustom = () => <svg viewBox="0 0 44 34" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 3"><path d="M4 8l14-4 22 6-4 20H8z" /></svg>;

export default function SurveyRoomPage() {
  const { id, roomId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const isMobile = useIsMobile(640);
  const [data, setData] = useState(null);          // { survey, estimate, pricing_brief, max_enabled }
  const [room, setRoom] = useState(null);          // the editable room
  const [error, setError] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [step, setStep] = useState('photos');
  const [view, setView] = useState('plan');
  const [lightbox, setLightbox] = useState(-1);
  const [uploads, setUploads] = useState(null);    // { pct, count }
  const [busy, setBusy] = useState(null);          // { title, line }
  const [priceResult, setPriceResult] = useState(null);
  const [renderTweak, setRenderTweak] = useState('');
  const [renderPick, setRenderPick] = useState(null);     // the render shown in the before/after
  const [selOpening, setSelOpening] = useState(null);
  const [editOpening, setEditOpening] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [lidar, setLidar] = useState({ available: false, reason: '' });
  const [featureText, setFeatureText] = useState('');
  const [hazardText, setHazardText] = useState('');
  const [noteText, setNoteText] = useState('');
  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const roomRef = useRef(null); roomRef.current = room;
  const voiceTarget = useRef('note');
  const camRef = useRef(null); const galRef = useRef(null); const scanFileRef = useRef(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(() => apiFetch('/surveys/rooms/' + roomId)
    .then((r) => { setData({ survey: r.survey, estimate: r.estimate, pricing_brief: r.pricing_brief, max_enabled: r.max_enabled }); setRoom(r.room); setError(''); })
    .catch((e) => setError(e.message || 'Could not open that room.')), [roomId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { lidarStatus().then(setLidar).catch(() => {}); }, []);
  // On a phone the capture flow has its own pinned bar and microphone; the
  // support bubble would sit on top of the form (styles.css hides it for this class).
  useEffect(() => { document.body.classList.add('sr-capturing'); return () => document.body.classList.remove('sr-capturing'); }, []);

  // ── Autosave ───────────────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    const body = pendingRef.current;
    if (!Object.keys(body).length) return;
    pendingRef.current = {};
    setSaveState('saving');
    try {
      const r = await apiFetch('/surveys/rooms/' + roomId, { method: 'PATCH', body: JSON.stringify(body) });
      setRoom((cur) => (cur ? { ...cur, status: r.room.status, dims_source: r.room.dims_source, updated_at: r.room.updated_at, quantities: r.room.quantities } : cur));
      setSaveState('saved');
    } catch (e) { setSaveState('error'); toast.error(e.message || 'Could not save — check your connection.'); pendingRef.current = { ...body, ...pendingRef.current }; }
  }, [roomId, toast]);
  const update = useCallback((patch) => {
    setRoom((r) => (r ? { ...r, ...patch } : r));
    Object.assign(pendingRef.current, patch);
    setSaveState('dirty');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 700);
  }, [flush]);
  useEffect(() => () => { clearTimeout(timerRef.current); flush(); }, [flush]);
  const setDim = (k, v) => {
    const patch = { [k]: v === '' ? null : v };
    if (room.dims_source !== 'measured' && ['length_m', 'width_m', 'height_m'].includes(k)) patch.dims_source = 'stated';
    update(patch);
  };

  // ── Voice: notes and "work wanted" ─────────────────────────────────────────
  const addNote = useCallback(async (text, source) => {
    const t = String(text || '').trim(); if (!t) return;
    try {
      const r = await apiFetch('/surveys/rooms/' + roomId + '/notes', { method: 'POST', body: JSON.stringify({ text: t, source }) });
      setRoom((cur) => (cur ? { ...cur, notes: r.notes } : cur));
      setNoteText('');
    } catch (e) { toast.error(e.message || 'Could not save the note.'); }
  }, [roomId, toast]);
  const voice = useMaxVoice({
    onFinal: (text) => {
      if (voiceTarget.current === 'work') { const cur = roomRef.current ? roomRef.current.work_wanted || '' : ''; update({ work_wanted: (cur ? cur.trim() + ' ' : '') + text }); }
      else addNote(text, 'voice');
    },
    onError: (m) => toast.error(m),
  });
  const talk = (target) => { voiceTarget.current = target; if (voice.listening) voice.stopListening(); else voice.startListening(); };

  // ── Photos ─────────────────────────────────────────────────────────────────
  const addPhotos = async (fileList, kind) => {
    const files = Array.from(fileList || []).filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
    if (!files.length) return;
    setUploads({ pct: 0, count: files.length });
    try {
      for (let i = 0; i < files.length; i += 10) {
        const chunk = files.slice(i, i + 10);
        const fd = new FormData();
        for (const f of chunk) fd.append('photos', await compressImage(f, 2000, 0.86), f.name || 'photo.jpg');
        if (kind) fd.append('kind', kind);
        const r = await apiUpload('/surveys/rooms/' + roomId + '/photos', fd, { onProgress: (p) => setUploads({ pct: Math.round(((i + (p.percent || 0) / 100 * chunk.length) / files.length) * 100), count: files.length }) });
        setRoom((cur) => (cur ? { ...cur, photos: r.photos, photo_count: r.photos.length, cover_thumb: r.photos.length ? r.photos[0].thumb_url : null } : cur));
      }
      toast.success(files.length === 1 ? 'Photo saved' : files.length + ' photos saved');
    } catch (e) { toast.error(e.message || 'Could not upload.'); }
    finally { setUploads(null); if (camRef.current) camRef.current.value = ''; if (galRef.current) galRef.current.value = ''; }
  };
  const savePhoto = async (photo, patch) => {
    try {
      const r = await apiFetch('/surveys/photos/' + photo.id, { method: 'PATCH', body: JSON.stringify(patch) });
      setRoom((cur) => (cur ? { ...cur, photos: cur.photos.map((p) => (p.id === photo.id ? { ...p, ...r.photo } : p)) } : cur));
      toast.success('Saved');
    } catch (e) { toast.error(e.message || 'Could not save.'); }
  };
  const deletePhoto = async (photo) => {
    try {
      await apiFetch('/surveys/photos/' + photo.id, { method: 'DELETE' });
      setRoom((cur) => { if (!cur) return cur; const photos = cur.photos.filter((p) => p.id !== photo.id); return { ...cur, photos, photo_count: photos.length, cover_thumb: photos.length ? photos[0].thumb_url : null }; });
      setLightbox((i) => (i >= (room.photos.length - 1) ? Math.max(-1, i - 1) : i));
    } catch (e) { toast.error(e.message || 'Could not delete.'); }
  };

  // ── The finished room, painted onto a photo ───────────────────────────────
  const renderRoom = async (photo, instructions) => {
    if (!(roomRef.current.work_wanted || '').trim()) { toast.error('Say what work the customer wants first (the Work step) — that is what gets painted in.'); return; }
    await flush();
    setLightbox(-1);
    let n = 0;
    setBusy({ title: 'Showing the finished room', line: RENDER_LINES[0] });
    const tick = setInterval(() => { n = Math.min(n + 1, RENDER_LINES.length - 1); setBusy((b) => (b ? { ...b, line: RENDER_LINES[n] } : b)); }, 6000);
    try {
      const r = await apiFetch('/surveys/rooms/' + roomId + '/render', { method: 'POST', body: JSON.stringify({ photo_id: photo ? photo.id : undefined, instructions: instructions || '' }) });
      setRoom((cur) => (cur ? { ...cur, photos: r.photos, photo_count: r.photos.length } : cur));
      setData((d) => (d ? { ...d, render_allowance: r.allowance } : d));
      setRenderPick(r.photo.id);
      setRenderTweak('');
      toast.success('Here\'s the finished room. Slide to compare — it\'s a concept, not a drawing.');
      if (isMobile) setStep('photos');
    } catch (e) { toast.error(e.message || 'Could not render the room.'); }
    finally { clearInterval(tick); setBusy(null); }
  };

  // ── LiDAR / RoomPlan ───────────────────────────────────────────────────────
  const applyCapture = async (fd) => {
    setBusy({ title: 'Reading the scan', line: 'Walls, doors, windows and what the scanner saw in the room.' });
    try {
      const r = fd instanceof FormData ? await apiUpload('/surveys/rooms/' + roomId + '/roomplan', fd) : await apiFetch('/surveys/rooms/' + roomId + '/roomplan', { method: 'POST', body: JSON.stringify({ json: fd }) });
      pendingRef.current = {};
      setRoom(r.room);
      toast.success('Measured: ' + r.room.quantities.floor_m2 + ' m² over ' + r.room.quantities.wall_count + ' walls');
    } catch (e) { toast.error(e.message || 'Could not read the scan.'); }
    finally { setBusy(null); if (scanFileRef.current) scanFileRef.current.value = ''; }
  };
  const scanLidar = async () => {
    try { const capture = await scanRoom(); if (capture) await applyCapture(capture); }
    catch (e) { toast.error(e && e.message ? e.message : 'The scanner did not finish.'); }
  };

  // ── AI survey and MAX pricing ──────────────────────────────────────────────
  const analyse = async () => {
    await flush();
    let n = 0;
    setBusy({ title: 'Surveying the room', line: BUSY_LINES[0] });
    const tick = setInterval(() => { n = (n + 1) % BUSY_LINES.length; setBusy((b) => (b ? { ...b, line: BUSY_LINES[n] } : b)); }, 2600);
    try {
      const r = await apiFetch('/surveys/rooms/' + roomId + '/analyse', { method: 'POST', body: JSON.stringify({}) });
      pendingRef.current = {};
      setRoom(r.room);
      toast.success('Surveyed — ' + Math.round((r.analysis.confidence || 0) * 100) + '% confident. Check the sizes and the openings.');
      if (isMobile) setStep('review');
    } catch (e) { toast.error(e.message || 'Could not survey the room.'); }
    finally { clearInterval(tick); setBusy(null); }
  };
  const price = async () => {
    await flush();
    setBusy({ title: 'MAX is pricing the room', line: 'Taking off the quantities and pricing them from your rates…' });
    try {
      const r = await apiFetch('/surveys/rooms/' + roomId + '/price', { method: 'POST', body: JSON.stringify({ work_wanted: roomRef.current.work_wanted || '' }) });
      setPriceResult({ ...r.result, card: (r.cards && r.cards[0]) || null });
      setRoom((cur) => (cur ? { ...cur, status: r.room.status, estimate_id: r.room.estimate_id } : cur));
      load();
      if (isMobile) setStep('review');
    } catch (e) { toast.error(e.message || 'Could not price the room.'); }
    finally { setBusy(null); }
  };
  const deleteRoom = async () => {
    try { await apiFetch('/surveys/rooms/' + roomId, { method: 'DELETE' }); toast.success('Room deleted'); navigate('/surveys/' + id); }
    catch (e) { toast.error(e.message || 'Could not delete.'); }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const q = useMemo(() => (room ? quantities(room) : null), [room]);
  const geom = useMemo(() => (room ? { name: room.name, shape: room.shape, length_m: room.length_m, width_m: room.width_m, height_m: room.height_m, notch_length_m: room.notch_length_m, notch_width_m: room.notch_width_m, openings: room.openings, walls: room.walls, floor_area_override_m2: room.floor_area_override_m2, plan: room.plan } : null), [room]);
  const walls = useMemo(() => (room ? wallsOf(room) : []), [room]);
  const scene = useMemo(() => (geom ? sceneOf(geom) : null), [geom]);

  if (error) return <div className="page"><EmptyState icon={ImageIcon} title="Room not found" body={error} action={<Button to={'/surveys/' + id}>Back to the survey</Button>} /></div>;
  if (!room || !data) return <div className="page"><SkeletonCard height={70} /><div style={{ height: 14 }} /><div className="sr"><div className="sr__main"><SkeletonCard height={220} /><SkeletonCard height={260} /></div><div className="sr__side"><SkeletonCard height={300} /></div></div></div>;

  const photos = room.photos || [];
  const openings = room.openings || [];
  const features = room.features || [];
  const finishes = room.finishes || {};
  const hazards = room.hazards || [];
  const notes = room.notes || [];
  const renders = photos.filter((p) => p.kind === 'render');
  const shownRender = renders.find((p) => p.id === renderPick) || renders[renders.length - 1] || null;
  const renderAllowanceText = data.render_allowance ? (data.render_allowance.unlimited ? '' : data.render_allowance.remaining + ' of ' + data.render_allowance.monthly + ' renders left this month') : '';
  const [stTone, stLabel] = STATUS[room.status] || STATUS.draft;
  const measured = room.dims_source === 'measured';
  const canPrice = !!(data.max_enabled && q.complete && (room.work_wanted || '').trim());
  const stepIdx = STEPS.findIndex((s) => s.key === step);
  const show = (k) => !isMobile || step === k;
  const done = { photos: photos.length > 0, size: q.complete, details: features.length > 0 || Object.keys(finishes).some((k) => k !== 'source'), work: !!(room.work_wanted || '').trim(), review: room.status !== 'draft' };
  const sendParams = new URLSearchParams({ from: 'max', address: data.survey ? data.survey.address || '' : '', brief: (data.pricing_brief || '').slice(0, 2500) });

  // ── Editors ────────────────────────────────────────────────────────────────
  const setOpenings = (list) => update({ openings: list });
  const addOpening = (kind) => { const o = { id: uid('op'), kind, ...OPENING_DEFAULTS[kind], count: 1, wall: null, notes: '', source: 'user' }; setOpenings([...openings, o]); setEditOpening(o.id); setSelOpening(o.id); };
  const patchOpening = (oid, patch) => setOpenings(openings.map((o) => (o.id === oid ? { ...o, ...patch, source: o.source === 'measured' && !('width_m' in patch || 'height_m' in patch) ? 'measured' : 'user' } : o)));
  const removeOpening = (oid) => { setOpenings(openings.filter((o) => o.id !== oid)); if (selOpening === oid) setSelOpening(null); };
  const onWallClick = (label) => { if (selOpening) patchOpening(selOpening, { wall: label }); };
  const setFeatures = (list) => update({ features: list });
  const toggleFeature = (item) => {
    const have = features.find((f) => f.item.toLowerCase() === item.toLowerCase());
    if (have) setFeatures(features.filter((f) => f !== have)); else setFeatures([...features, { id: uid('ft'), item, count: 1, notes: '', source: 'user' }]);
  };
  const addFeature = () => { const t = featureText.trim(); if (!t) return; if (!features.find((f) => f.item.toLowerCase() === t.toLowerCase())) setFeatures([...features, { id: uid('ft'), item: t, count: 1, notes: '', source: 'user' }]); setFeatureText(''); };
  const setFinish = (k, patch) => update({ finishes: { ...finishes, [k]: { type: '', condition: '', notes: '', ...(finishes[k] || {}), ...patch }, source: 'user' } });
  const toggleHazard = (h) => update({ hazards: hazards.includes(h) ? hazards.filter((x) => x !== h) : [...hazards, h] });
  const addHazard = () => { const t = hazardText.trim(); if (t && !hazards.includes(t)) update({ hazards: [...hazards, t] }); setHazardText(''); };
  const deleteNote = async (nid) => { try { const r = await apiFetch('/surveys/rooms/' + roomId + '/notes/' + nid, { method: 'DELETE' }); setRoom((cur) => ({ ...cur, notes: r.notes })); } catch (e) { toast.error('Could not delete the note.'); } };

  const sketchPanel = (
    <div className="sr-sketch">
      <div className="sr-sketch__tabs">
        <button type="button" className={'sr-sketch__tab' + (view === 'plan' ? ' sr-sketch__tab--on' : '')} onClick={() => setView('plan')}><LayersIcon size={13} /> Plan</button>
        <button type="button" className={'sr-sketch__tab' + (view === '3d' ? ' sr-sketch__tab--on' : '')} onClick={() => setView('3d')} disabled={!scene}><OrbitIcon size={13} /> 3D</button>
      </div>
      {view === '3d' && scene ? (
        <Suspense fallback={<div className="sk-empty" style={{ width: '100%', height: 260 }}><strong>Building the room…</strong></div>}><div style={{ width: '100%' }}><Room3D room={geom} height={isMobile ? 240 : 280} /></div></Suspense>
      ) : (
        <RoomPlanSketch room={geom} width={isMobile ? 300 : 320} height={isMobile ? 220 : 240} selectedWall={selOpening ? (openings.find((o) => o.id === selOpening) || {}).wall : null} onWallClick={onWallClick} />
      )}
      <div className="sr-sketch__note">{view === '3d' ? 'Drag to turn it, pinch to zoom.' : selOpening ? 'Tap a wall letter to put the selected opening on that wall.' : scene && scene.kind === 'plan' ? 'From the LiDAR scan — ' + scene.segments.length + ' walls as the scanner found them, doors and windows where it saw them.' : q.complete ? 'Walls A–' + walls[walls.length - 1].label + ' clockwise from the top. Tap an opening below, then a wall letter.' : 'Type the length and width and the plan draws itself.'}</div>
    </div>
  );
  const quantitiesPanel = (
    <div className="sr-sec">
      <SecHead Icon={MeasureIcon} title="Quantities" hint={q.complete ? 'From the sizes — what MAX prices from' : 'Need the length and width'} right={<Badge tone={SOURCE_TONE[room.dims_source] || 'neutral'} size="sm">{SOURCE_LABEL[room.dims_source] || 'No size yet'}</Badge>} />
      <div className="sr-sec__body">
        {q.complete ? (
          <>
            <div className="sr-q">
              <div className="sr-q__tile"><div className="sr-q__v">{q.floor_m2}<small>m²</small></div><div className="sr-q__k">Floor</div></div>
              <div className="sr-q__tile"><div className="sr-q__v">{q.wall_net_m2}<small>m²</small></div><div className="sr-q__k">Walls net</div></div>
              <div className="sr-q__tile"><div className="sr-q__v">{q.ceiling_m2}<small>m²</small></div><div className="sr-q__k">Ceiling</div></div>
              <div className="sr-q__tile"><div className="sr-q__v">{q.perimeter_m}<small>m</small></div><div className="sr-q__k">Perimeter</div></div>
            </div>
            <div>
              <div className="sr-q__row"><span>Wall area gross</span><b>{q.wall_gross_m2} m²</b></div>
              <div className="sr-q__row"><span>Less openings</span><b>− {q.openings_m2} m²</b></div>
              <div className="sr-q__row"><span>Skirting (perimeter less doors)</span><b>{q.skirting_m} m</b></div>
              <div className="sr-q__row"><span>Coving</span><b>{q.coving_m} m</b></div>
              <div className="sr-q__row"><span>Ceiling height</span><b>{q.height_m} m</b></div>
              <div className="sr-q__row"><span>Volume</span><b>{q.volume_m3} m³</b></div>
              <div className="sr-q__row"><span>Doors · windows · openings</span><b>{q.doors} · {q.windows} · {q.openings}</b></div>
              <div className="sr-q__row"><span>Window area</span><b>{q.window_m2} m²</b></div>
            </div>
          </>
        ) : <div className="sr-tip"><InfoIcon size={16} /><span>Type the length and width (and the ceiling height if it isn't 2.4 m), scan with LiDAR, or run the AI survey and it will estimate them from the photos.</span></div>}
      </div>
    </div>
  );
  const aiPanel = (room.ai_summary || (room.assumptions || []).length > 0) && (
    <div className="sr-ai">
      <div className="sr-ai__head">
        <span className="sr-ai__title"><SparklesIcon size={15} /> AI survey</span>
        {room.confidence != null && <span className="sr-ai__conf">{Math.round(room.confidence * 100)}% sure <span className="sr-ai__bar"><i style={{ width: Math.round(room.confidence * 100) + '%' }} /></span></span>}
      </div>
      {room.ai_summary && <div className="sr-ai__text">{room.ai_summary}</div>}
      {(room.assumptions || []).length > 0 && <ul className="sr-ai__list">{room.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
      {room.analysed_at && <div className="sr-sec__hint" style={{ marginTop: 8 }}>Surveyed {fmtAt(String(room.analysed_at).replace(' ', 'T') + 'Z')}</div>}
    </div>
  );
  const priceCard = priceResult && (priceResult.over_limit ? (
    <div className="sr-price sr-price--warn">
      <div className="sr-price__eyebrow">Over the small-job limit</div>
      <div className="sr-price__big">~{fmtMoney2(priceResult.rough_price_ex_vat, priceResult.currency)}<small>ex VAT</small></div>
      <div className="sr-price__text">MAX doesn't price jobs at or above {fmtMoney2(priceResult.limit_gbp)} ex VAT. No estimate was made. Send the survey to the AI QS team for a full take-off instead.</div>
      <div className="sr-price__row">{priceResult.card && priceResult.card.submit_path && <Button size="sm" to={priceResult.card.submit_path}><UploadIcon size={13} color="currentColor" /> Send to AI QS team</Button>}<Button size="sm" variant="ghost" onClick={() => setPriceResult(null)}>Dismiss</Button></div>
    </div>
  ) : priceResult.estimate_id ? (
    <div className="sr-price">
      <div className="sr-price__eyebrow">Estimate {priceResult.quote_number} drafted</div>
      <div className="sr-price__big">{fmtMoney2(priceResult.price_ex_vat, priceResult.currency)}<small>ex VAT</small></div>
      <div className="sr-price__text">{fmtMoney2(priceResult.grand_total_inc_vat, priceResult.currency)} inc VAT · {priceResult.line_count || ''}{priceResult.line_count ? ' lines from your rates. ' : ''}{priceResult.verdict_note || 'Open it to check the lines before it goes to the customer.'}</div>
      <div className="sr-price__row"><Button size="sm" to={'/estimates/' + priceResult.estimate_id}><PoundIcon size={13} color="currentColor" /> Open estimate</Button><Button size="sm" variant="ghost" onClick={() => setPriceResult(null)}>Dismiss</Button></div>
    </div>
  ) : null);
  const actionsPanel = (
    <div className="sr-sec">
      <SecHead Icon={BoltIcon} title="Actions" hint={data.max_enabled ? 'AI survey, then a price from your rates' : 'Exports — ask us to switch MAX on to price it'} />
      <div className="sr-sec__body">
        {priceCard}
        <div className="sr-actions">
          <Button onClick={analyse} disabled={!data.max_enabled || !photos.length} title={!photos.length ? 'Add photos first' : undefined} busyLabel="Surveying…"><SparklesIcon size={15} color="currentColor" /> {room.analysed_at ? 'Survey again with AI' : 'Survey with AI'}</Button>
          <Button onClick={price} disabled={!canPrice} variant={room.estimate_id ? 'secondary' : 'primary'} title={!q.complete ? 'Needs a size first' : !(room.work_wanted || '').trim() ? 'Say what work is wanted first' : undefined} busyLabel="Pricing…"><PoundIcon size={15} color="currentColor" /> {room.estimate_id ? 'Price again with MAX' : 'Price with MAX'}</Button>
          {data.estimate && <Button variant="secondary" to={'/estimates/' + data.estimate.id}><ExternalLinkIcon size={14} color="currentColor" /> Estimate {data.estimate.quote_number} · {fmtMoney2(data.estimate.grand_total)}</Button>}
          <Button variant="secondary" onClick={() => downloadFile('/api/surveys/' + id + '/report.pdf', (room.name || 'room').replace(/[^\w-]+/g, '_') + '_survey.pdf').catch((e) => toast.error(e.message))} busyLabel="Making PDF…"><FileTextIcon size={14} color="currentColor" /> Survey report PDF</Button>
          {room.has_capture && <Button variant="secondary" onClick={() => downloadFile('/api/surveys/' + id + '/plan.pdf', (room.name || 'room').replace(/[^\w-]+/g, '_') + '_plan.pdf').catch((e) => toast.error(e.message))} busyLabel="Drawing…"><LayersIcon size={14} color="currentColor" /> Floor plan PDF</Button>}
          <Button variant="ghost" to={'/submit-drawings?' + sendParams.toString()}><UploadIcon size={14} color="currentColor" /> Send to the AI QS team</Button>
        </div>
        {!data.max_enabled && <div className="sr-sec__hint">The AI survey and MAX pricing are switched on per account during the trial. Everything you capture is kept and exportable meanwhile.</div>}
      </div>
    </div>
  );

  return (
    <div className="page">
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => addPhotos(e.target.files)} />
      <input ref={galRef} type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos(e.target.files)} />
      <input ref={scanFileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) { const fd = new FormData(); fd.append('file', f, f.name); applyCapture(fd); } }} />

      <div className="sr-head">
        <div className="sr-head__left">
          <div className="sr-head__kicker"><Link to={'/surveys/' + id}><ArrowLeftIcon size={13} /> {data.survey ? data.survey.title : 'Survey'}</Link>{data.survey && data.survey.address && data.survey.address !== data.survey.title && <span>· {data.survey.address}</span>}</div>
          <input className="sp-inline sp-inline--title" value={room.name || ''} onChange={(e) => update({ name: e.target.value })} placeholder="Room name" aria-label="Room name" />
          <div className="sr-head__badges">
            <Badge tone={stTone} size="sm">{stLabel}</Badge>
            <Badge tone={SOURCE_TONE[room.dims_source] || 'neutral'} size="sm" outlined>{SOURCE_LABEL[room.dims_source] || 'No size yet'}</Badge>
            {room.has_capture && <Badge tone="success" size="sm" outlined>LiDAR scan</Badge>}
            <span className={'sr-save sr-save--' + (saveState === 'saving' || saveState === 'dirty' ? 'busy' : saveState === 'error' ? 'err' : 'ok')}><i /> {saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Editing…' : saveState === 'error' ? 'Not saved' : 'Saved'}</span>
          </div>
        </div>
        <div className="sp-actions">
          <select className="ui-select" value={room.room_type || ''} onChange={(e) => update({ room_type: e.target.value })} aria-label="Room type" style={{ minWidth: 140 }}><option value="">Room type…</option>{ROOM_TYPES.map((t) => <option key={t}>{t}</option>)}{room.room_type && !ROOM_TYPES.includes(room.room_type) && <option>{room.room_type}</option>}</select>
          <select className="ui-select" value={room.floor_level || ''} onChange={(e) => update({ floor_level: e.target.value })} aria-label="Floor level" style={{ minWidth: 110 }}><option value="">Floor…</option>{FLOOR_LEVELS.map((t) => <option key={t}>{t}</option>)}</select>
          <Button variant="ghost" onClick={() => setConfirmDel(true)} aria-label="Delete room"><TrashIcon size={14} color="currentColor" /></Button>
        </div>
      </div>

      <div className="sr-steps" role="tablist">
        {STEPS.map((s) => <button key={s.key} type="button" role="tab" aria-selected={step === s.key} className={'sr-step' + (step === s.key ? ' sr-step--on' : '') + (done[s.key] ? ' sr-step--done' : '')} onClick={() => setStep(s.key)}><s.Icon size={15} />{s.label}{done[s.key] && step !== s.key ? ' ✓' : ''}</button>)}
      </div>

      <div className="sr">
        <div className="sr__main">
          {show('photos') && (
            <div className="sr-sec">
              <SecHead Icon={CameraIcon} title="Photos" hint={photos.length ? photos.length + ' kept with the room' : 'Two from opposite corners, then each wall'} right={photos.length > 0 && <Button size="sm" variant="secondary" onClick={() => galRef.current && galRef.current.click()}><PlusIcon size={13} color="currentColor" /> Add</Button>} />
              <div className="sr-sec__body">
                {photos.length === 0 && (
                  <div className="sr-tip"><LightbulbIcon size={16} /><span><strong>Stand in a corner</strong> and shoot the opposite corner so two walls, the floor and the ceiling are in frame. Do the same from the corner opposite. Then one of each wall, the floor, the ceiling and anything odd — damp, cracks, a boxed-in pipe.</span></div>
                )}
                <div className="ph-actions">
                  <button type="button" className="ph-cta" onClick={() => camRef.current && camRef.current.click()}><CameraIcon size={22} /> Take a photo<small>Opens the camera</small></button>
                  <button type="button" className="ph-cta ph-cta--plain" onClick={() => galRef.current && galRef.current.click()}><ImageIcon size={22} /> From the gallery<small>Pick several at once</small></button>
                  {lidar.available
                    ? <button type="button" className="ph-cta" onClick={scanLidar}><ScanIcon size={22} /> Scan with LiDAR<small>Measures the room for you</small></button>
                    : <button type="button" className="ph-cta ph-cta--plain" onClick={() => scanFileRef.current && scanFileRef.current.click()} title={lidar.reason}><ScanIcon size={22} /> Import a scan<small>RoomPlan / Polycam JSON</small></button>}
                </div>
                {(photos.length > 0 || uploads) && (
                  <div className="ph-grid">
                    {photos.map((p, i) => (
                      <button key={p.id} type="button" className="ph" onClick={() => setLightbox(i)} aria-label={'Photo ' + (i + 1)}>
                        <img src={resolveUrl(p.thumb_url)} alt={p.caption || ''} loading="lazy" />
                        {KIND_LABEL[p.kind] && <span className={'ph__kind' + (p.kind === 'render' ? ' ph__kind--render' : '')}>{KIND_LABEL[p.kind]}</span>}
                        {p.ai_notes && <span className="ph__ai" title={p.ai_notes}><SparklesIcon size={10} color="#fff" /></span>}
                        {p.caption && <span className="ph__cap">{p.caption}</span>}
                      </button>
                    ))}
                    {uploads && <div className="ph ph--up" aria-live="polite"><span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>{uploads.count > 1 ? uploads.count + ' photos' : 'Photo'} · {uploads.pct}%</span><span className="ph__prog"><i style={{ width: uploads.pct + '%' }} /></span></div>}
                  </div>
                )}
                {photos.length > 0 && <div className="sr-sec__hint">Tap a photo to caption it, say what it shows, or delete it. Photos stay with the room until you remove them.</div>}
                {renders.length > 0 ? (
                  <div className="sr-render">
                    <div className="sr-render__head">
                      <span className="sr-render__title"><SparklesIcon size={15} /> The finished room</span>
                      {renders.length > 1 && <select className="ui-select" style={{ width: 'auto', minWidth: 0, padding: '5px 28px 5px 9px', fontSize: 12.5 }} value={shownRender.id} onChange={(e) => setRenderPick(e.target.value)} aria-label="Which render">{renders.map((p, i) => <option key={p.id} value={p.id}>{'Render ' + (i + 1) + (p.caption ? ' — ' + p.caption.replace(/^Finished room\s*[—-]?\s*/, '').slice(0, 40) : '')}</option>)}</select>}
                    </div>
                    <BeforeAfter before={photos.find((p) => p.id === shownRender.render_of) || photos.find((p) => p.kind !== 'render')} after={shownRender} height={isMobile ? 240 : 300} />
                    <div className="sr-render__sub">{shownRender.caption}</div>
                    {data.max_enabled && (
                      <div className="sr-render__row">
                        <Input value={renderTweak} onChange={(e) => setRenderTweak(e.target.value)} placeholder="Change something — 'grey tiles', 'walk-in shower instead of the bath'…" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); renderRoom(photos.find((p) => p.id === shownRender.render_of) || null, renderTweak); } }} />
                        <Button variant="secondary" onClick={() => renderRoom(photos.find((p) => p.id === shownRender.render_of) || null, renderTweak)} disabled={!!(data.render_allowance && data.render_allowance.remaining === 0)}><SparklesIcon size={13} color="currentColor" /> Again</Button>
                      </div>
                    )}
                    <div className="sr-render__foot">An AI concept of the work described, not to scale — it goes in the report marked as such.{renderAllowanceText ? ' ' + renderAllowanceText : ''}</div>
                  </div>
                ) : (photos.some((p) => p.kind !== 'render') && data.max_enabled && (
                  <button type="button" className="ph-cta" style={{ alignSelf: 'stretch' }} onClick={() => renderRoom(photos.find((p) => p.kind === 'corner') || photos.find((p) => p.kind !== 'render'), '')} disabled={!!(data.render_allowance && data.render_allowance.remaining === 0)}>
                    <SparklesIcon size={22} /> Show the finished room<small>{(room.work_wanted || '').trim() ? 'Paints the work the customer wants onto a photo, in about 20 seconds' + (renderAllowanceText ? ' · ' + renderAllowanceText : '') : 'Fill in what the customer wants (Work step) first'}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {show('size') && (
            <div className="sr-sec">
              <SecHead Icon={MeasureIcon} title="Size & shape" hint={measured ? 'Measured by LiDAR — the outline is locked' : 'Internal sizes in metres'} right={measured && <Button size="sm" variant="ghost" onClick={() => update({ dims_source: 'stated' })}>Edit by hand</Button>} />
              <div className="sr-sec__body">
                <div className="sr-shapes">
                  <button type="button" className={'sr-shape' + (room.shape === 'rectangular' ? ' sr-shape--on' : '')} onClick={() => update({ shape: 'rectangular' })} disabled={measured}><ShapeRect /> Rectangular</button>
                  <button type="button" className={'sr-shape' + (room.shape === 'l_shape' ? ' sr-shape--on' : '')} onClick={() => update({ shape: 'l_shape' })} disabled={measured}><ShapeL /> L-shaped</button>
                  <button type="button" className={'sr-shape' + (room.shape === 'custom' ? ' sr-shape--on' : '')} onClick={() => update({ shape: 'custom' })} disabled={measured || !(room.walls || []).length} title={!(room.walls || []).length ? 'Scan the room with LiDAR for a measured outline' : undefined}><ShapeCustom /> Measured</button>
                </div>
                {room.shape !== 'custom' ? (
                  <div className="sr-fields sr-fields--3">
                    <label className="ui-field sr-num"><span className="ui-field__label">Length</span><input className="ui-input" type="number" inputMode="decimal" step="0.01" min="0" value={room.length_m ?? ''} onChange={(e) => setDim('length_m', e.target.value)} placeholder="4.20" disabled={measured} /><span className="sr-num__unit">m</span></label>
                    <label className="ui-field sr-num"><span className="ui-field__label">Width</span><input className="ui-input" type="number" inputMode="decimal" step="0.01" min="0" value={room.width_m ?? ''} onChange={(e) => setDim('width_m', e.target.value)} placeholder="3.10" disabled={measured} /><span className="sr-num__unit">m</span></label>
                    <label className="ui-field sr-num"><span className="ui-field__label">Ceiling height</span><input className="ui-input" type="number" inputMode="decimal" step="0.01" min="0" value={room.height_m ?? ''} onChange={(e) => setDim('height_m', e.target.value)} placeholder="2.40" /><span className="sr-num__unit">m</span></label>
                  </div>
                ) : (
                  <div className="sr-list">
                    {(room.walls || []).map((w, i) => <div key={i} className="sr-item"><span className="sr-item__ic" style={{ fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{w.label}</span><div className="sr-item__main"><div className="sr-item__title">Wall {w.label}</div><div className="sr-item__meta">{num(w.length_m).toFixed(2)} m × {num(w.height_m || room.height_m || 2.4).toFixed(2)} m high</div></div></div>)}
                    <div className="sr-fields">
                      <label className="ui-field sr-num"><span className="ui-field__label">Floor area</span><input className="ui-input" type="number" inputMode="decimal" step="0.01" min="0" value={room.floor_area_override_m2 ?? ''} onChange={(e) => setDim('floor_area_override_m2', e.target.value)} placeholder="13.0" /><span className="sr-num__unit">m²</span></label>
                      <label className="ui-field sr-num"><span className="ui-field__label">Ceiling height</span><input className="ui-input" type="number" inputMode="decimal" step="0.01" min="0" value={room.height_m ?? ''} onChange={(e) => setDim('height_m', e.target.value)} placeholder="2.40" /><span className="sr-num__unit">m</span></label>
                    </div>
                  </div>
                )}
                {room.shape === 'l_shape' && (
                  <div className="sr-fields" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                    <label className="ui-field sr-num"><span className="ui-field__label">Cut-out length</span><input className="ui-input" type="number" inputMode="decimal" step="0.01" min="0" value={room.notch_length_m ?? ''} onChange={(e) => setDim('notch_length_m', e.target.value)} placeholder="1.50" disabled={measured} /><span className="sr-num__unit">m</span><span className="ui-field__hint">The bit missing from the bottom-right corner, along the length</span></label>
                    <label className="ui-field sr-num"><span className="ui-field__label">Cut-out width</span><input className="ui-input" type="number" inputMode="decimal" step="0.01" min="0" value={room.notch_width_m ?? ''} onChange={(e) => setDim('notch_width_m', e.target.value)} placeholder="1.00" disabled={measured} /><span className="sr-num__unit">m</span><span className="ui-field__hint">…and across the width</span></label>
                  </div>
                )}
                {isMobile && sketchPanel}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <div className="sr-sec__title" style={{ fontSize: 14 }}><i><DoorIcon size={14} /></i>Doors, windows &amp; openings</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button size="sm" variant="secondary" onClick={() => addOpening('door')}><PlusIcon size={12} color="currentColor" /> Door</Button>
                    <Button size="sm" variant="secondary" onClick={() => addOpening('window')}><PlusIcon size={12} color="currentColor" /> Window</Button>
                    <Button size="sm" variant="secondary" onClick={() => addOpening('opening')}><PlusIcon size={12} color="currentColor" /> Opening</Button>
                  </div>
                </div>
                {openings.length === 0 ? <div className="sr-sec__hint">None yet. Add each door and window with its size — they come off the wall area and set the skirting length.</div> : (
                  <div className="sr-list">
                    {openings.map((o) => (
                      <div key={o.id} className={'sr-item' + (editOpening === o.id ? ' sr-item--edit' : '')} style={selOpening === o.id ? { borderColor: 'var(--accent)' } : undefined} onClick={() => setSelOpening(o.id)}>
                        {editOpening === o.id ? (
                          <div className="sr-item__form" onClick={(e) => e.stopPropagation()}>
                            <label className="ui-field"><span className="ui-field__label">Type</span><select className="ui-select" value={o.kind} onChange={(e) => patchOpening(o.id, { kind: e.target.value })}><option value="door">Door</option><option value="window">Window</option><option value="opening">Opening</option></select></label>
                            <label className="ui-field sr-num"><span className="ui-field__label">Width</span><input className="ui-input" type="number" step="0.01" min="0" inputMode="decimal" value={o.width_m} onChange={(e) => patchOpening(o.id, { width_m: e.target.value })} /><span className="sr-num__unit">m</span></label>
                            <label className="ui-field sr-num"><span className="ui-field__label">Height</span><input className="ui-input" type="number" step="0.01" min="0" inputMode="decimal" value={o.height_m} onChange={(e) => patchOpening(o.id, { height_m: e.target.value })} /><span className="sr-num__unit">m</span></label>
                            <label className="ui-field"><span className="ui-field__label">Wall</span><select className="ui-select" value={o.wall || ''} onChange={(e) => patchOpening(o.id, { wall: e.target.value || null })}><option value="">Any</option>{walls.map((w) => <option key={w.label} value={w.label}>Wall {w.label}</option>)}</select></label>
                            <label className="ui-field"><span className="ui-field__label">How many</span><input className="ui-input" type="number" min="1" max="20" value={o.count} onChange={(e) => patchOpening(o.id, { count: Math.max(1, parseInt(e.target.value, 10) || 1) })} /></label>
                            <label className="ui-field" style={{ gridColumn: '1 / -1' }}><span className="ui-field__label">Note</span><Input value={o.notes || ''} onChange={(e) => patchOpening(o.id, { notes: e.target.value })} placeholder="uPVC, double glazed, to the garden" /></label>
                            <div style={{ display: 'flex', gap: 6, gridColumn: '1 / -1', justifyContent: 'flex-end' }}><Button size="sm" variant="ghost" onClick={() => removeOpening(o.id)}><TrashIcon size={12} color="currentColor" /> Remove</Button><Button size="sm" onClick={() => setEditOpening(null)}><CheckIcon size={12} color="currentColor" /> Done</Button></div>
                          </div>
                        ) : (
                          <>
                            <span className="sr-item__ic"><DoorIcon size={15} /></span>
                            <div className="sr-item__main">
                              <div className="sr-item__title">{o.count > 1 ? o.count + ' × ' : ''}{o.kind === 'door' ? 'Door' : o.kind === 'window' ? 'Window' : 'Opening'}{o.wall && <Badge size="sm" tone="neutral" outlined>Wall {o.wall}</Badge>}<Src s={o.source} /></div>
                              <div className="sr-item__meta">{num(o.width_m).toFixed(2)} × {num(o.height_m).toFixed(2)} m{o.notes ? ' · ' + o.notes : ''}</div>
                            </div>
                            <div className="sr-item__side"><button type="button" className="ui-icon-btn" onClick={(e) => { e.stopPropagation(); setEditOpening(o.id); }} aria-label="Edit"><EditIcon size={14} /></button><button type="button" className="ui-icon-btn ui-icon-btn--danger" onClick={(e) => { e.stopPropagation(); removeOpening(o.id); }} aria-label="Remove"><XIcon size={14} /></button></div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {isMobile && quantitiesPanel}
              </div>
            </div>
          )}

          {show('details') && (
            <div className="sr-sec">
              <SecHead Icon={ClipboardIcon} title="What's in the room" hint="Fittings, finishes, condition and anything to watch" />
              <div className="sr-sec__body">
                <div className="ui-field__label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><BoltIcon size={13} /> Fittings &amp; features</div>
                <div className="sr-chips">{QUICK_FEATURES.map((f) => { const on = features.some((x) => x.item.toLowerCase() === f.toLowerCase()); return <button key={f} type="button" className={'sr-chip' + (on ? ' sr-chip--on' : '')} onClick={() => toggleFeature(f)}>{on ? <CheckIcon size={12} color="currentColor" /> : <PlusIcon size={12} color="currentColor" />} {f}</button>; })}</div>
                {features.length > 0 && (
                  <div className="sr-list">
                    {features.map((f) => (
                      <div key={f.id} className="sr-item">
                        <span className="sr-item__ic"><BoltIcon size={14} /></span>
                        <div className="sr-item__main"><div className="sr-item__title">{f.item}<Src s={f.source} /></div>{f.notes && <div className="sr-item__meta" style={{ fontFamily: 'inherit' }}>{f.notes}</div>}</div>
                        <div className="sr-item__side"><Stepper value={f.count} onChange={(n) => setFeatures(n === 0 ? features.filter((x) => x !== f) : features.map((x) => (x === f ? { ...x, count: n, source: 'user' } : x)))} /></div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="sr-compose" style={{ gridTemplateColumns: '1fr auto' }}>
                  <Input value={featureText} onChange={(e) => setFeatureText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFeature(); } }} placeholder="Something else — 'boiler', 'fitted wardrobe'…" />
                  <Button variant="secondary" onClick={addFeature} disabled={!featureText.trim()}><PlusIcon size={13} color="currentColor" /> Add</Button>
                </div>

                <div className="ui-field__label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}><PaletteIcon size={13} /> Finishes &amp; condition {finishes.source === 'ai' && <Src s="ai" />}</div>
                {FINISH_KEYS.map(([k, label]) => {
                  const f = finishes[k] || {};
                  return (
                    <div key={k} className="sr-fin">
                      <span className="sr-fin__k">{label}</span>
                      <Input value={f.type || ''} onChange={(e) => setFinish(k, { type: e.target.value })} placeholder={FINISH_HINTS[k].slice(0, 3).join(', ') + '…'} list={'fin-' + k} />
                      <datalist id={'fin-' + k}>{FINISH_HINTS[k].map((h) => <option key={h} value={h} />)}</datalist>
                      <span className="sr-cond">{['good', 'fair', 'poor'].map((c) => <button key={c} type="button" className={f.condition === c ? 'on-' + c : ''} onClick={() => setFinish(k, { condition: f.condition === c ? '' : c })}>{c[0].toUpperCase() + c.slice(1)}</button>)}</span>
                    </div>
                  );
                })}

                <div className="ui-field__label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}><AlertTriangleIcon size={13} /> Watch out for</div>
                <div className="sr-chips">{[...HAZARD_PRESETS, ...hazards.filter((h) => !HAZARD_PRESETS.includes(h))].map((h) => { const on = hazards.includes(h); return <button key={h} type="button" className={'sr-chip sr-chip--warn' + (on ? ' sr-chip--on' : '')} onClick={() => toggleHazard(h)}>{on ? <CheckIcon size={12} color="currentColor" /> : null} {h}</button>; })}</div>
                <div className="sr-compose" style={{ gridTemplateColumns: '1fr auto' }}>
                  <Input value={hazardText} onChange={(e) => setHazardText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHazard(); } }} placeholder="Anything else to flag" />
                  <Button variant="secondary" onClick={addHazard} disabled={!hazardText.trim()}><PlusIcon size={13} color="currentColor" /> Add</Button>
                </div>
                <Field label="Condition notes" hint="What the eye sees — the AI survey adds to this from the photos">
                  <textarea className="ui-textarea" rows={3} value={room.condition_notes || ''} onChange={(e) => update({ condition_notes: e.target.value })} placeholder="Ceiling stained above the window, skirting gappy by the door, plaster blown behind the radiator." />
                </Field>
              </div>
            </div>
          )}

          {show('work') && (
            <div className="sr-sec">
              <SecHead Icon={EditIcon} title="What the customer wants" hint="This is what MAX prices — say it like you'd say it to a mate" />
              <div className="sr-sec__body">
                <div className="sr-compose" style={{ gridTemplateColumns: '1fr auto' }}>
                  <textarea className="ui-textarea" rows={4} value={room.work_wanted || ''} onChange={(e) => update({ work_wanted: e.target.value })} placeholder="Strip the paper, skim the walls and ceiling, two coats throughout, new skirting, replace the two double sockets and fit spotlights." />
                  {voice.supported && <button type="button" className={'sr-mic' + (voice.listening && voiceTarget.current === 'work' ? ' sr-mic--on' : '') + (voice.transcribing ? ' sr-mic--busy' : '')} onClick={() => talk('work')} aria-label="Dictate the work" title="Dictate">{voice.listening && voiceTarget.current === 'work' ? <MicOffIcon size={18} /> : <MicIcon size={18} />}</button>}
                </div>
                {voice.listening && voiceTarget.current === 'work' && <div className="sr-interim">{voice.interim || 'Listening…'}</div>}
                {!q.complete && <div className="sr-tip sr-tip--warn"><AlertTriangleIcon size={16} /><span>MAX needs the room's size before it can price this. Add it under Size, or run the AI survey.</span></div>}

                <div className="ui-field__label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}><MessageIcon size={13} /> Site notes {notes.length > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {notes.length}</span>}</div>
                <div className="sr-compose">
                  <Input value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNote(noteText, 'typed'); } }} placeholder="Type a note, or hold the mic and say it" />
                  {voice.supported ? <button type="button" className={'sr-mic' + (voice.listening && voiceTarget.current === 'note' ? ' sr-mic--on' : '') + (voice.transcribing ? ' sr-mic--busy' : '')} onClick={() => talk('note')} aria-label="Say a note" title="Say a note">{voice.listening && voiceTarget.current === 'note' ? <MicOffIcon size={18} /> : <MicIcon size={18} />}</button> : <span />}
                  <Button variant="secondary" onClick={() => addNote(noteText, 'typed')} disabled={!noteText.trim()}><PlusIcon size={13} color="currentColor" /> Add</Button>
                </div>
                {voice.listening && voiceTarget.current === 'note' && <div className="sr-interim">{voice.interim || 'Listening…'}</div>}
                {voice.transcribing && <div className="sr-interim">Writing that down…</div>}
                {notes.length > 0 && (
                  <div className="sr-notes">
                    {[...notes].reverse().map((n) => (
                      <div key={n.id} className="sr-note">
                        <span className={'sr-note__ic' + (n.source === 'voice' ? ' sr-note__ic--voice' : '')}>{n.source === 'voice' ? <MicIcon size={13} /> : <EditIcon size={13} />}</span>
                        <div><div>{n.text}</div><div className="sr-note__at">{fmtAt(n.at)}{n.source === 'voice' ? ' · spoken' : ''}</div></div>
                        <button type="button" className="ui-icon-btn ui-icon-btn--danger" onClick={() => deleteNote(n.id)} aria-label="Delete note"><XIcon size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {isMobile && step === 'review' && (
            <>
              {sketchPanel}
              {aiPanel}
              {quantitiesPanel}
              {actionsPanel}
            </>
          )}

          {isMobile && (
            <div className="sr-bar">
              <Button variant="secondary" onClick={() => setStep(STEPS[Math.max(0, stepIdx - 1)].key)} disabled={stepIdx === 0}><ArrowLeftIcon size={14} color="currentColor" /> Back</Button>
              {stepIdx < STEPS.length - 1
                ? <Button onClick={() => setStep(STEPS[stepIdx + 1].key)}>{STEPS[stepIdx + 1].label} <ArrowRightIcon size={14} color="currentColor" /></Button>
                : <Button variant="secondary" to={'/surveys/' + id}><CheckIcon size={14} color="currentColor" /> Done</Button>}
            </div>
          )}
        </div>

        {!isMobile && (
          <div className="sr__side">
            {sketchPanel}
            {aiPanel}
            {quantitiesPanel}
            {actionsPanel}
          </div>
        )}
      </div>

      {lightbox >= 0 && photos[lightbox] && <PhotoLightbox photos={photos} index={lightbox} onClose={() => setLightbox(-1)} onChange={(i) => { if (i >= 0 && i < photos.length) setLightbox(i); }} onSave={savePhoto} onDelete={deletePhoto} onRender={data.max_enabled ? (p) => renderRoom(p, '') : null} renderHint={renderAllowanceText} />}
      {busy && <div className="sr-busy" role="status" aria-live="polite"><div className="sr-busy__card"><div className="sr-busy__ring" /><div className="sr-busy__title">{busy.title}</div><div className="sr-busy__sub">{busy.line}</div></div></div>}
      {confirmDel && (
        <Modal title="Delete this room?" onClose={() => setConfirmDel(false)} footer={<><Button variant="secondary" onClick={() => setConfirmDel(false)}>Keep it</Button><Button variant="danger" onClick={deleteRoom} busyLabel="Deleting…">Delete room</Button></>}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Its {photos.length} photo{photos.length === 1 ? '' : 's'}, sizes and notes go with it. An estimate MAX has made is kept.</p>
        </Modal>
      )}
    </div>
  );
}
