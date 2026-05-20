import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  NewProjectIcon, ClientsIcon, ChatIcon,
  SunIcon, MoonIcon, LogOutIcon, MenuIcon, XIcon, ZapIcon, RatesIcon, SparklesIcon,
  UploadIcon,
} from './Icons';
import NotificationBell from './NotificationBell';

// ─── Inline icon for Notetaker (mic) ─────────────────────────────────────────
function MicIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  );
}

// Office in a Box — expandable parent containing the add-on workflow pages.
// Clicking the header toggles expand/collapse; clicking a child navigates.
function OfficeGroup({ item, t, mode, expanded, onToggle, isAnyActive, setMobileOpen, location }) {
  return (
    <div>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '9px 12px', borderRadius: 8,
          fontSize: 13, fontWeight: isAnyActive ? 600 : 500,
          letterSpacing: '-0.01em',
          color: isAnyActive ? t.text : t.textMuted,
          background: isAnyActive
            ? (mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
            : 'transparent',
          transition: 'all 0.15s ease',
          position: 'relative',
          cursor: 'pointer',
          border: 'none',
          textAlign: 'left',
        }}
        onMouseEnter={e => { if (!isAnyActive) e.currentTarget.style.background = mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'; }}
        onMouseLeave={e => { if (!isAnyActive) e.currentTarget.style.background = 'transparent'; }}
      >
        {isAnyActive && (
          <div style={{
            position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
            width: 3, height: 16, borderRadius: '0 3px 3px 0',
            background: '#F59E0B',
          }} />
        )}
        <item.Icon size={16} color={isAnyActive ? '#F59E0B' : t.textMuted} />
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.badge && (
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
            textTransform: 'uppercase',
            background: 'rgba(245,158,11,0.15)',
            color: '#F59E0B',
            border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 5,
            padding: '1px 5px',
            lineHeight: 1.5,
            marginRight: 4,
          }}>
            {item.badge}
          </span>
        )}
        <span style={{
          color: t.textMuted,
          fontSize: 10,
          transition: 'transform 0.18s ease',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>▶</span>
      </button>
      {expanded && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 1,
          marginLeft: 14, marginTop: 2, marginBottom: 4,
          paddingLeft: 12, borderLeft: '1px solid ' + t.border,
        }}>
          {item.children.map(c => {
            const isChildActive = location.pathname === c.path || location.pathname.startsWith(c.path + '/');
            return (
              <NavLink
                key={c.path}
                to={c.path}
                style={{ textDecoration: 'none' }}
                onClick={() => setMobileOpen(false)}
              >
                <div style={{
                  padding: '7px 10px',
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontWeight: isChildActive ? 600 : 500,
                  color: isChildActive ? t.text : t.textMuted,
                  background: isChildActive
                    ? (mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)')
                    : 'transparent',
                  transition: 'all 0.15s ease',
                  cursor: 'pointer',
                  position: 'relative',
                }}
                  onMouseEnter={e => { if (!isChildActive) e.currentTarget.style.background = mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.018)'; }}
                  onMouseLeave={e => { if (!isChildActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  {isChildActive && (
                    <div style={{
                      position: 'absolute', left: -13, top: '50%', transform: 'translateY(-50%)',
                      width: 5, height: 5, borderRadius: '50%',
                      background: '#F59E0B',
                    }} />
                  )}
                  {c.label}
                </div>
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, mode, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [testingDismissed, setTestingDismissed] = useState(() => {
    try { return sessionStorage.getItem('aiqs_testing_banner_dismissed') === '1'; }
    catch (e) { return false; }
  });

  const isAdmin = user?.role === 'admin';

  function dismissTestingBanner() {
    setTestingDismissed(true);
    try { sessionStorage.setItem('aiqs_testing_banner_dismissed', '1'); } catch (e) {}
  }

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const hasEstimator = !!user?.hasEstimator || isAdmin;

  // The "Office in a Box" add-on is a parent group containing the whole
  // builder workflow — quotes, finance, invoices, documents, calculators.
  // Routes are unchanged; only the sidebar presentation is nested.
  const officeInABoxChildren = [
    { path: '/estimator', label: 'Quotes' },
    { path: '/finance', label: 'Finance' },
    { path: '/invoices', label: 'Invoices' },
    { path: '/documents', label: 'Documents' },
    { path: '/calculators', label: 'Calculators' },
  ];
  const isOfficeRouteActive = officeInABoxChildren.some(c => location.pathname.startsWith(c.path));

  const navItems = [
    { path: '/dashboard', label: 'Completed Projects', Icon: NewProjectIcon },
    { path: '/submit-drawings', label: 'Submit Drawings', Icon: UploadIcon },
    { group: 'office', label: 'Office in a Box', Icon: ZapIcon, estimatorOnly: true, badge: 'Add-on', children: officeInABoxChildren, defaultExpanded: isOfficeRouteActive },
    { path: '/variations', label: 'Variations', Icon: RatesIcon },
    { path: '/chat',      label: 'Chat',     Icon: ChatIcon },
    { path: '/my-rates',  label: 'My Rates', Icon: RatesIcon },
    { path: '/ai-memory', label: 'AI Memory', Icon: SparklesIcon },
    { path: '/admin/submissions', label: 'Submissions Inbox', Icon: ClientsIcon, adminOnly: true, badge: 'New' },
    { path: '/admin/users', label: 'Users', Icon: ClientsIcon, adminOnly: true },
  ];

  const visibleNavItems = navItems.filter(item => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.estimatorOnly && !hasEstimator) return false;
    return true;
  });

  // Expanded state for each group. Persists across renders within a session.
  const [officeExpanded, setOfficeExpanded] = useState(isOfficeRouteActive);
  // Auto-open when navigating to one of the children.
  useEffect(() => { if (isOfficeRouteActive) setOfficeExpanded(true); }, [isOfficeRouteActive]);

  const sidebarBg = mode === 'dark'
    ? 'linear-gradient(180deg, #0A0F1C 0%, #0D1424 100%)'
    : '#FFFFFF';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: t.bg }}>

      {/* ── Mobile header ── */}
      <header className="mobile-header-bar" style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 300,
        height: 56, background: t.surface,
        borderBottom: `1px solid ${t.border}`,
        alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px',
      }}>
        <button
          onClick={() => setMobileOpen(o => !o)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: 8, borderRadius: 8, color: t.text,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            WebkitTapHighlightColor: 'transparent',
          }}
          aria-label="Toggle menu"
        >
          {mobileOpen
            ? <XIcon size={22} color={t.text} />
            : <MenuIcon size={22} color={t.text} />}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ZapIcon size={13} color="#0A0F1C" />
          </div>
          <span style={{ fontWeight: 800, fontSize: 15, color: t.text, letterSpacing: '-0.02em' }}>AI QS</span>
        </div>
        {isAdmin ? <NotificationBell /> : <div style={{ width: 30 }} />}
      </header>

      {/* ── Mobile overlay ── */}
      {mobileOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 199,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
          }}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`sidebar-panel ${mobileOpen ? 'open' : ''}`}
        data-tour="sidebar-nav"
        style={{
          position: 'fixed', top: 0, left: 0, bottom: 0, width: 240,
          background: sidebarBg,
          borderRight: `1px solid ${t.border}`,
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          zIndex: 200, overflowY: 'auto',
          transition: 'transform 0.3s cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        {/* Top section */}
        <div style={{ padding: '20px 12px 16px' }}>

          {/* Logo */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 28, padding: '2px 6px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 2px 8px rgba(245,158,11,0.18)',
              }}>
                <ZapIcon size={15} color="#0A0F1C" />
              </div>
              <div>
                <div style={{
                  fontWeight: 800, fontSize: 14.5, color: t.text,
                  lineHeight: 1.15, letterSpacing: '-0.02em',
                }}>AI QS</div>
                <div style={{
                  fontSize: 9.5, fontWeight: 600, letterSpacing: '0.05em',
                  color: isAdmin ? (t.gold || '#D4A853') : t.textMuted,
                  textTransform: 'uppercase', marginTop: 1,
                }}>
                  {isAdmin ? 'Admin Portal' : 'Client Portal'}
                </div>
              </div>
            </div>
            {isAdmin && <NotificationBell />}
          </div>

          {/* Nav items */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {visibleNavItems.map(item => {
              if (item.group === 'office') {
                return (
                  <OfficeGroup
                    key="office"
                    item={item}
                    t={t}
                    mode={mode}
                    expanded={officeExpanded}
                    onToggle={() => setOfficeExpanded(v => !v)}
                    isAnyActive={isOfficeRouteActive}
                    setMobileOpen={setMobileOpen}
                    location={location}
                  />
                );
              }
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/dashboard'}
                  data-tour={item.path === '/my-rates' ? 'my-rates' : item.path === '/ai-memory' ? 'ai-memory' : undefined}
                  style={{ textDecoration: 'none' }}
                  onClick={(e) => {
                    if (window.__aiqs_chat_sending) {
                      e.preventDefault();
                      if (!window.confirm('The AI is still processing your request. If you leave now, the response will be lost.\n\nLeave anyway?')) return;
                      window.__aiqs_chat_sending = false;
                    }
                    setMobileOpen(false);
                  }}
                >
                  {({ isActive }) => (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 12px', borderRadius: 8,
                      fontSize: 13, fontWeight: isActive ? 600 : 500,
                      letterSpacing: '-0.01em',
                      color: isActive ? t.text : t.textMuted,
                      background: isActive
                        ? (mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
                        : 'transparent',
                      transition: 'all 0.15s ease',
                      position: 'relative',
                      cursor: 'pointer',
                    }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'; }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {isActive && (
                        <div style={{
                          position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                          width: 3, height: 16, borderRadius: '0 3px 3px 0',
                          background: '#F59E0B',
                        }} />
                      )}
                      <item.Icon size={16} color={isActive ? '#F59E0B' : t.textMuted} />
                      <span style={{ flex: 1 }}>{item.label}</span>
                      {/* "New" badge */}
                      {item.badge && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                          background: 'rgba(245,158,11,0.15)',
                          color: '#F59E0B',
                          border: '1px solid rgba(245,158,11,0.3)',
                          borderRadius: 5,
                          padding: '1px 5px',
                          lineHeight: 1.5,
                        }}>
                          {item.badge}
                        </span>
                      )}
                    </div>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Bottom section */}
        <div style={{ padding: '12px 12px 20px', borderTop: `1px solid ${t.border}` }}>

          {/* User info */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', marginBottom: 8,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: 'white',
            }}>
              {(user?.fullName || user?.email || 'U')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12.5, fontWeight: 600, color: t.text,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {user?.fullName || 'User'}
              </div>
              <div style={{
                fontSize: 10.5, color: t.textMuted,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {user?.email}
              </div>
            </div>
          </div>

          {/* Theme toggle */}
          <button onClick={toggle} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%', padding: '8px 12px', borderRadius: 8,
            background: 'transparent', border: 'none',
            fontSize: 12.5, fontWeight: 500, color: t.textMuted,
            cursor: 'pointer', transition: 'all 0.15s',
            marginBottom: 2,
          }}
            onMouseEnter={e => e.currentTarget.style.background = mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {mode === 'dark'
              ? <SunIcon size={15} color={t.textMuted} />
              : <MoonIcon size={15} color={t.textMuted} />}
            {mode === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>

          {/* Logout */}
          <button onClick={handleLogout} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            width: '100%', padding: '8px 12px', borderRadius: 8,
            background: 'transparent', border: 'none',
            fontSize: 12.5, fontWeight: 500, color: t.textMuted,
            cursor: 'pointer', transition: 'all 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.color = '#EF4444'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = t.textMuted; }}
          >
            <LogOutIcon size={15} color="currentColor" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main style={{
        flex: 1,
        marginLeft: 240,
        minHeight: '100vh',
        background: t.bg,
        transition: 'background 0.2s',
      }} className="main-content">
        {/* Global TESTING / BETA strip — visible on every page until dismissed for the session */}
        {!testingDismissed && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '8px 16px',
            background: 'repeating-linear-gradient(45deg, rgba(239,68,68,0.08) 0 12px, rgba(239,68,68,0.16) 12px 24px)',
            borderBottom: '1px solid rgba(239,68,68,0.35)',
            color: mode === 'dark' ? '#FCA5A5' : '#B91C1C',
            fontSize: 12.5, lineHeight: 1.4, fontWeight: 500,
          }}>
            <span style={{
              fontSize: 9.5, fontWeight: 800, letterSpacing: '0.08em',
              padding: '2px 7px', borderRadius: 4,
              background: 'rgba(239,68,68,0.2)',
              border: '1px solid rgba(239,68,68,0.5)',
              textTransform: 'uppercase', flexShrink: 0,
            }}>Testing · Beta</span>
            <span style={{ flex: 1 }}>
              You're using the AI QS portal in test mode. Outputs may be incomplete or unverified —
              don't issue them to clients or subcontractors without a QS sign-off.
            </span>
            <button
              type="button"
              onClick={dismissTestingBanner}
              aria-label="Dismiss testing banner"
              style={{
                background: 'transparent', border: '1px solid rgba(239,68,68,0.35)',
                color: 'inherit', cursor: 'pointer',
                fontSize: 11, fontWeight: 600,
                padding: '3px 9px', borderRadius: 6, flexShrink: 0,
              }}
            >Got it</button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
