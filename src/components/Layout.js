import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  NewProjectIcon, ClientsIcon, ChatIcon,
  SunIcon, MoonIcon, LogOutIcon, MenuIcon, XIcon,
  UploadIcon, SettingsIcon, CubeIcon,
  InboxIcon, FolderIcon, BrainIcon,
} from './Icons';
import { Badge } from '../ui';
import NotificationBell from './NotificationBell';
import SurveyPopup from './SurveyPopup';

// Nav groups ("Settings") — expandable parents containing workflow pages.
// Clicking the header toggles expand/collapse; clicking a child navigates.
// All hover/active/focus states live in ui.css.
function NavGroup({ item, expanded, onToggle, isAnyActive, setMobileOpen, location }) {
  return (
    <div>
      <button
        onClick={onToggle}
        data-tour={item.tour}
        className={`ui-nav-item${isAnyActive ? ' ui-nav-item--active' : ''}`}
      >
        {isAnyActive && <div className="ui-nav-item__bar" />}
        <item.Icon size={16} color={isAnyActive ? 'var(--accent-bright)' : 'currentColor'} />
        <span className="ui-nav-item__label">{item.label}</span>
        {item.badge && <Badge tone="accent" size="sm" outlined>{item.badge}</Badge>}
        <span className={`ui-nav-caret${expanded ? ' ui-nav-caret--open' : ''}`}>▶</span>
      </button>
      {expanded && (
        <div className="ui-nav-sub">
          {item.children.map(c => {
            const isChildActive = location.pathname === c.path || location.pathname.startsWith(c.path + '/');
            return (
              <NavLink
                key={c.path}
                to={c.path}
                data-tour={'nav-' + c.path.replace('/', '')}
                className={`ui-nav-subitem${isChildActive ? ' ui-nav-subitem--active' : ''}`}
                onClick={() => setMobileOpen(false)}
              >
                {isChildActive && <span className="ui-nav-subitem__dot" />}
                <span>{c.label}</span>
                {c.badge && <Badge tone="accent" size="sm" outlined>{c.badge}</Badge>}
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
  // null = new-product prompt still deciding whether to show; true = it's
  // showing this session (so the feedback survey stays out of the way);
  // false = nothing to show, the feedback survey may run.

  const isAdmin = user?.role === 'admin';

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleLogout = () => {
    if (!window.confirm('Sign out of AI QS?')) return;
    logout(); navigate('/login');
  };

  // Personalisation pages live behind one Settings group so the main nav
  // stays short: the submit → track → deliver loop and nothing else.
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
    // No standalone Variations entry: OiB users raise them from the job page,
    // everyone else from the project page (/project/:id/variations).
    { path: '/chat', label: 'AI Chat', Icon: ChatIcon, badge: 'Beta' },
    { group: 'settings', label: 'Settings', Icon: SettingsIcon, children: settingsChildren, tour: 'settings' },
    { path: '/builder3d', label: '3D Builder', Icon: CubeIcon, adminOnly: true, badge: 'Preview' },
    { path: '/admin/submissions', label: 'Submissions Inbox', Icon: ClientsIcon, adminOnly: true, badge: 'New' },
    { path: '/admin/users', label: 'Users', Icon: ClientsIcon, adminOnly: true },
    { path: '/super-brain', label: 'Super Brain', Icon: BrainIcon, adminOnly: true, badge: 'New' },
    { path: '/admin', label: 'Admin Dashboard', Icon: SettingsIcon, adminOnly: true },
  ];

  const visibleNavItems = navItems.filter(item => {
    if (item.adminOnly && !isAdmin) return false;
    if (item.clientOnly && isAdmin) return false;
    return true;
  });

  // Expanded state for the Settings group. Persists within a session and
  // auto-opens when navigating to one of its children.
  const [settingsExpanded, setSettingsExpanded] = useState(isSettingsRouteActive);
  useEffect(() => { if (isSettingsRouteActive) setSettingsExpanded(true); }, [isSettingsRouteActive]);

  // Sidebar keeps the AI QS dark navy gradient in dark mode; flat surface in light.
  const sidebarBg = mode === 'dark'
    ? 'linear-gradient(180deg, #0A0F1C 0%, #0D1424 100%)'
    : t.sidebar;

  // Bottom nav (phones): the 4-5 most-used destinations per persona. Only on
  // top-level list pages — detail pages and editors have their own pinned
  // action bars, and the chat composer needs the full height.
  const bottomNavItems = isAdmin
    ? [
        { path: '/admin/submissions', label: 'Inbox', Icon: InboxIcon },
        { path: '/dashboard', label: 'Jobs', Icon: FolderIcon },
        { path: '/admin/users', label: 'Users', Icon: ClientsIcon },
        { path: '/chat', label: 'Chat', Icon: ChatIcon },
      ]
    : [
        { path: '/dashboard', label: 'Jobs', Icon: FolderIcon },
        { path: '/submit-drawings', label: 'Submit', Icon: UploadIcon },
        { path: '/chat', label: 'Chat', Icon: ChatIcon },
      ];
  const bottomNavRoutes = [
    '/dashboard', '/submit-drawings', '/variations',
    '/my-rates', '/ai-memory', '/branding',
    '/admin', '/admin/users', '/admin/submissions',
  ];
  const showBottomNav = bottomNavRoutes.includes(location.pathname);

  return (
    <div className="app-shell" style={{ background: t.bg }}>

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
          className="ui-icon-btn"
          style={{ width: 40, height: 40, color: t.text }}
          aria-label="Toggle menu"
        >
          {mobileOpen
            ? <XIcon size={22} color="currentColor" />
            : <MenuIcon size={22} color="currentColor" />}
        </button>
        <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>
          <span style={{ color: t.text }}>AI</span>
          <span style={{ color: '#F59E0B' }}> QS</span>
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
          position: 'fixed', top: 0, left: 0, bottom: 0, width: 'var(--sidebar-width)',
          background: sidebarBg,
          borderRight: `1px solid ${t.sidebarBorder}`,
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          zIndex: 200, overflowY: 'auto',
          transition: 'transform 0.3s cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        {/* Top section */}
        <div style={{ padding: '20px 12px 16px' }}>

          {/* Logo — the AI QS wordmark (matches the homepage logo: "AI" in
              ink, "QS" in amber, letterspaced strapline beneath). */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 28, padding: '2px 6px',
          }}>
            <div>
              <div style={{
                fontWeight: 800, fontSize: 21, lineHeight: 1.1,
                letterSpacing: '0.01em', whiteSpace: 'nowrap',
              }}>
                <span style={{ color: t.text }}>AI</span>
                <span style={{ color: '#F59E0B' }}> QS</span>
              </div>
              <div style={{
                fontSize: 9, fontWeight: 600, letterSpacing: '0.18em',
                color: isAdmin ? t.gold : t.textMuted,
                textTransform: 'uppercase', marginTop: 3, whiteSpace: 'nowrap',
              }}>
                {isAdmin ? 'Admin Portal' : 'Client Portal'}
              </div>
            </div>
            {isAdmin && <NotificationBell />}
          </div>

          {/* Nav items */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {visibleNavItems.map(item => {
              if (item.group) {
                return (
                  <NavGroup
                    key={item.group}
                    item={item}
                    expanded={settingsExpanded}
                    onToggle={() => setSettingsExpanded(v => !v)}
                    isAnyActive={isSettingsRouteActive}
                    setMobileOpen={setMobileOpen}
                    location={location}
                  />
                );
              }
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/dashboard' || item.path === '/admin'}
                  data-tour={item.path === '/submit-drawings' ? 'submit-drawings' : item.path === '/chat' ? 'chat-nav' : undefined}
                  className={({ isActive }) => `ui-nav-item${isActive ? ' ui-nav-item--active' : ''}`}
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
                    <>
                      {isActive && <div className="ui-nav-item__bar" />}
                      <item.Icon size={16} color={isActive ? 'var(--accent-bright)' : 'currentColor'} />
                      <span className="ui-nav-item__label">{item.label}</span>
                      {item.badge && <Badge tone="accent" size="sm" outlined>{item.badge}</Badge>}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Bottom section */}
        <div style={{ padding: '12px 12px 20px', borderTop: `1px solid ${t.sidebarBorder}` }}>

          {/* User info */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', marginBottom: 8,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
              background: t.gradientAccent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: '#0A0F1C',
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

          {/* Light/dark toggle */}
          <button onClick={toggle} className="ui-nav-item" style={{ marginBottom: 2 }}>
            {mode === 'dark'
              ? <SunIcon size={15} color="currentColor" />
              : <MoonIcon size={15} color="currentColor" />}
            {mode === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>

          {/* Logout */}
          <button onClick={handleLogout} className="ui-nav-item ui-nav-item--logout">
            <LogOutIcon size={15} color="currentColor" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main style={{
        flex: 1,
        marginLeft: 'var(--sidebar-width)',
        background: t.bg,
        transition: 'background 0.2s',
      }} className={`main-content${showBottomNav ? ' has-bottom-nav' : ''}`}>
        <Outlet />
      </main>

      {/* ── Bottom nav (phones) ── */}
      {showBottomNav && (
        <nav className="bottom-nav" aria-label="Primary">
          {bottomNavItems.map(item => {
            const active = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
            return (
              <NavLink key={item.path} to={item.path} className={`bottom-nav-item${active ? ' active' : ''}`}>
                <item.Icon size={20} color="currentColor" />
                {item.label}
              </NavLink>
            );
          })}
          <button type="button" className="bottom-nav-item" onClick={() => setMobileOpen(true)}>
            <MenuIcon size={20} color="currentColor" />
            More
          </button>
        </nav>
      )}

      {/* Feedback survey — every non-admin user, once. */}
      {!isAdmin && <SurveyPopup />}
    </div>
  );
}
