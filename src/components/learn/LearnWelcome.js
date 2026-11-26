import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import useLearn from '../../hooks/useLearn';
import { markIntroSeen, videoUrl } from '../../utils/learn';
import { Button, IconButton } from '../../ui';
import { PlayIcon, ArrowRightIcon } from '../Icons';
import VideoModal from './VideoModal';

// ═══ The one-time pointer to the videos ═════════════════════════════════════
// In place of the sign-in tour and the MAX showcase: the first time an
// account opens the portal after this went live (and the first time a new
// account lands on the dashboard), one card says the how-to videos exist and
// offers the first one. It is marked seen on the account the moment it
// shows, so it never comes back — on this device or any other.

const QUIET = ['/login', '/register', '/forgot-password', '/onboarding', '/payment-success', '/magic', '/learn', '/v/', '/q/', '/i/'];

export default function LearnWelcome() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { data } = useLearn();
  const [open, setOpen] = useState(false);
  const [play, setPlay] = useState(null);
  const [marked, setMarked] = useState(false);

  const quiet = QUIET.some((p) => location.pathname.startsWith(p));
  useEffect(() => {
    if (!user || !data || marked || quiet) return;
    if (data.intro_seen) return;
    setOpen(true); setMarked(true);
    markIntroSeen();
  }, [user, data, marked, quiet]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open]);

  if (!user || !data) return null;
  const videos = data.videos || [];
  const first = videos[0];
  if (play) return <VideoModal video={play} videos={videos} onClose={() => { setPlay(null); setOpen(false); }} />;
  if (!open || !first) return null;
  const close = () => setOpen(false);

  return (
    <div className="ui-modal-overlay" onClick={close}>
      <div className="ui-modal learn-welcome" style={{ maxWidth: 640 }} role="dialog" aria-modal="true" aria-label="How-to videos" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="learn-welcome__poster" onClick={() => setPlay(first)} aria-label={'Play: ' + first.title}>
          <img src={videoUrl(first.poster)} alt="" />
          <span className="learn-play"><PlayIcon size={22} color="currentColor" /></span>
        </button>
        <div className="learn-welcome__body">
          <div className="learn-welcome__head">
            <div>
              <div className="learn-player__kicker">New · {videos.length} short videos</div>
              <h2 className="learn-welcome__title">See how it's done, don't read about it</h2>
            </div>
            <IconButton onClick={close} aria-label="Close">✕</IconButton>
          </div>
          <p className="learn-welcome__text">Every part of the portal, shown in a minute or so: getting a BOQ from your drawings, pricing a small job with MAX, starting a job, scanning a room, the Visualiser, your rates and your branding. Tick each one off as you watch it — they are under <strong>How-to videos</strong> in the menu whenever you want them.</p>
          <div className="learn-welcome__actions">
            <Button variant="ghost" onClick={close}>Not now</Button>
            <span className="learn-player__spacer" />
            <Button variant="secondary" onClick={() => { close(); navigate('/learn'); }}>All videos <ArrowRightIcon size={14} color="currentColor" /></Button>
            <Button onClick={() => setPlay(first)}><PlayIcon size={13} color="currentColor" /> Watch the first one</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
