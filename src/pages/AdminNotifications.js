import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

// ═══════════════════════════════════════════════════════════════════
// ADMIN NOTIFICATIONS — polls for new activity, shows toast popups
// Drop this into your App.js layout so it runs on every page.
//
// Usage in App.js:
//   import AdminNotifications from './components/AdminNotifications';
//   // Inside your layout, after the router:
//   <AdminNotifications />
// ═══════════════════════════════════════════════════════════════════

const POLL_INTERVAL = 30000; // 30 seconds

const EVENT_CONFIG = {
  signup:            { icon: '👤', color: '#10B981', label: 'New Signup' },
  login:             { icon: '🔑', color: '#3B82F6', label: 'Login' },
  project_created:   { icon: '📋', color: '#F59E0B', label: 'New Project' },
  project_completed: { icon: '✅', color: '#10B981', label: 'Completed' },
  plan_changed:      { icon: '💳', color: '#8B5CF6', label: 'Plan Changed' },
  error:             { icon: '❌', color: '#EF4444', label: 'Error' },
};

const DEFAULT_EVENT = { icon: 'ℹ️', color: '#94A3B8', label: 'Activity' };

// Only show toasts for these event types (skip logins — too noisy)
const NOTIFY_TYPES = ['signup', 'project_created', 'project_completed', 'plan_changed', 'error'];

export default function AdminNotifications() {
  const { user } = useAuth();
  const [toasts, setToasts] = useState([]);
  const lastCheckRef = useRef(null);
  const initialLoadDone = useRef(false);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    // Only run for admin users
    if (!user || user.role !== 'admin') return;

    async function checkForNew() {
      try {
        const data = await apiFetch('/admin/activity?limit=5');
        const activities = data.activities || [];
        if (activities.length === 0) return;

        // On first load, just record the latest timestamp — don't show toasts for old events
        if (!initialLoadDone.current) {
          lastCheckRef.current = activities[0].created_at;
          initialLoadDone.current = true;
          return;
        }

        // Find events newer than last check
        const newEvents = activities.filter(a =>
          a.created_at > lastCheckRef.current && NOTIFY_TYPES.includes(a.event_type)
        );

        if (newEvents.length > 0) {
          lastCheckRef.current = activities[0].created_at;

          // Add toasts (max 3 at a time)
          const newToasts = newEvents.slice(0, 3).map(event => ({
            id: event.id,
            event_type: event.event_type,
            title: event.title,
            detail: event.detail,
            time: event.created_at,
          }));

          setToasts(prev => [...newToasts, ...prev].slice(0, 5));

          // Auto-dismiss after 8 seconds
          newToasts.forEach(toast => {
            setTimeout(() => dismissToast(toast.id), 8000);
          });
        }
      } catch (err) {
        // Silently fail — don't break the app if activity endpoint isn't ready
      }
    }

    // Initial check
    checkForNew();

    // Poll every 30 seconds
    const interval = setInterval(checkForNew, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [user, dismissToast]);

  // Don't render anything for non-admin users
  if (!user || user.role !== 'admin') return null;
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column-reverse',
      gap: 10,
      maxWidth: 380,
      pointerEvents: 'none',
    }}>
      {toasts.map((toast, i) => {
        const config = EVENT_CONFIG[toast.event_type] || DEFAULT_EVENT;
        return (
          <div
            key={toast.id}
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '14px 16px',
              background: '#0F1629',
              border: '1px solid rgba(255,255,255,0.1)',
              borderLeft: '3px solid ' + config.color,
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)',
              animation: 'toast-slide-in 0.3s ease-out',
              cursor: 'pointer',
            }}
            onClick={() => dismissToast(toast.id)}
          >
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: config.color + '18',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: 16,
            }}>
              {config.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: config.color,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>{config.label}</span>
              </div>
              <div style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#F1F5F9',
                lineHeight: 1.3,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{toast.title}</div>
              {toast.detail && (
                <div style={{
                  fontSize: 11,
                  color: '#94A3B8',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{toast.detail}</div>
              )}
            </div>
            <div style={{
              fontSize: 16,
              color: '#475569',
              cursor: 'pointer',
              padding: '0 2px',
              lineHeight: 1,
              flexShrink: 0,
            }}>×</div>
          </div>
        );
      })}

      {/* Animation keyframes */}
      <style>{`
        @keyframes toast-slide-in {
          from { opacity: 0; transform: translateX(80px) scale(0.95); }
          to { opacity: 1; transform: translateX(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
