import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, mode, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin = user?.role === 'admin';

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: '📊', adminOnly: false },
    { path: '/new-project', label: 'New Project', icon: '📤', adminOnly: false },
    { path: '/pipeline', label: 'Pipeline', icon: '⚡', adminOnly: true },
    { path: '/clients', label: 'Clients', icon: '👥', adminOnly: true },
    { path: '/chat', label: 'Chat', icon: '💬', adminOnly: false },
    { path: '/admin', label: 'Admin', icon: '🛡️', adminOnly: true },
  ];

  const visibleNavItems = navItems.filter(item => !item.adminOnly || isAdmin);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: t.bg }}>

      {/* ── MOBILE HEADER ── */}
      <header className="mobile-header-bar" style={{
        display: 'none', /* shown via CSS media query */
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        height: 56,
        alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px',
        background: t.surface,
        borderBottom: `1px solid ${t.border}`,
        backdropFilter: 'blur(16px)',
      }}>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: t.text, fontSize: 22, padding: 4, lineHeight: 1,
          }}
        >
          {mobileOpen ? '✕' : '☰'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'linear-gradient(135deg, #F59E0B, #D97706)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: '#0A0F1C',
          }}>⚡</div>
          <span style={{ fontWeight: 700, fontSize: 15, color: t.text }}>AI QS</span>
        </div>
        <div style={{ width: 30 }} /> {/* spacer for centering */}
      </header>

      {/* ── MOBILE OVERLAY ── */}
      {mobileOpen && (
        <div
          className="mobile-overlay"
          onClick={() => setMobileOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 199,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(4px)',
          }}
        />
      )}

      {/* ── SIDEBAR ── */}
      <aside className={`sidebar-panel ${mobileOpen ? 'open' : ''}`} style={{
        position: 'fixed', top: 0, left: 0, bottom: 0,
        width: 240,
        background: t.surface,
        borderRight: `1px solid ${t.border}`,
        display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between',
        zIndex: 200,
        overflowY: 'auto',
        transition: 'transform 0.3s cubic-bezier(0.22,1,0.36,1)',
      }}>
        {/* Top section */}
        <div style={{ padding: '24px 16px 16px' }}>
          {/* Logo */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            marginBottom: 28, padding: '0 4px',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, #F59E0B, #D97706)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700, color: '#0A0F1C',
              flexShrink: 0,
            }}>⚡</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: t.text, lineHeight: 1.2 }}>AI QS</div>
              <div style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
                color: isAdmin ? (t.gold || '#D4A853') : t.accent,
                textTransform: 'uppercase',
              }}>
                {isAdmin ? 'ADMIN PORTAL' : 'CLIENT PORTAL'}
              </div>
            </div>
          </div>

          {/* Nav Items */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {visibleNavItems.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 8,
                  textDecoration: 'none',
                  fontSize: 14, fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#F59E0B' : t.textSecondary,
                  background: isActive ? 'rgba(245,158,11,0.1)' : 'transparent',
                  transition: 'all 0.15s',
                })}
              >
                <span style={{ fontSize: 17, width: 22, textAlign: 'center' }}>{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Bottom section */}
        <div style={{
          padding: '16px',
          borderTop: `1px solid ${t.border}`,
        }}>
          {/* Theme toggle */}
          <button onClick={toggle} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', borderRadius: 8,
            background: t.surfaceHover || (mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'),
            border: `1px solid ${t.border}`,
            cursor: 'pointer',
            color: t.textSecondary, fontSize: 13, fontWeight: 500,
            width: '100%',
            marginBottom: 12,
          }}>
            <span style={{ fontSize: 16 }}>{mode === 'dark' ? '☀️' : '🌙'}</span>
            <span>{mode === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>

          {/* User info */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 4px',
            marginBottom: 8,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: isAdmin
                ? (t.goldBg || 'rgba(212,168,83,0.08)')
                : (t.accentGlow || 'rgba(37,99,235,0.12)'),
              border: `1px solid ${isAdmin ? (t.gold || '#D4A853') : t.accent}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
              color: isAdmin ? (t.gold || '#D4A853') : t.accent,
              flexShrink: 0,
            }}>
              {user?.fullName?.charAt(0) || user?.email?.charAt(0) || 'U'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 600, color: t.text,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {user?.fullName || user?.email || 'User'}
              </div>
              <div style={{
                fontSize: 10, fontWeight: 600,
                color: isAdmin ? (t.gold || '#D4A853') : t.textMuted,
              }}>
                {isAdmin ? '🛡️ Admin' : 'Client'}
              </div>
            </div>
          </div>

          {/* Logout */}
          <button onClick={handleLogout} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', borderRadius: 8,
            background: 'transparent', border: 'none',
            cursor: 'pointer',
            color: t.textMuted, fontSize: 13, fontWeight: 500,
            width: '100%',
            transition: 'all 0.15s',
          }}>
            <span style={{ fontSize: 14 }}>🚪</span>
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="main-panel" style={{
        flex: 1, marginLeft: 240,
        minHeight: '100vh',
        overflow: 'auto',
        background: t.bg,
      }}>
        <Outlet />
      </main>
    </div>
  );
}
