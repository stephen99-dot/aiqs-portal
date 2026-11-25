import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch, resolveUrl } from '../utils/api';
import useDataChanged from '../hooks/useDataChanged';
import { openMax, fmtMoney2 } from '../utils/max';
import downloadFile from '../utils/downloadFile';
import { Button, Badge, EmptyState, SkeletonCard, Modal, Field, Input, useToast } from '../ui';
import { CameraIcon, PlusIcon, TrashIcon, FileTextIcon, FileSpreadsheetIcon, LayersIcon, PoundIcon, UploadIcon, ArrowLeftIcon, MicIcon, ImageIcon, SparklesIcon, ExternalLinkIcon } from '../components/Icons';
import RoomPlanSketch from '../components/survey/RoomPlanSketch';
import { ROOM_TYPES, FLOOR_LEVELS } from '../utils/surveyGeometry';

// ═══ One job: what needs done, its rooms, the totals, the price, the exports ═

const STATUS = { draft: ['neutral', 'Capturing'], surveyed: ['info', 'Surveyed'], priced: ['success', 'Priced'] };
const PRICING_LINES = ['Reading what needs done…', 'Taking off the quantities…', 'Pricing every line from your rates…', 'Adding your margins and VAT…'];

async function download(path, filename, toast) {
  try { await downloadFile(path, filename); }
  catch (e) { toast.error(e.message || 'Could not download.'); }
}

function AddRoomModal({ onClose, onAdd }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [floor, setFloor] = useState('Ground');
  return (
    <Modal title="Add a room" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => onAdd({ name: name.trim() || type || undefined, room_type: type, floor_level: floor })} busyLabel="Adding…"><PlusIcon size={14} color="currentColor" /> Add room</Button></>}>
      <div className="sr-chips" style={{ marginBottom: 12 }}>
        {ROOM_TYPES.map((t) => <button key={t} type="button" className={'sr-chip' + (type === t ? ' sr-chip--on' : '')} onClick={() => { setType(t); if (!name) setName(''); }}>{t}</button>)}
      </div>
      <div className="sr-fields">
        <Field label="Name" hint="e.g. Back bedroom"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={type || 'Room'} /></Field>
        <Field label="Floor"><select className="ui-select" value={floor} onChange={(e) => setFloor(e.target.value)}>{FLOOR_LEVELS.map((f) => <option key={f}>{f}</option>)}</select></Field>
      </div>
    </Modal>
  );
}

export default function SurveyPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [head, setHead] = useState(null);
  const [busy, setBusy] = useState(null);           // { title, line } while MAX prices
  const [priceResult, setPriceResult] = useState(null);
  const saveTimer = useRef(null);

  const load = useCallback(() => apiFetch('/surveys/' + id)
    .then((r) => { setData(r); setHead((h) => h || { title: r.survey.title || '', address: r.survey.address || '', customer_name: r.survey.customer_name || '', customer_email: r.survey.customer_email || '', notes: r.survey.notes || '', brief: r.survey.brief || '' }); setError(''); })
    .catch((e) => setError(e.message || 'Could not open that survey.')), [id]);
  useEffect(() => { load(); }, [load]);
  useDataChanged(load, ['surveys']);

  const editHead = (k, v) => {
    setHead((h) => ({ ...h, [k]: v }));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      apiFetch('/surveys/' + id, { method: 'PATCH', body: JSON.stringify({ [k]: v }) }).catch((e) => toast.error(e.message || 'Could not save.'));
    }, 600);
  };

  const addRoom = async (body) => {
    try {
      const r = await apiFetch('/surveys/' + id + '/rooms', { method: 'POST', body: JSON.stringify(body) });
      setAdding(false);
      navigate('/surveys/' + id + '/rooms/' + r.room.id);
    } catch (e) { toast.error(e.message || 'Could not add the room.'); }
  };
  const del = async () => {
    try { await apiFetch('/surveys/' + id, { method: 'DELETE' }); toast.success('Job deleted'); navigate('/surveys'); }
    catch (e) { toast.error(e.message || 'Could not delete.'); }
  };
  // MAX prices the whole job: the brief plus every measured room. The brief
  // goes with the request so a just-typed change is priced, not the saved one.
  const price = async () => {
    clearTimeout(saveTimer.current);
    let n = 0;
    setBusy({ title: 'MAX is pricing the job', line: PRICING_LINES[0] });
    const tick = setInterval(() => { n = (n + 1) % PRICING_LINES.length; setBusy((b) => (b ? { ...b, line: PRICING_LINES[n] } : b)); }, 2600);
    try {
      const r = await apiFetch('/surveys/' + id + '/price', { method: 'POST', body: JSON.stringify({ brief: head.brief || '' }) });
      setPriceResult({ ...(r.result || {}), card: (r.cards && r.cards[0]) || null });
      load();
    } catch (e) { toast.error(e.message || 'Could not price the job.'); }
    finally { clearInterval(tick); setBusy(null); }
  };

  if (error) return <div className="page"><EmptyState icon={ImageIcon} title="Survey not found" body={error} action={<Button to="/surveys">All surveys</Button>} /></div>;
  if (!data || !head) return <div className="page"><SkeletonCard height={90} /><div style={{ height: 14 }} /><div className="sp-rooms"><SkeletonCard height={230} /><SkeletonCard height={230} /></div></div>;

  const { survey, rooms, totals, estimate } = data;
  const anyCapture = rooms.some((r) => r.has_capture);
  const priced = rooms.filter((r) => r.estimate_id);
  const brief = () => {
    const lines = rooms.map((r) => {
      const q = r.quantities || {};
      return r.name + (q.complete ? ' (' + q.floor_m2 + ' m² floor, ' + q.wall_net_m2 + ' m² walls, ' + q.perimeter_m + ' m perimeter)' : '') + (r.work_wanted ? ': ' + r.work_wanted : '');
    });
    return 'Job — ' + survey.title + (survey.address ? ', ' + survey.address : '') + (head.brief ? '\nWhat needs done: ' + head.brief : '') + '\n' + lines.join('\n');
  };
  const sendParams = new URLSearchParams({ from: 'max', address: survey.address || '', brief: brief().slice(0, 2500) });

  return (
    <div className="page">
      <div className="sr-head">
        <div className="sr-head__left">
          <div className="sr-head__kicker"><Link to="/surveys"><ArrowLeftIcon size={13} /> Jobs</Link>{!!survey.visualise && <span>· Visualiser</span>}</div>
          <input className="sp-inline sp-inline--title" value={head.title} onChange={(e) => editHead('title', e.target.value)} placeholder="Job title" aria-label="Job title" />
          <div className="sp-head__row" style={{ marginTop: 4 }}>
            <input className="sp-inline sp-inline--sub" value={head.address} onChange={(e) => editHead('address', e.target.value)} placeholder="Property address" aria-label="Address" />
            <input className="sp-inline sp-inline--sub" value={head.customer_name} onChange={(e) => editHead('customer_name', e.target.value)} placeholder="Customer name" aria-label="Customer" />
            <input className="sp-inline sp-inline--sub" value={head.customer_email} onChange={(e) => editHead('customer_email', e.target.value)} placeholder="Customer email" aria-label="Customer email" type="email" />
          </div>
        </div>
        <div className="sp-actions">
          <Button onClick={() => setAdding(true)}><PlusIcon size={14} color="currentColor" /> Add room</Button>
          <Button variant="secondary" onClick={() => download('/api/surveys/' + id + '/report.pdf', (survey.title || 'survey').replace(/[^\w-]+/g, '_') + '.pdf', toast)} busyLabel="Making PDF…" disabled={!rooms.length}><FileTextIcon size={14} color="currentColor" /> Report PDF</Button>
          <Button variant="secondary" onClick={() => download('/api/surveys/' + id + '/schedule.xlsx', (survey.title || 'survey').replace(/[^\w-]+/g, '_') + '.xlsx', toast)} busyLabel="Making Excel…" disabled={!rooms.length}><FileSpreadsheetIcon size={14} color="currentColor" /> Schedule Excel</Button>
          {anyCapture && <Button variant="secondary" onClick={() => download('/api/surveys/' + id + '/plan.pdf', (survey.title || 'survey').replace(/[^\w-]+/g, '_') + '_plans.pdf', toast)} busyLabel="Drawing…"><LayersIcon size={14} color="currentColor" /> Floor plans</Button>}
          <Button variant="ghost" onClick={() => setConfirmDel(true)} aria-label="Delete job"><TrashIcon size={14} color="currentColor" /></Button>
        </div>
      </div>

      <div style={{ margin: '0 0 16px' }}>
        <Field label="What needs done" hint="The job in your words — this is what MAX prices, with the rooms' quantities once they are measured">
          <textarea className="ui-textarea" rows={3} value={head.brief} onChange={(e) => editHead('brief', e.target.value)} placeholder="Strip the bathroom back, new suite, tile the floor and walls, two coats to the ceiling." />
        </Field>
      </div>

      {rooms.length > 0 && <div className="sv-totals">
        <div className="sv-total"><div className="sv-total__v">{totals.rooms}</div><div className="sv-total__k">Rooms</div></div>
        <div className="sv-total"><div className="sv-total__v">{totals.floor_m2}<small>m²</small></div><div className="sv-total__k">Floor</div></div>
        <div className="sv-total"><div className="sv-total__v">{totals.wall_net_m2}<small>m²</small></div><div className="sv-total__k">Walls net</div></div>
        <div className="sv-total"><div className="sv-total__v">{totals.perimeter_m}<small>m</small></div><div className="sv-total__k">Perimeter</div></div>
        <div className="sv-total"><div className="sv-total__v">{totals.doors}<small>/ {totals.windows}</small></div><div className="sv-total__k">Doors / windows</div></div>
        <div className="sv-total"><div className="sv-total__v">{totals.photos}</div><div className="sv-total__k">Photos</div></div>
      </div>}

      <div className="sp-rooms">
        {rooms.map((r) => {
          const q = r.quantities || {};
          const [tone, label] = STATUS[r.status] || STATUS.draft;
          return (
            <Link key={r.id} to={'/surveys/' + id + '/rooms/' + r.id} className="sp-room">
              <div className="sp-room__cover">
                {r.cover_thumb ? <img src={resolveUrl(r.cover_thumb)} alt="" loading="lazy" /> : <RoomPlanSketch room={r} width={220} height={150} mini />}
                <div className="sp-room__badges">
                  <Badge tone={tone} size="sm">{label}</Badge>
                  {r.photo_count > 0 && <span className="sv-card__count" style={{ position: 'static' }}><CameraIcon size={12} color="#fff" /> {r.photo_count}</span>}
                </div>
              </div>
              <div className="sp-room__body">
                <div className="sp-room__name"><span>{r.name}</span>{r.has_capture && <Badge tone="success" size="sm" outlined>LiDAR</Badge>}</div>
                <div className="sp-room__meta">{[r.room_type, r.floor_level && r.floor_level + ' floor'].filter(Boolean).join(' · ') || 'Tap to capture'}</div>
                {q.complete ? (
                  <div className="sp-room__figs"><span><b>{q.floor_m2}</b> m²</span><span><b>{q.wall_net_m2}</b> m² walls</span><span><b>{q.doors}</b>d <b>{q.windows}</b>w</span></div>
                ) : <div className="sp-room__figs" style={{ color: 'var(--text-muted)' }}>No size yet</div>}
                {r.work_wanted && <div className="sp-room__work">{r.work_wanted}</div>}
              </div>
            </Link>
          );
        })}
        <button type="button" className="sp-room sp-room--add" onClick={() => setAdding(true)}><PlusIcon /> Add another room</button>
      </div>

      {user && user.maxEnabled && (
        <div className="sp-send">
          <div>
            <div className="sp-send__title">{estimate ? 'Priced by MAX' : 'Price this job'}</div>
            <div className="sp-send__sub">{estimate
              ? 'Estimate ' + estimate.quote_number + ' at ' + fmtMoney2(estimate.grand_total) + ' inc VAT. Open it to edit and send, or price it again after a change.'
              : (priced.length ? priced.length + ' of ' + rooms.length + ' rooms priced by MAX on their own pages. ' : '') + 'MAX prices the whole job from what needs done' + (rooms.some((r) => (r.quantities || {}).complete) ? ' and the measured rooms' : '') + ', using your rates. Bigger jobs go to the AI QS team with this as the brief.'}</div>
          </div>
          <div className="sp-actions">
            <Button onClick={price} disabled={!(head.brief || '').trim() && !rooms.some((r) => r.work_wanted)} title={!(head.brief || '').trim() && !rooms.some((r) => r.work_wanted) ? 'Say what needs done first' : undefined}><PoundIcon size={14} color="currentColor" /> {estimate ? 'Price it again' : 'Price with MAX'}</Button>
            {estimate && <Button variant="secondary" to={'/estimates/' + estimate.id}><ExternalLinkIcon size={14} color="currentColor" /> Open estimate</Button>}
            <Button variant="secondary" onClick={() => openMax({ prompt: 'Look at my job "' + survey.title + '" and tell me what is still missing before it can be priced.', send: true })}><MicIcon size={14} color="currentColor" /> Ask MAX</Button>
            <Button variant="secondary" to={'/submit-drawings?' + sendParams.toString()}><UploadIcon size={14} color="currentColor" /> Send to AI QS team</Button>
          </div>
        </div>
      )}
      {priceResult && (
        <div className={'sr-price' + (priceResult.over_limit || priceResult.error ? ' sr-price--warn' : '')} style={{ marginTop: 12 }}>
          {priceResult.over_limit ? (
            <>
              <div className="sr-price__eyebrow">Over the small-job limit</div>
              <div className="sr-price__big">{fmtMoney2(priceResult.rough_price_ex_vat)}<small>rough, ex VAT</small></div>
              <div className="sr-price__text">MAX prices jobs up to {fmtMoney2(priceResult.limit_gbp)}. Send this one to the AI QS team for a full take-off from drawings.</div>
              <div className="sr-price__row">{priceResult.card && priceResult.card.submit_path && <Button size="sm" to={priceResult.card.submit_path}><UploadIcon size={13} color="currentColor" /> Send to the AI QS team</Button>}<Button size="sm" variant="ghost" onClick={() => setPriceResult(null)}>Dismiss</Button></div>
            </>
          ) : (
            <>
              <div className="sr-price__eyebrow">Priced by MAX{priceResult.quote_number ? ' · ' + priceResult.quote_number : ''}</div>
              <div className="sr-price__big">{fmtMoney2(priceResult.price_ex_vat)}<small>ex VAT · {fmtMoney2(priceResult.grand_total_inc_vat)} inc</small></div>
              <div className="sr-price__text">{priceResult.lines} lines from {priceResult.rates_used && priceResult.rates_used.own_rates ? 'your rates' : 'the rate library'}{priceResult.rates_used && priceResult.rates_used.estimated_rates ? ', ' + priceResult.rates_used.estimated_rates + ' on an estimated rate to check' : ''}.{priceResult.verdict_note ? ' ' + priceResult.verdict_note : ''}</div>
              <div className="sr-price__row">{priceResult.estimate_id && <Button size="sm" to={'/estimates/' + priceResult.estimate_id}><PoundIcon size={13} color="currentColor" /> Open estimate</Button>}<Button size="sm" variant="ghost" onClick={() => setPriceResult(null)}>Dismiss</Button></div>
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Field label="Notes about the property" hint="Access, parking, the customer's priorities — anything that applies to every room">
          <textarea className="ui-textarea" rows={2} value={head.notes} onChange={(e) => editHead('notes', e.target.value)} placeholder="Parking on the drive. Customer works from home — keep noise down before 10." />
        </Field>
      </div>

      {rooms.length === 0 && (
        <div style={{ marginTop: 14 }}><EmptyState icon={SparklesIcon} title="No rooms drawn up" body="MAX can price the job from what needs done. Add a room to measure it — a LiDAR scan, or the sizes — and the quantities come off the plan." action={<Button onClick={() => setAdding(true)}><CameraIcon size={14} color="currentColor" /> Add a room</Button>} /></div>
      )}

      {adding && <AddRoomModal onClose={() => setAdding(false)} onAdd={addRoom} />}
      {confirmDel && (
        <Modal title="Delete this job?" onClose={() => setConfirmDel(false)} footer={<><Button variant="secondary" onClick={() => setConfirmDel(false)}>Keep it</Button><Button variant="danger" onClick={del} busyLabel="Deleting…">Delete job</Button></>}>
          <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Every room, photo and note under <strong>{survey.title}</strong> goes with it. Estimates MAX has already made are kept.</p>
        </Modal>
      )}
      {busy && <div className="sr-busy" role="status" aria-live="polite"><div className="sr-busy__card"><div className="sr-busy__ring" /><div className="sr-busy__title">{busy.title}</div><div className="sr-busy__sub">{busy.line}</div></div></div>}
    </div>
  );
}
