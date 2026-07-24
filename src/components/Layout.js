import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  NewProjectIcon, ClientsIcon, ChatIcon,
  SunIcon, MoonIcon, LogOutIcon, MenuIcon, XIcon, ZapIcon,
  UploadIcon, SettingsIcon, CubeIcon,
  InboxIcon, FolderIcon, PoundIcon, HomeIcon,
} from './Icons';
import { canUsePlanningLeads } from '../utils/featureFlags';
import NotificationBell from './NotificationBell';
import OfficeTour from './OfficeTour';
import WhatsNewPopup from './WhatsNewPopup';
import SurveyPopup from './SurveyPopup';

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
                <div data-tour={'nav-' + (c.path === '/office' ? 'today' : c.path.replace('/', ''))} style={{
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
                  <span>{c.label}</span>
                  {c.badge && (
                    <span style={{
                      marginLeft: 8, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.05em',
                      textTransform: 'uppercase', background: 'rgba(245,158,11,0.15)', color: '#F59E0B',
                      border: '1px solid rgba(245,158,11,0.3)', borderRadius: 5, padding: '1px 4px',
                    }}>{c.badge}</span>
                  )}
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
  // The "What's new" popup takes priority — the survey waits until it's been
  // dismissed so the two never stack on top of each other.
  const [whatsNewSeen, setWhatsNewSeen] = useState(false);

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

  const hasEstimator = !!user?.hasEstimator || isAdmin;

  // The "Office in a Box" add-on navigates the way a builder thinks: Today
  // (what needs doing), Jobs (everything about one job), Money (in and out).
  // Calculators + materials prices live behind Tools — reference, not workflow.
  const officeInABoxChildren = [
    { path: '/office', label: 'Today' },
    { path: '/jobs', label: 'Jobs' },
    { path: '/clients', label: 'Clients' },
    { path: '/money', label: 'Money' },
    { path: '/documents', label: 'Documents' },
    { path: '/tools', label: 'Tools' },
    // Planning Leads is in preview — only the allowlisted account sees it.
    ...(canUsePlanningLeads(user) ? [{ path: '/planning-leads', label: 'Planning Leads', badge: 'Preview' }] : []),
  ];
  // Pages reached from inside the group (quote editor, invoice editor, job
  // page, documents, tools) keep the group highlighted and open.
  const officeRoutePrefixes = [
    '/office', '/jobs', '/clients', '/money', '/tools',
    '/estimator', '/invoices', '/finance', '/change-orders',
    '/documents', '/calculators', '/materials', '/pm', '/planning-leads',
  ];
  const isOfficeRouteActive = officeRoutePrefixes.some(p => location.pathname === p || location.pathname.startsWith(p + '/'));

  // Subscribers (and admins) get the working tool group. Everyone else sees a
  // single "AI Trades Pilot" entry that opens the new-product ad page.
  const officeNavItem = hasEstimator
    ? { group: 'office', label: 'Office in a Box', Icon: ZapIcon, badge: 'Add-on', children: officeInABoxChildren, defaultExpanded: isOfficeRouteActive }
    : { path: '/ai-trades-pilot', label: 'AI Trades Pilot', Icon: ZapIcon, badge: 'New' };

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
    // No standalone Variations entry: OiB users raise them from the job page,
    // everyone else from the project page (/project/:id/variations).
    { path: '/chat', label: 'AI Chat', Icon: ChatIcon, badge: 'Beta' },
    officeNavItem,
    { group: 'settings', label: 'Settings', Icon: SettingsIcon, children: settingsChildren, tour: 'settings' },
    { path: '/builder3d', label: '3D Builder', Icon: CubeIcon, adminOnly: true, badge: 'Preview' },
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
  // The Office tour fires this when it needs a sidebar menu item to be reachable
  // (expanded on desktop, and the drawer open on mobile).
  useEffect(() => {
    const open = () => { setOfficeExpanded(true); setMobileOpen(true); };
    window.addEventListener('aiqs:open-office-nav', open);
    return () => window.removeEventListener('aiqs:open-office-nav', open);
  }, []);

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
        { path: '/clients', label: 'Clients', Icon: ClientsIcon },
        { path: '/chat', label: 'Chat', Icon: ChatIcon },
      ]
    : hasEstimator
    ? [
        { path: '/office', label: 'Today', Icon: HomeIcon },
        { path: '/jobs', label: 'Jobs', Icon: FolderIcon },
        { path: '/money', label: 'Money', Icon: PoundIcon },
        { path: '/chat', label: 'Chat', Icon: ChatIcon },
      ]
    : [
        { path: '/dashboard', label: 'Jobs', Icon: FolderIcon },
        { path: '/submit-drawings', label: 'Submit', Icon: UploadIcon },
        { path: '/chat', label: 'Chat', Icon: ChatIcon },
      ];
  const bottomNavRoutes = [
    '/dashboard', '/submit-drawings', '/office', '/jobs', '/money', '/clients',
    '/documents', '/tools', '/calculators', '/materials', '/variations',
    '/estimator', '/pipeline', '/my-rates', '/ai-memory', '/branding',
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
          position: 'fixed', top: 0, left: 0, bottom: 0, width: 'var(--sidebar-width)',
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

          {/* Light/dark toggle */}
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

      {/* What's new — announce chatbot updates to every user, once per release */}
      <WhatsNewPopup onClose={() => setWhatsNewSeen(true)} />

      {/* Feedback survey — every non-admin user, once. Waits for What's New
          so the two popups never stack. */}
      {whatsNewSeen && !isAdmin && <SurveyPopup />}

      {/* Office in a Box guided walkthrough — auto-runs once for subscribers and
          stays available afterwards via its "Show me around" launcher. Admins
          can replay it but it never auto-pops for them. */}
      {hasEstimator && <OfficeTour userId={user?.id} autoStart={!!user?.hasEstimator} />}
    </div>
  );
}
