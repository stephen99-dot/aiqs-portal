import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch, resolveUrl } from '../utils/api';
import useDataChanged from '../hooks/useDataChanged';
import { Button, Badge, PageHeader, EmptyState, SkeletonCard } from '../ui';
import { CameraIcon, ImageIcon, HomeIcon, MeasureIcon, SparklesIcon, PoundIcon, PlusIcon } from '../components/Icons';
import RoomPlanSketch from '../components/survey/RoomPlanSketch';
import MaxUpsell from '../components/max/MaxUpsell';

// ═══ Jobs — every job the builder has started on site ═══════════════════════
// A job is one property: what needs done (the brief), the rooms walked round
// with their photos, sizes, openings and notes, and the price from MAX. "New
// job" is the three-question flow (NewJobPage); ?new=1 from older links goes
// there too.

const FILTERS = [{ key: 'all', label: 'All' }, { key: 'open', label: 'In progress' }, { key: 'priced', label: 'Priced' }];

function fmtDate(raw) {
  if (!raw) return '';
  const d = new Date(String(raw).replace(' ', 'T') + (String(raw).includes('Z') ? '' : 'Z'));
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function Hero({ title, sub }) {
  return (
    <div className="sv-hero">
      <div>
        <h2 className="sv-hero__title">{title}</h2>
        <p className="sv-hero__sub">{sub}</p>
        <div className="sv-hero__steps">
          <span className="sv-hero__step"><i>1</i> Where</span>
          <span className="sv-hero__step"><i>2</i> What needs done</span>
          <span className="sv-hero__step"><i>3</i> Plans, if you want them</span>
          <span className="sv-hero__step"><i>4</i> Priced from your rates</span>
        </div>
      </div>
      <div className="sv-hero__art"><RoomPlanSketch room={{ name: 'Kitchen', length_m: 4.2, width_m: 3.1, openings: [{ kind: 'door', width_m: 0.84, height_m: 2, wall: 'C' }, { kind: 'window', width_m: 1.5, height_m: 1.2, wall: 'A' }] }} width={220} height={170} /></div>
    </div>
  );
}

export default function SurveysPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  // Jobs are part of the MAX packages. Without one the page shows what they
  // are and where to get them rather than asking the server (which would 403).
  const locked = !!user && !user.maxEnabled;

  const load = useCallback(() => (locked ? Promise.resolve().then(() => setLoading(false)) : apiFetch('/surveys')
    .then((r) => { setSurveys(r.surveys || []); setError(''); })
    .catch((e) => setError(e.message || 'Could not load your jobs.'))
    .finally(() => setLoading(false))), [locked]);
  useEffect(() => { load(); }, [load]);
  useDataChanged(load, ['surveys']);
  useEffect(() => { if (params.get('new') === '1') navigate('/jobs/new', { replace: true }); }, [params, navigate]);

  const isPriced = (s) => !!s.estimate_id || (s.totals.rooms > 0 && s.totals.priced === s.totals.rooms);
  const shown = surveys.filter((s) => filter === 'all' || (filter === 'priced' ? isPriced(s) || s.totals.priced > 0 : !isPriced(s)));
  const grand = surveys.reduce((a, s) => ({ rooms: a.rooms + s.totals.rooms, floor: a.floor + s.totals.floor_m2, photos: a.photos + s.totals.photos, priced: a.priced + (isPriced(s) ? 1 : 0) }), { rooms: 0, floor: 0, photos: 0, priced: 0 });

  if (locked) {
    return (
      <div className="page">
        <PageHeader title="Jobs" subtitle="Say where it is and what needs done, draw up the rooms if you want to, and MAX prices it from your rates." />
        <MaxUpsell variant="max" />
        <Hero title="How a job works" sub="Three questions to start: where, what needs done, and whether to draw up the rooms (a LiDAR scan on an iPhone Pro, or just the sizes). MAX prices the job from your rates, and the report goes out as a branded PDF." />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title="Jobs" subtitle="Every job you've started on site: what needs done, the rooms, the plans and the price from your rates."
        actions={<Button to="/jobs/new" data-tour="survey-new"><PlusIcon size={15} color="currentColor" /> New job</Button>} />

      {!loading && surveys.length === 0 && !error && (
        <Hero title="Your first job" sub={'Say where it is and what needs done. Draw up the rooms if you want the quantities measured, then MAX prices it from your rates' + (user && user.maxLimits ? ' — up to £' + Math.round(user.maxLimits.limitGbp).toLocaleString('en-GB') + ' ex VAT' : '') + '.'} />
      )}

      {surveys.length > 0 && (
        <div className="sv-totals">
          <div className="sv-total"><div className="sv-total__v">{surveys.length}</div><div className="sv-total__k">Jobs</div></div>
          <div className="sv-total"><div className="sv-total__v">{grand.rooms}</div><div className="sv-total__k">Rooms</div></div>
          <div className="sv-total"><div className="sv-total__v">{Math.round(grand.floor)}<small>m²</small></div><div className="sv-total__k">Floor area</div></div>
          <div className="sv-total"><div className="sv-total__v">{grand.photos}</div><div className="sv-total__k">Photos kept</div></div>
          <div className="sv-total"><div className="sv-total__v">{grand.priced}</div><div className="sv-total__k">Jobs priced</div></div>
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
        <EmptyState icon={HomeIcon} title="Could not load your jobs" body={error} action={<Button onClick={load}>Try again</Button>} />
      ) : shown.length === 0 ? (
        surveys.length === 0 ? null : <EmptyState icon={ImageIcon} title="Nothing here" body="No jobs match that filter." />
      ) : (
        <div className="sv-grid">
          {shown.map((s) => {
            const t = s.totals || {};
            const done = isPriced(s);
            return (
              <Link key={s.id} to={'/surveys/' + s.id} className="sv-card">
                <div className="sv-card__cover">
                  {s.cover_thumb ? <img src={resolveUrl(s.cover_thumb)} alt="" loading="lazy" /> : (
                    <div className="sv-card__cover-empty"><ImageIcon size={28} /><span>No photos yet</span></div>
                  )}
                  <div className="sv-card__status">
                    {done ? <Badge tone="success" size="sm">Priced</Badge> : t.surveyed > 0 ? <Badge tone="info" size="sm">{t.surveyed}/{t.rooms} surveyed</Badge> : <Badge tone="neutral" size="sm">Started</Badge>}
                    {!done && t.priced > 0 && <Badge tone="success" size="sm">{t.priced} priced</Badge>}
                    {!!s.visualise && <Badge tone="info" size="sm" outlined>Visualiser</Badge>}
                  </div>
                  <span className="sv-card__count"><CameraIcon size={12} color="#fff" /> {t.photos || 0}</span>
                </div>
                <div className="sv-card__body">
                  <div className="sv-card__title">{s.title}</div>
                  <div className="sv-card__sub">{[s.address !== s.title ? s.address : null, s.customer_name].filter(Boolean).join(' · ') || (s.brief ? 'No address yet' : 'No address or brief yet')}</div>
                  {s.brief && <div className="sv-card__sub sv-card__brief" title={s.brief}>{s.brief}</div>}
                  {s.room_names && s.room_names.length > 0 && <div className="sv-card__rooms">{s.room_names.map((n, i) => <span key={i} className="sv-card__room">{n}</span>)}{t.rooms > s.room_names.length && <span className="sv-card__room">+{t.rooms - s.room_names.length}</span>}</div>}
                  <div className="sv-card__foot">
                    <span>{t.rooms ? <><strong>{t.rooms}</strong> room{t.rooms === 1 ? '' : 's'} · <strong>{t.floor_m2}</strong> m²</> : 'No rooms drawn up'}</span>
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><MeasureIcon size={13} /> Quantities from the sizes you type or scan</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><SparklesIcon size={13} /> AI fills gaps from the photos</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><PoundIcon size={13} /> MAX prices the job from your rates</span>
        </div>
      )}
    </div>
  );
}
