import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import useLearn from '../../hooks/useLearn';
import { videoUrl, nextVideo } from '../../utils/learn';
import { canShowPurchases } from '../../utils/purchases';
import { Button, ProgressBar } from '../../ui';
import { PlayIcon, CheckIcon, ArrowRightIcon } from '../Icons';
import VideoModal from './VideoModal';

// ═══ The dashboard card: the next video to watch, and what to do next ═══════
// Takes the place of the written getting-started list. Gone once every video
// is watched and every step is done, or when the builder hides it.

const hideKey = (uid) => 'aiqs_learn_hidden_' + (uid || 'x');

export default function LearnCard() {
  const { user } = useAuth();
  const { data } = useLearn();
  const [open, setOpen] = useState(null);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(hideKey(user && user.id)) === '1'; } catch (e) { return false; } });
  if (!data || hidden) return null;
  const videos = data.videos || [];
  const next = nextVideo(data);
  const steps = (data.next || []).filter((s) => !s.done && !(s.web_only && !canShowPurchases())).slice(0, 3);
  if (!next && !steps.length) return null;
  const feature = next || videos[0];
  const videoFor = (key) => videos.find((v) => v.key === key) || null;
  const p = data.progress || { watched: 0, total: videos.length };
  const hide = () => { setHidden(true); try { localStorage.setItem(hideKey(user && user.id), '1'); } catch (e) { /* fine */ } };

  return (
    <div className="learn-card">
      {feature && (
        <button type="button" className="learn-card__poster" onClick={() => setOpen(feature)} aria-label={'Play: ' + feature.title}>
          <img src={videoUrl(feature.poster)} alt="" loading="lazy" />
          <span className="learn-play"><PlayIcon size={22} color="currentColor" /></span>
          <span className="learn-card__poster-cap">{next ? 'Next video' : 'Watch again'} · {feature.title}</span>
        </button>
      )}
      <div className="learn-card__body">
        <div className="learn-card__head">
          <div>
            <div className="learn-card__title">Learn the portal</div>
            <div className="learn-card__sub">{p.watched === 0 ? 'Short videos of each thing the portal does. Tick them off as you go.' : p.watched + ' of ' + p.total + ' videos watched.'}</div>
          </div>
          <div className="learn-card__links">
            <Link to="/learn" className="learn-card__all">All videos <ArrowRightIcon size={13} /></Link>
            <Button variant="ghost" size="sm" onClick={hide}>Hide</Button>
          </div>
        </div>
        <ProgressBar value={p.total ? (p.watched / p.total) * 100 : 0} tone="gradient" height={3} style={{ margin: '10px 0 12px' }} />
        {steps.length > 0 && (
          <div className="learn-steps learn-steps--compact">
            {steps.map((s) => {
              const v = videoFor(s.video);
              return (
                <div key={s.key} className="learn-step">
                  <span className="learn-step__dot" />
                  <div className="learn-step__main"><div className="learn-step__title">{s.title}</div><div className="learn-step__body">{s.body}</div></div>
                  <div className="learn-step__actions">
                    {v && <button type="button" className="learn-step__watch" onClick={() => setOpen(v)}><PlayIcon size={11} color="currentColor" /> Watch</button>}
                    <Link to={s.path} className="learn-step__go">Do it <ArrowRightIcon size={12} /></Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!steps.length && next && <div className="learn-card__sub"><CheckIcon size={13} color="var(--success)" /> Everything's set up — the rest of the videos are there when you want them.</div>}
      </div>
      {open && <VideoModal video={open} videos={videos} onClose={() => setOpen(null)} />}
    </div>
  );
}
