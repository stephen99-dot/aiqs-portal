import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  NewProjectIcon, ClientsIcon, ChatIcon,
  SunIcon, MoonIcon, LogOutIcon, MenuIcon, XIcon, ZapIcon, RatesIcon,
  UploadIcon, SettingsIcon,
} from './Icons';
import NotificationBell from './NotificationBell';
import OfficeInABoxPopup from './OfficeInABoxPopup';
import WhatsNewPopup from './WhatsNewPopup';

// Representative swatch colour for each selectable theme.
const THEME_SWATCH = {
  aiqs: '#F59E0B',
  chatgpt: '#10A37F',
  claude: '#C96442',
  copilot: 'linear-gradient(135deg,#2AA5F4,#2AD4A8,#8B5CF6)',
};

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
        data-tour={item.tour}
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
  const { t, mode, theme, themes, toggle, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  // The "What's new" popup takes priority — the Office upsell waits until it's
  // been dismissed so the two never stack on top of each other.
  const [whatsNewSeen, setWhatsNewSeen] = useState(false);

  const isAdmin = user?.role === 'admin';

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const hasEstimator = !!user?.hasEstimator || isAdmin;

  // The "Office in a Box" add-on navigates the way a builder thinks: Today
  // (what needs doing), Jobs (everything about one job), Money (in and out).
  // Calculators + materials prices live behind Tools — reference, not workflow.
  const officeInABoxChildren = [
    { path: '/office', label: 'Today' },
    { path: '/jobs', label: 'Jobs' },
    { path: '/money', label: 'Money' },
    { path: '/tools', label: 'Tools' },
  ];
  // Pages reached from inside the group (quote editor, invoice editor, job
  // page, documents, tools) keep the group highlighted and open.
  const officeRoutePrefixes = [
    '/office', '/jobs', '/money', '/tools',
    '/estimator', '/invoices', '/finance', '/change-orders',
    '/documents', '/calculators', '/materials', '/pm',
  ];
  const isOfficeRouteActive = officeRoutePrefixes.some(p => location.pathname === p || location.pathname.startsWith(p + '/'));

  // Subscribers (and admins) get the working tool group. Everyone else sees a
  // single "Office in a Box" entry that opens the Coming Soon / upsell page.
  const officeNavItem = hasEstimator
    ? { group: 'office', label: 'Office in a Box', Icon: ZapIcon, badge: 'Add-on', children: officeInABoxChildren, defaultExpanded: isOfficeRouteActive }
    : { path: '/office-in-a-box', label: 'Office in a Box', Icon: ZapIcon, badge: 'Soon' };

  // Personalisation pages live behind one Settings group so the main nav
  // stays at five entries: the submit → track → deliver loop plus the add-on.
  const settingsChildren = [
    { path: '/my-rates', label: 'My Rates' },
    { path: '/ai-memory', label: 'AI Memory' },
    { path: '/branding', label: 'Branding & Logo' },
  ];
  const settingsRoutePrefixes = ['/my-rates', '/ai-memory', '/branding', '/onboarding'];
  const isSettingsRouteActive = settingsRoutePrefixes.some(p => location.pathname === p || location.pathname.startsWith(p + '/'));

  const navItems = [
    // Submit Drawings leads: the QS-team route is the primary path while the
    // chatbot is in its testing phase.
    { path: '/submit-drawings', label: 'Submit Drawings', Icon: UploadIcon },
    { path: '/dashboard', label: 'My Projects', Icon: NewProjectIcon },
    // OiB users reach variations through the job page — no standalone entry.
    ...(hasEstimator ? [] : [{ path: '/variations', label: 'Variations', Icon: RatesIcon }]),
    { path: '/chat', label: 'AI Chat', Icon: ChatIcon, badge: 'Beta' },
    officeNavItem,
    { group: 'settings', label: 'Settings', Icon: SettingsIcon, children: settingsChildren, tour: 'settings' },
    { path: '/admin/submissions', label: 'Submissions Inbox', Icon: ClientsIcon, adminOnly: true, badge: 'New' },
    { path: '/admin/users', label: 'Users', Icon: ClientsIcon, adminOnly: true },
    { path: '/admin', label: 'Admin Dashboard', Icon: SettingsIcon, adminOnly: true },
  ];

  const visibleNavItems = navItems.filter(item => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.estimatorOnly && !hasEstimator) return false;
    return true;
  });

  // Expanded state for each group. Persists across renders within a session.
  const [officeExpanded, setOfficeExpanded] = useState(isOfficeRouteActive);
  const [settingsExpanded, setSettingsExpanded] = useState(isSettingsRouteActive);
  // Auto-open when navigating to one of the children.
  useEffect(() => { if (isOfficeRouteActive) setOfficeExpanded(true); }, [isOfficeRouteActive]);
  useEffect(() => { if (isSettingsRouteActive) setSettingsExpanded(true); }, [isSettingsRouteActive]);

  // Sidebar uses the theme's sidebar token (keeps the AI QS dark navy by
  // default, but re-skins for ChatGPT / Claude / Copilot themes).
  const sidebarBg = (theme === 'aiqs' && mode === 'dark')
    ? 'linear-gradient(180deg, #0A0F1C 0%, #0D1424 100%)'
    : t.sidebar;

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
              if (item.group) {
                const isOffice = item.group === 'office';
                return (
                  <OfficeGroup
                    key={item.group}
                    item={item}
                    t={t}
                    mode={mode}
                    expanded={isOffice ? officeExpanded : settingsExpanded}
                    onToggle={() => (isOffice ? setOfficeExpanded(v => !v) : setSettingsExpanded(v => !v))}
                    isAnyActive={isOffice ? isOfficeRouteActive : isSettingsRouteActive}
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
                  data-tour={item.path === '/submit-drawings' ? 'submit-drawings' : item.path === '/chat' ? 'chat-nav' : undefined}
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
                          background: t.accent,
                        }} />
                      )}
                      <item.Icon size={16} color={isActive ? t.accent : t.textMuted} />
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

          {/* Theme picker — pick the overall look. Each theme is shown with its
              name (a labelled chip) so it's clear without hovering. */}
          <div style={{ padding: '4px 12px 8px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: t.textMuted, marginBottom: 7, letterSpacing: '0.02em' }}>Theme</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {themes.map(th => {
                const active = theme === th.key;
                return (
                  <button
                    key={th.key}
                    onClick={() => setTheme(th.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '6px 9px', borderRadius: 8, cursor: 'pointer', width: '100%',
                      background: active ? t.surfaceHover : 'transparent',
                      border: `1px solid ${active ? t.accent : t.border}`,
                      color: t.text, fontSize: 12, fontWeight: active ? 700 : 500,
                      fontFamily: 'inherit', textAlign: 'left',
                    }}
                  >
                    <span style={{
                      width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                      background: THEME_SWATCH[th.key] || t.accent,
                      border: `1px solid ${t.border}`,
                    }} />
                    {th.label}
                  </button>
                );
              })}
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
        <Outlet />
      </main>

      {/* What's new — announce chatbot updates to every user, once per release */}
      <WhatsNewPopup onClose={() => setWhatsNewSeen(true)} />

      {/* Office in a Box upsell — only for non-subscribers, and not on the page
          itself, and only once the What's New popup has been dismissed */}
      {whatsNewSeen && (isAdmin || !user?.hasEstimator) && location.pathname !== '/office-in-a-box' && <OfficeInABoxPopup />}
    </div>
  );
}
