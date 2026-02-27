import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  DashboardIcon, NewProjectIcon, PipelineIcon, ClientsIcon,
  ChatIcon, AdminIcon, SunIcon, MoonIcon, LogOutIcon, MenuIcon, XIcon, ZapIcon,
} from './Icons';

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, mode, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin = user?.role === 'admin';

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', Icon: DashboardIcon },
    { path: '/new-project', label: 'New Project', Icon: NewProjectIcon },
    { path: '/pipeline', label: 'Pipeline', Icon: PipelineIcon, adminOnly: true },
    { path: '/clients', label: 'Clients', Icon: ClientsIcon, adminOnly: true },
    { path: '/chat', label: 'Chat', Icon: ChatIcon },
    { path: '/admin', label: 'Admin', Icon: AdminIcon, adminOnly: true },
    { path: '/admin/users', label: 'User Management', Icon: ClientsIcon, adminOnly: true },
    { path: '/pricing', label: 'Pricing', Icon: ZapIcon },
  ];

  const visibleNavItems = navItems.filter(item => !item.adminOnly || isAdmin);

  const sidebarBg = mode === 'dark'
    ? 'linear-gradient(180deg, #090D16 0%, #070A12 100%)'
    : 'linear-gradient(180deg, #FAFBFD 0%, #F5F7FA 100%)';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: t.bg }}>

      {/* MOBILE HEADER */}
      <header className="mobile-header-bar" style={{
        display: 'none',
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        height: 56, alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', background: t.surface,
        borderBottom: `1px solid ${t.border}`, backdropFilter: 'blur(16px)',
      }}>
        <button onClick={() => setMobileOpen(!mobileOpen)} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: t.text, padding: 4, display: 'flex',
        }}>
          {mobileOpen ? <XIcon size={22} /> : <MenuIcon size={22} />}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ZapIcon size={13} color="#0A0F1C" />
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>AI QS</span>
        </div>
        <div style={{ width: 30 }} />
      </header>

      {mobileOpen && (
        <div className="mobile-overlay" onClick={() => setMobileOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 199,
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        }} />
      )}

      {/* SIDEBAR */}
      <aside className={`sidebar-panel ${mobileOpen ? 'open' : ''}`} data-tour="sidebar-nav" style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: 240,
        background: sidebarBg,
        borderRight: `1px solid ${t.border}`,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        zIndex: 200, overflowY: 'auto',
        transition: 'transform 0.3s cubic-bezier(0.22,1,0.36,1)',
      }}>
        <div style={{ padding: '20px 12px 16px' }}>
          {/* Logo */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            marginBottom: 28, padding: '2px 6px',
          }}>
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

          {/* Nav items */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {visibleNavItems.map(item => (
              <NavLink key={item.path} to={item.path} end={item.path === '/admin'} style={{ textDecoration: 'none' }}>
                {({ isActive }) => (
                  <div className="sidebar-nav-item" style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 7,
                    fontSize: 13, fontWeight: isActive ? 600 : 500,
                    letterSpacing: '-0.005em',
                    color: isActive ? t.text : t.textMuted,
                    background: isActive
                      ? (mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
                      : 'transparent',
                    transition: 'all 0.12s ease',
                    position: 'relative',
                  }}>
                    {isActive && (
                      <div style={{
                        position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                        width: 2.5, height: 14, borderRadius: '0 2px 2px 0',
                        background: '#F59E0B',
                      }} />
                    )}
                    <item.Icon
                      size={16}
                      color={isActive ? '#F59E0B' : t.textMuted}
                      style={{ opacity: isActive ? 1 : 0.65 }}
                    />
                    <span>{item.label}</span>
                  </div>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Bottom section */}
        <div style={{ padding: '10px 12px 14px', borderTop: `1px solid ${t.border}` }}>
          <button onClick={toggle} className="sidebar-btn" style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '7px 10px', borderRadius: 7,
            background: mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
            border: `1px solid ${t.border}`, cursor: 'pointer',
            color: t.textMuted, fontSize: 12.5, fontWeight: 500,
            width: '100%', marginBottom: 8, transition: 'all 0.12s',
          }}>
            {mode === 'dark' ? <SunIcon size={14} /> : <MoonIcon size={14} />}
            <span>{mode === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '8px 6px', marginBottom: 2, borderRadius: 7,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 7,
              background: isAdmin
                ? 'linear-gradient(135deg, rgba(212,168,83,0.12), rgba(212,168,83,0.04))'
                : 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(37,99,235,0.04))',
              border: `1px solid ${isAdmin ? 'rgba(212,168,83,0.12)' : 'rgba(37,99,235,0.12)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
              color: isAdmin ? (t.gold || '#D4A853') : t.accent,
              flexShrink: 0,
            }}>
              {user?.fullName?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12.5, fontWeight: 600, color: t.text,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                lineHeight: 1.25,
              }}>
                {user?.fullName || user?.email || 'User'}
              </div>
              <div style={{ fontSize: 10, fontWeight: 500, color: t.textMuted }}>
                {isAdmin ? 'Admin' : 'Client'}
              </div>
            </div>
          </div>

          <button onClick={handleLogout} className="sidebar-logout-btn" style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '7px 10px', borderRadius: 7,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: t.textMuted, fontSize: 12.5, fontWeight: 500,
            width: '100%', transition: 'all 0.12s',
          }}>
            <LogOutIcon size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-panel" style={{
        flex: 1, marginLeft: 240,
        minHeight: '100vh', overflow: 'auto', background: t.bg,
      }}>
        <Outlet />
      </main>
    </div>
  );
}
