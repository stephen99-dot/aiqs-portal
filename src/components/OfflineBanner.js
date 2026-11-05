import React, { useEffect, useState } from 'react';

// A thin strip under the header when the device has no connection — on site a
// phone drops to no signal all the time, and without this a failed upload or
// an empty project list looks like the portal is broken.
export default function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  if (online) return null;
  return (
    <div role="status" style={{
      position: 'fixed', left: 0, right: 0, top: 0, zIndex: 20000,
      paddingTop: 'var(--safe-top)', background: 'var(--danger)', color: '#fff',
      fontSize: 12.5, fontWeight: 600, textAlign: 'center',
    }}>
      <div style={{ padding: '6px 12px' }}>You're offline — changes will go through when the connection is back.</div>
    </div>
  );
}
