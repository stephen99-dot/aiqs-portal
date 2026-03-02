import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../utils/api';

// Toast notification that auto-appears when new notifications arrive
function NotificationToast({ notification, onClose, theme }) {
  const isDark = theme === 'dark';

  useEffect(() => {
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const iconMap = {
    'user-plus': (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
      </svg>
    ),
    'folder-plus': (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
      </svg>
    ),
  };

  return (
    <div style={{
      position: 'fixed', top: '20px', right: '20px', zIndex: 99999,
      width: '340px',
      background: isDark ? '#131A2B' : '#FFFFFF',
      border: `1px solid ${isDark ? '#1E293B' : '#E2E8F0'}`,
      borderLeft: '3px solid #F59E0B',
      borderRadius: '12px',
      boxShadow: isDark
        ? '0 16px 48px rgba(0,0,0,0.5)'
        : '0 16px 48px rgba(0,0,0,0.12)',
      padding: '14px 16px',
      display: 'flex', gap: '12px', alignItems: 'flex-start',
      animation: 'toastSlideIn 0.35s cubic-bezier(0.22,1,0.36,1)',
      cursor: 'pointer',
    }} onClick={onClose}>
      {/* Icon */}
      <div style={{
        width: '34px', height: '34px', borderRadius: '9px', flexShrink: 0,
        background: notification.icon === 'user-plus' ? 'rgba(245,158,11,0.1)' : 'rgba(56,189,248,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {iconMap[notification.icon] || iconMap['user-plus']}
      </div>
      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '12.5px', fontWeight: 700,
          color: isDark ? '#F1F5F9' : '#0F172A',
          lineHeight: 1.35, marginBottom: '3px',
        }}>
          {notification.title}
        </div>
        {notification.detail && (
          <div style={{
            fontSize: '11.5px', color: isDark ? '#94A3B8' : '#64748B',
            lineHeight: 1.3,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {notification.detail}
          </div>
        )}
        <div style={{ fontSize: '10px', color: isDark ? '#475569' : '#94A3B8', marginTop: '4px' }}>
          Just now
        </div>
      </div>
      {/* Close X */}
      <button onClick={(e) => { e.stopPropagation(); onClose(); }} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: isDark ? '#475569' : '#94A3B8', padding: '2px', flexShrink: 0,
        marginTop: '-2px',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      {/* Auto-dismiss progress bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: '2px', borderRadius: '0 0 12px 12px', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', background: '#F59E0B',
          animation: 'toastProgress 6s linear forwards',
        }} />
      </div>
    </div>
  );
}

// Play a subtle notification sound
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    // silently fail if audio not supported
  }
}

export default function NotificationBell() {
  const { t, mode } = useTheme();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const ref = useRef(null);
  const prevUnreadRef = useRef(0);
  const initialLoadRef = useRef(true);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await apiFetch('/notifications');
      const newNotifications = data.notifications || [];
      const newUnread = data.unreadCount || 0;

      // Show toast if unread count increased (skip on first load)
      if (!initialLoadRef.current && newUnread > prevUnreadRef.current) {
        const newest = newNotifications.find(n => !n.read);
        if (newest) {
          setToast(newest);
          playNotificationSound();
        }
      }

      initialLoadRef.current = false;
      prevUnreadRef.current = newUnread;
      setNotifications(newNotifications);
      setUnreadCount(newUnread);
    } catch (err) {
      // silently fail
    }
  }, []);

  // Poll every 15 seconds
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const markAllRead = async () => {
    try {
      setLoading(true);
      await apiFetch('/notifications/read-all', { method: 'PUT' });
      setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
      setUnreadCount(0);
      prevUnreadRef.current = 0;
    } catch (err) {
      console.error('Failed to mark all read:', err);
    } finally {
      setLoading(false);
    }
  };

  const markRead = async (id) => {
    try {
      await apiFetch(`/notifications/${id}/read`, { method: 'PUT' });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: 1 } : n));
      const newCount = Math.max(0, unreadCount - 1);
      setUnreadCount(newCount);
      prevUnreadRef.current = newCount;
    } catch (err) {
      console.error('Failed to mark read:', err);
    }
  };

  const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  const iconMap = {
    'user-plus': (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
      </svg>
    ),
    'folder-plus': (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
      </svg>
    ),
    'user': (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  };

  const isDark = mode === 'dark';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Toast popup — appears top-right of screen */}
      {toast && (
        <NotificationToast
          notification={toast}
          onClose={() => setToast(null)}
          theme={mode}
        />
      )}

      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'relative',
          background: open
            ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)')
            : 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '6px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'none'; }}
        title="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={unreadCount > 0 ? '#F59E0B' : (t.textMuted || '#64748B')} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: '2px', right: '2px',
            background: '#EF4444', color: '#fff',
            fontSize: '9px', fontWeight: 700,
            width: unreadCount > 9 ? '16px' : '14px', height: '14px',
            borderRadius: '7px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
            boxShadow: '0 0 0 2px ' + (isDark ? '#090D16' : '#FAFBFD'),
            animation: 'notifPulse 2s ease-in-out infinite',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'fixed',
          top: '16px',
          left: '250px',
          width: '340px',
          maxHeight: '460px',
          background: isDark ? '#131A2B' : '#FFFFFF',
          border: `1px solid ${isDark ? '#1E293B' : '#E2E8F0'}`,
          borderRadius: '14px',
          boxShadow: isDark
            ? '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)'
            : '0 20px 60px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
          zIndex: 9999,
          overflow: 'hidden',
          animation: 'notifSlide 0.2s ease-out',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px',
            borderBottom: `1px solid ${isDark ? '#1E293B' : '#F1F5F9'}`,
          }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: t.text }}>
              Notifications
              {unreadCount > 0 && (
                <span style={{
                  marginLeft: '8px', fontSize: '10px', fontWeight: 600,
                  background: 'rgba(245,158,11,0.12)', color: '#F59E0B',
                  padding: '2px 7px', borderRadius: '5px',
                }}>
                  {unreadCount} new
                </span>
              )}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '11px', color: '#F59E0B', fontWeight: 600,
                  opacity: loading ? 0.5 : 1,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div style={{ overflowY: 'auto', maxHeight: '400px' }}>
            {notifications.length === 0 ? (
              <div style={{
                padding: '36px 20px', textAlign: 'center',
                color: t.textMuted || '#64748B', fontSize: '12px',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '10px', opacity: 0.35 }}>
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                <div>No notifications yet</div>
                <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.6 }}>
                  You'll see alerts here when clients sign up or submit projects
                </div>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => { if (!n.read) markRead(n.id); }}
                  style={{
                    display: 'flex', gap: '10px', padding: '11px 16px',
                    borderBottom: `1px solid ${isDark ? 'rgba(30,41,59,0.5)' : 'rgba(241,245,249,0.8)'}`,
                    cursor: n.read ? 'default' : 'pointer',
                    background: n.read
                      ? 'transparent'
                      : (isDark ? 'rgba(245,158,11,0.03)' : 'rgba(245,158,11,0.04)'),
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => {
                    if (!n.read) e.currentTarget.style.background = isDark ? 'rgba(245,158,11,0.06)' : 'rgba(245,158,11,0.07)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = n.read
                      ? 'transparent'
                      : (isDark ? 'rgba(245,158,11,0.03)' : 'rgba(245,158,11,0.04)');
                  }}
                >
                  <div style={{
                    width: '30px', height: '30px', borderRadius: '8px', flexShrink: 0,
                    background: n.icon === 'user-plus'
                      ? 'rgba(245,158,11,0.1)'
                      : n.icon === 'folder-plus'
                        ? 'rgba(56,189,248,0.1)'
                        : (isDark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.12)'),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {iconMap[n.icon] || iconMap['user']}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '12.5px', fontWeight: n.read ? 400 : 600,
                      color: t.text, lineHeight: 1.35,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {n.title}
                    </div>
                    {n.detail && (
                      <div style={{
                        fontSize: '11px', color: t.textMuted || '#64748B',
                        marginTop: '2px', lineHeight: 1.3,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {n.detail}
                      </div>
                    )}
                    <div style={{
                      fontSize: '10px', color: t.textMuted || '#64748B',
                      marginTop: '3px', opacity: 0.6,
                    }}>
                      {timeAgo(n.created_at)}
                    </div>
                  </div>
                  {!n.read && (
                    <div style={{
                      width: '7px', height: '7px', borderRadius: '50%',
                      background: '#F59E0B', flexShrink: 0, marginTop: '5px',
                    }} />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Animations */}
      <style>{`
        @keyframes notifPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        @keyframes notifSlide {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes toastProgress {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}
