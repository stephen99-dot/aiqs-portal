import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const { t, mode, toggle } = useTheme();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/new-project', label: 'New Project', icon: '📤' },
    { path: '/pipeline', label: 'Pipeline', icon: '⚡' },
    { path: '/clients', label: 'Clients', icon: '👥' },
    { path: '/chat', label: 'Chat', icon: '💬' },
    { path: '/admin', label: 'Admin', icon: '🛡️' },
  ];

  return (
    <div style={{
      display: 'flex', height: '100vh', background: t.bg,
      fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      color: t.text, overflow: 'hidden'
    }}>
      <aside style={{
        width: collapsed ? 64 : 220,
        background: t.surface,
        borderRight: `1px solid ${t.border}`,
        display: 'flex', flexDirection: 'column',
        transition: 'width 0.25s cubic-bezier(0.22,1,0.36,1)',
        flexShrink: 0, overflow: 'hidden'
      }}>
        <div style={{
          padding: collapsed ? '16px 12px' : '16px 18px',
          borderBottom: `1px solid ${t.border}`,
          display: 'flex', alignItems: 'center', gap: 10, minHeight: 60
        }}>
          <button onClick={() => setCollapsed(!collapsed)} style={{
            width: 34, height: 34, borderRadius: 8,
            background: t.accentGlow, border: `1px solid ${t.accent}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0, fontSize: 16
          }}>⚡</button>
          {!collapsed && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text, letterSpacing: '-0.02em' }}>AI QS</div>
              <div style={{ fontSize: 10, color: t.accentLight, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Customer Portal</div>
            </div>
          )}
        </div>

        <nav style={{ flex: 1, padding: collapsed ? '12px 8px' : '12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.map(item => (
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
              transition: 'all 0.15s'
            })}>
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: collapsed ? '12px 8px' : '12px', borderTop: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={toggle} style={{
            display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 10,
            padding: collapsed ? '10px' : '10px 14px',
            borderRadius: 10, background: t.surfaceHover,
            border: `1px solid ${t.border}`, cursor: 'pointer',
            color: t.textSecondary, fontSize: 12, fontWeight: 500,
            justifyContent: collapsed ? 'center' : 'flex-start',
            width: '100%'
          }}>
            <span style={{ fontSize: 16 }}>{mode === 'dark' ? '☀️' : '🌙'}</span>
            {!collapsed && <span>{mode === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
          </button>

          <div style={{
            display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 10,
            padding: collapsed ? '8px' : '8px 14px',
            justifyContent: collapsed ? 'center' : 'flex-start'
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: t.goldBg || t.accentGlow,
              border: `1px solid ${t.gold || t.accent}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: t.gold || t.accent, flexShrink: 0
            }}>
              {user?.name?.charAt(0) || user?.email?.charAt(0) || 'S'}
            </div>
            {!collapsed && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{user?.name || user?.email || 'User'}</div>
                <div style={{ fontSize: 10, color: t.textMuted }}>Admin</div>
              </div>
            )}
          </div>

          <button onClick={handleLogout} style={{
            display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : 10,
            padding: collapsed ? '10px' : '10px 14px',
            borderRadius: 10, background: 'transparent',
            border: 'none', cursor: 'pointer',
            color: t.textMuted, fontSize: 12, fontWeight: 500,
            justifyContent: collapsed ? 'center' : 'flex-start',
            width: '100%'
          }}>
            <span style={{ fontSize: 14 }}>🚪</span>
            {!collapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: 'auto', background: t.bg }}>
        <Outlet />
      </main>
    </div>
  );
}
