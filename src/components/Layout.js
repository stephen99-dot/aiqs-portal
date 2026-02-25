import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, mode, toggle } = useTheme();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const isAdmin = user?.role === 'admin';

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
    <div style={{
      display: 'flex', height: '100vh', background: t.bg,
      fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      color: t.text, overflow: 'hidden',
      transition: 'background 0.3s ease, color 0.3s ease'
    }}>
      {/* Sidebar */}
      <aside style={{
        width: collapsed ? 64 : 220,
        background: t.surface,
        borderRight: `1px solid ${t.border}`,
        display: 'flex', flexDirection: 'column',
        transition: 'width 0.25s cubic-bezier(0.22,1,0.36,1), background 0.3s ease, border-color 0.3s ease',
        flexShrink: 0, overflow: 'hidden'
      }}>
        {/* Logo / Collapse */}
        <div style={{
          padding: collapsed ? '16px 12px' : '16px 18px',
          borderBottom: `1px solid ${t.border}`,
          display: 'flex', alignItems: 'center', gap: 10, minHeight: 60,
          transition: 'border-color 0.3s ease'
        }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              width: 34, height: 34, borderRadius: 8,
              background: t.accentGlow, border: `1px solid ${t.accent}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, fontSize: 16,
              transition: 'background 0.2s ease'
            }}
          >
            ⚡
          </button>
          {!collapsed && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text, letterSpacing: '-0.02em' }}>AI QS</div>
              <div style={{ fontSize: 10, color: t.accentLight, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {isAdmin ? 'Admin Portal' : 'Client Portal'}
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: collapsed ? '12px 8px' : '12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visibleNavItems.map(item => (
            <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center',
              gap: collapsed ? 0 : 10,
              padding: collapsed ? '10px' : '10px 14px',
              borderRadius: 10,
              background: isActive ? t.accentGlow : 'transparent',
              color: isActive ? t.accentLight : t.textSecondary,
              textDecoration: 'none',
              fontSize: 13, fontWeight: isActive ? 600 : 500,
              justifyContent: collapsed ? 'center' : 'flex-start',
              transition: 'all 0.2s ease'
            })}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom section: theme toggle, user info, logout */}
        <div style={{
          padding: collapsed ? '12px 8px' : '12px',
          borderTop: `1px solid ${t.border}`,
          display: 'flex', flexDirection: 'column', gap: 8,
          transition: 'border-color 0.3s ease'
        }}>
          {/* Theme toggle */}
          <button onClick={toggle} style={{
            display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 10,
            padding: collapsed ? '10px' : '10px 14px',
            borderRadius: 10, background: t.surfaceHover,
            border: `1px solid ${t.border}`, cursor: 'pointer',
            color: t.textSecondary, fontSize: 12, fontWeight: 500,
            justifyContent: collapsed ? 'center' : 'flex-start',
            width: '100%',
            transition: 'all 0.2s ease'
          }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>{mode === 'dark' ? '☀️' : '🌙'}</span>
            {!collapsed && <span>{mode === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
          </button>

          {/* User info */}
          <div style={{
            display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 10,
            padding: collapsed ? '8px' : '8px 14px',
            justifyContent: collapsed ? 'center' : 'flex-start'
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: isAdmin ? (t.goldBg || t.accentGlow) : t.accentGlow,
              border: `1px solid ${isAdmin ? (t.gold || t.accent) : t.accent}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
              color: isAdmin ? (t.gold || t.accent) : t.accent,
              flexShrink: 0,
              transition: 'all 0.3s ease'
            }}>
              {user?.fullName?.charAt(0) || user?.email?.charAt(0) || 'U'}
            </div>
            {!collapsed && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{user?.fullName || user?.email || 'User'}</div>
                <div style={{ fontSize: 10, color: isAdmin ? (t.gold || t.accent) : t.textMuted, fontWeight: isAdmin ? 600 : 400 }}>
                  {isAdmin ? '🛡️ Admin' : 'Client'}
                </div>
              </div>
            )}
          </div>

          {/* Logout */}
          <button onClick={handleLogout} style={{
            display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 10,
            padding: collapsed ? '10px' : '10px 14px',
            borderRadius: 10, background: 'transparent',
            border: 'none', cursor: 'pointer',
            color: t.textMuted, fontSize: 12, fontWeight: 500,
            justifyContent: collapsed ? 'center' : 'flex-start',
            width: '100%',
            transition: 'color 0.2s ease'
          }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>🚪</span>
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{
        flex: 1, overflow: 'auto', background: t.bg,
        transition: 'background 0.3s ease'
      }}>
        <Outlet />
      </main>
    </div>
  );
}
