import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

// The reviews panel on the sign-in and register pages: the business's real
// Trustpilot reviews, rotated one at a time, with the TrustScore and review
// count as Trustpilot states them. The server keeps them in step with the
// profile (server/trustpilotReviews.js); this reads the cached set from
// /api/public/trustpilot, which needs no sign-in.
//
// Until the first sync has run — or if it has never succeeded — the panel
// shows a plain invitation to read the reviews on Trustpilot. It never shows
// an invented one.

const TP_GREEN = '#00B67A';
const STAR_OFF = 'rgba(255,255,255,0.18)';
const PROFILE_URL = process.env.REACT_APP_TRUSTPILOT_PROFILE_URL || 'https://uk.trustpilot.com/review/theaiqs.co.uk';
const ROTATE_MS = 7000;
const BODY_LIMIT = 300;

export function useTrustpilotReviews() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    apiFetch('/public/trustpilot')
      .then((d) => { if (live) setData(d && Array.isArray(d.reviews) ? d : { reviews: [], business: null }); })
      .catch(() => { if (live) setData({ reviews: [], business: null }); });
    return () => { live = false; };
  }, []);
  return data;
}

// Trustpilot's own bands for a TrustScore.
export function trustScoreLabel(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const s = Number(score);
  if (s >= 4.3) return 'Excellent';
  if (s >= 3.8) return 'Great';
  if (s >= 2.8) return 'Average';
  if (s >= 1.8) return 'Poor';
  return 'Bad';
}

function Stars({ rating, size = 18 }) {
  const n = Math.max(0, Math.min(5, Math.round(rating || 0)));
  return (
    <div style={{ display: 'flex', gap: 3 }} aria-label={n + ' out of 5 stars'} role="img">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} style={{
          width: size, height: size, background: i <= n ? TP_GREEN : STAR_OFF, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.72, lineHeight: 1, flexShrink: 0,
        }}>★</div>
      ))}
    </div>
  );
}

function Wordmark({ size = 13 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#fff', fontWeight: 800, fontSize: size, letterSpacing: '-0.01em' }}>
      <span style={{ width: size + 3, height: size + 3, background: TP_GREEN, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size - 1, lineHeight: 1 }}>★</span>
      Trustpilot
    </span>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function clamp(body) {
  const t = String(body || '').trim();
  if (t.length <= BODY_LIMIT) return { text: t, cut: false };
  const head = t.slice(0, BODY_LIMIT);
  const stop = head.lastIndexOf(' ');
  return { text: (stop > BODY_LIMIT * 0.6 ? head.slice(0, stop) : head).replace(/[,;:.\s]+$/, '') + '…', cut: true };
}

export default function TrustpilotReviewCarousel() {
  const data = useTrustpilotReviews();
  const reviews = (data && data.reviews) || [];
  const business = (data && data.business) || null;
  const profileUrl = (business && business.url) || PROFILE_URL;
  const [current, setCurrent] = useState(0);
  const [fading, setFading] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reviews.length < 2 || paused) return undefined;
    const id = setInterval(() => {
      setFading(true);
      setTimeout(() => { setCurrent((c) => (c + 1) % reviews.length); setFading(false); }, 400);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [reviews.length, paused]);

  const go = (i) => { setFading(true); setTimeout(() => { setCurrent(i); setFading(false); }, 400); };

  // Still loading: hold the space so the panel doesn't jump when it lands.
  if (!data) return <div style={{ ...s.card, visibility: 'hidden', minHeight: 220 }} aria-hidden="true" />;

  const label = business ? trustScoreLabel(business.trust_score) : null;
  const scoreLine = business && business.trust_score != null
    ? (label ? label + ' · ' : '') + 'rated ' + Number(business.trust_score).toFixed(1) + ' out of 5'
      + (business.number_of_reviews != null ? ' from ' + business.number_of_reviews + ' review' + (business.number_of_reviews === 1 ? '' : 's') : '')
    : null;

  if (!reviews.length) {
    return (
      <div style={s.card}>
        <div style={s.head}>
          <Wordmark />
          {business && business.trust_score != null && <Stars rating={business.trust_score} size={16} />}
        </div>
        <p style={{ ...s.body, fontStyle: 'normal', margin: '14px 0 6px' }}>
          {scoreLine ? 'AI QS is ' + scoreLine + '.' : 'Read what builders and contractors say about AI QS.'}
        </p>
        <a href={profileUrl} target="_blank" rel="noopener noreferrer" style={s.link}>Read our reviews on Trustpilot →</a>
      </div>
    );
  }

  const r = reviews[current % reviews.length];
  const { text, cut } = clamp(r.body);
  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div style={{ ...s.card, opacity: fading ? 0 : 1, transition: 'opacity 0.4s ease' }}>
        <div style={s.head}>
          <Stars rating={r.rating} />
          {r.verified && <span style={s.verified}>Verified</span>}
        </div>
        {r.title && <div style={s.title}>{r.title}</div>}
        <p style={s.body}>
          {text}
          {cut && <> <a href={r.review_url || profileUrl} target="_blank" rel="noopener noreferrer" style={s.more}>Read on Trustpilot</a></>}
        </p>
        <div style={s.byline}>
          <span style={s.author}>{r.author}</span>
          {r.published_at && <span style={s.date}> · {formatDate(r.published_at)}</span>}
        </div>
      </div>
      <div style={s.foot}>
        <div style={s.dots}>
          {reviews.map((x, i) => (
            <button key={x.id || i} type="button" aria-label={'Review ' + (i + 1)} style={{ ...s.dot, ...(i === current % reviews.length ? s.dotActive : {}) }} onClick={() => go(i)} />
          ))}
        </div>
        <a href={profileUrl} target="_blank" rel="noopener noreferrer" style={s.footLink}>
          <Wordmark size={12} />
          {scoreLine && <span style={s.score}>{scoreLine}</span>}
        </a>
      </div>
    </div>
  );
}

const s = {
  card: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '24px 28px', backdropFilter: 'blur(8px)', marginBottom: 16 },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 },
  verified: { fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: TP_GREEN, border: '1px solid rgba(0,182,122,0.5)', borderRadius: 999, padding: '2px 8px' },
  title: { color: '#fff', fontSize: 15, fontWeight: 700, marginBottom: 6, lineHeight: 1.4 },
  body: { color: 'rgba(255,255,255,0.88)', fontSize: 14.5, lineHeight: 1.7, fontStyle: 'italic', margin: '0 0 16px' },
  more: { color: '#F5A623', textDecoration: 'none', fontStyle: 'normal', fontWeight: 600, fontSize: 13 },
  byline: { fontSize: 13 },
  author: { color: '#fff', fontWeight: 700 },
  date: { color: 'rgba(255,255,255,0.45)' },
  foot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 32 },
  dots: { display: 'flex', gap: 8 },
  dot: { width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', padding: 0, transition: 'all 0.3s' },
  dotActive: { background: '#F5A623', width: 20, borderRadius: 3 },
  footLink: { display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' },
  score: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  link: { color: '#F5A623', fontWeight: 600, fontSize: 13.5, textDecoration: 'none' },
};
