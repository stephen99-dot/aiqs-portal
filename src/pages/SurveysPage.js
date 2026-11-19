import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch, resolveUrl } from '../utils/api';
import useDataChanged from '../hooks/useDataChanged';
import { Button, Badge, PageHeader, EmptyState, SkeletonCard, Modal, Field, Input, useToast } from '../ui';
import { CameraIcon, ImageIcon, HomeIcon, MeasureIcon, SparklesIcon, PoundIcon } from '../components/Icons';
import RoomPlanSketch from '../components/survey/RoomPlanSketch';
import MaxUpsell from '../components/max/MaxUpsell';

// ═══ Room surveys — every property the builder has walked round ══════════════
// Photos, sizes, openings, finishes, condition, notes and the price all live
// here, per room, for as long as the account does. "Scan a room" starts a
// new property and drops straight into the capture flow for its first room.

const FILTERS = [{ key: 'all', label: 'All' }, { key: 'open', label: 'In progress' }, { key: 'priced', label: 'Priced' }];

function fmtDate(raw) {
  if (!raw) return '';
  const d = new Date(String(raw).replace(' ', 'T') + (String(raw).includes('Z') ? '' : 'Z'));
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function NewSurveyModal({ onClose, onCreated }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [customer, setCustomer] = useState('');
  const [room, setRoom] = useState('');
  const create = async () => {
    try {
      const s = await apiFetch('/surveys', { method: 'POST', body: JSON.stringify({ title: title.trim() || address.trim(), address: address.trim(), customer_name: customer.trim() }) });
      const r = await apiFetch('/surveys/' + s.id + '/rooms', { method: 'POST', body: JSON.stringify({ name: room.trim() || 'Room 1', room_type: room.trim() }) });
      onCreated(s, r.room);
    } catch (e) { toast.error(e.message || 'Could not start the survey.'); }
  };
  return (
    <Modal title="Scan a room" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={create} busyLabel="Starting…"><CameraIcon size={15} color="currentColor" /> Start capturing</Button></>}>
      <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>Where are you? Everything you capture is kept under this property, room by room — photos, sizes, what's wanted and the price.</p>
      <Field label="Property address" hint="Or a name for the job if you don't have it yet">
        <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="12 Hill Street, Leeds" autoFocus />
      </Field>
      <div className="sr-fields" style={{ marginTop: 10 }}>
        <Field label="Customer"><Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Mrs Patel" /></Field>
        <Field label="First room"><Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Kitchen" list="sv-room-types" /></Field>
      </div>
      <datalist id="sv-room-types">{['Kitchen', 'Living room', 'Bedroom', 'Bathroom', 'Hallway', 'Dining room', 'Office', 'Utility'].map((t) => <option key={t} value={t} />)}</datalist>
      <Field label="Survey title" hint="Optional — defaults to the address" className="" style={{ marginTop: 10 }}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kitchen and bathroom refit" />
      </Field>
    </Modal>
  );
}

export default function SurveysPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(params.get('new') === '1');
  // Scan a room is part of the MAX packages. Without one the page shows what
  // it is and where to get it rather than asking the server (which would 403).
  const locked = !!user && !user.maxEnabled;

  const load = useCallback(() => (locked ? Promise.resolve().then(() => setLoading(false)) : apiFetch('/surveys')
    .then((r) => { setSurveys(r.surveys || []); setError(''); })
    .catch((e) => setError(e.message || 'Could not load your surveys.'))
    .finally(() => setLoading(false))), [locked]);
  useEffect(() => { load(); }, [load]);
  useDataChanged(load, ['surveys']);
  useEffect(() => { if (params.get('new') === '1') setCreating(true); }, [params]);

  const closeNew = () => { setCreating(false); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }); } };
  const shown = surveys.filter((s) => filter === 'all' || (filter === 'priced' ? s.totals.priced > 0 : s.totals.priced < Math.max(1, s.totals.rooms)));
  const grand = surveys.reduce((a, s) => ({ rooms: a.rooms + s.totals.rooms, floor: a.floor + s.totals.floor_m2, photos: a.photos + s.totals.photos, priced: a.priced + s.totals.priced }), { rooms: 0, floor: 0, photos: 0, priced: 0 });

  if (locked) {
    return (
      <div className="page">
        <PageHeader title="Room surveys" subtitle="Walk the room with your phone. Photos, sizes, openings, finishes and notes are kept per room, with the quantities worked out and a price from your rates." />
        <MaxUpsell variant="max" />
        <div className="sv-hero">
          <div>
            <h2 className="sv-hero__title">How a room survey works</h2>
            <p className="sv-hero__sub">Two photos from opposite corners, the length and width (or a LiDAR scan on an iPhone Pro), and what the customer wants. The AI fills in the rest and MAX prices it from your rates. The report goes out as a branded PDF.</p>
            <div className="sv-hero__steps">
              <span className="sv-hero__step"><i>1</i> Photos</span>
              <span className="sv-hero__step"><i>2</i> Size &amp; shape</span>
              <span className="sv-hero__step"><i>3</i> What's wanted</span>
              <span className="sv-hero__step"><i>4</i> Survey &amp; price</span>
            </div>
          </div>
          <div className="sv-hero__art"><RoomPlanSketch room={{ name: 'Kitchen', length_m: 4.2, width_m: 3.1, openings: [{ kind: 'door', width_m: 0.84, height_m: 2, wall: 'C' }, { kind: 'window', width_m: 1.5, height_m: 1.2, wall: 'A' }] }} width={220} height={170} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Room surveys" subtitle="Walk the room with your phone. Photos, sizes, openings, finishes and notes are kept per room, with the quantities worked out and a price from your rates."
        actions={<Button onClick={() => setCreating(true)} data-tour="survey-new"><CameraIcon size={15} color="currentColor" /> Scan a room</Button>} />

      {!loading && surveys.length === 0 && !error && (
        <div className="sv-hero">
          <div>
            <h2 className="sv-hero__title">Your first room survey</h2>
            <p className="sv-hero__sub">Two photos from opposite corners, the length and width, and what the customer wants. The AI fills in the rest and MAX prices it from your rates{user && user.maxLimits ? ' — up to £' + Math.round(user.maxLimits.limitGbp).toLocaleString('en-GB') + ' ex VAT' : ''}.</p>
            <div className="sv-hero__steps">
              <span className="sv-hero__step"><i>1</i> Photos</span>
              <span className="sv-hero__step"><i>2</i> Size &amp; shape</span>
              <span className="sv-hero__step"><i>3</i> What's wanted</span>
              <span className="sv-hero__step"><i>4</i> Survey &amp; price</span>
            </div>
          </div>
          <div className="sv-hero__art"><RoomPlanSketch room={{ name: 'Kitchen', length_m: 4.2, width_m: 3.1, openings: [{ kind: 'door', width_m: 0.84, height_m: 2, wall: 'C' }, { kind: 'window', width_m: 1.5, height_m: 1.2, wall: 'A' }] }} width={220} height={170} /></div>
        </div>
      )}

      {surveys.length > 0 && (
        <div className="sv-totals">
          <div className="sv-total"><div className="sv-total__v">{surveys.length}</div><div className="sv-total__k">Properties</div></div>
          <div className="sv-total"><div className="sv-total__v">{grand.rooms}</div><div className="sv-total__k">Rooms</div></div>
          <div className="sv-total"><div className="sv-total__v">{Math.round(grand.floor)}<small>m²</small></div><div className="sv-total__k">Floor area</div></div>
          <div className="sv-total"><div className="sv-total__v">{grand.photos}</div><div className="sv-total__k">Photos kept</div></div>
          <div className="sv-total"><div className="sv-total__v">{grand.priced}</div><div className="sv-total__k">Rooms priced</div></div>
        </div>
      )}

      {surveys.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={'sr-chip' + (filter === f.key ? ' sr-chip--on' : '')} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="sv-grid"><SkeletonCard height={240} /><SkeletonCard height={240} /><SkeletonCard height={240} /></div>
      ) : error ? (
        <EmptyState icon={HomeIcon} title="Could not load surveys" body={error} action={<Button onClick={load}>Try again</Button>} />
      ) : shown.length === 0 ? (
        surveys.length === 0 ? null : <EmptyState icon={ImageIcon} title="Nothing here" body="No surveys match that filter." />
      ) : (
        <div className="sv-grid">
          {shown.map((s) => {
            const t = s.totals || {};
            const done = t.rooms > 0 && t.priced === t.rooms;
            return (
              <Link key={s.id} to={'/surveys/' + s.id} className="sv-card">
                <div className="sv-card__cover">
                  {s.cover_thumb ? <img src={resolveUrl(s.cover_thumb)} alt="" loading="lazy" /> : (
                    <div className="sv-card__cover-empty"><ImageIcon size={28} /><span>No photos yet</span></div>
                  )}
                  <div className="sv-card__status">
                    {done ? <Badge tone="success" size="sm">Priced</Badge> : t.surveyed > 0 ? <Badge tone="info" size="sm">{t.surveyed}/{t.rooms} surveyed</Badge> : <Badge tone="neutral" size="sm">Started</Badge>}
                    {!done && t.priced > 0 && <Badge tone="success" size="sm">{t.priced} priced</Badge>}
                  </div>
                  <span className="sv-card__count"><CameraIcon size={12} color="#fff" /> {t.photos || 0}</span>
                </div>
                <div className="sv-card__body">
                  <div className="sv-card__title">{s.title}</div>
                  <div className="sv-card__sub">{[s.address, s.customer_name].filter(Boolean).join(' · ') || 'No address yet'}</div>
                  {s.room_names && s.room_names.length > 0 && <div className="sv-card__rooms">{s.room_names.map((n, i) => <span key={i} className="sv-card__room">{n}</span>)}{t.rooms > s.room_names.length && <span className="sv-card__room">+{t.rooms - s.room_names.length}</span>}</div>}
                  <div className="sv-card__foot">
                    <span><strong>{t.rooms}</strong> room{t.rooms === 1 ? '' : 's'} · <strong>{t.floor_m2}</strong> m²</span>
                    <span>{fmtDate(s.updated_at)}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {surveys.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 20, fontSize: 12.5, color: 'var(--text-muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><MeasureIcon size={13} /> Quantities from the sizes you type or measure</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SparklesIcon size={13} /> AI fills gaps from the photos</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><PoundIcon size={13} /> MAX prices each room from your rates</span>
        </div>
      )}

      {creating && <NewSurveyModal onClose={closeNew} onCreated={(s, room) => { closeNew(); navigate('/surveys/' + s.id + '/rooms/' + room.id); }} />}
    </div>
  );
}
