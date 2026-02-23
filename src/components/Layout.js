import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="app-layout">
      {/* Mobile header */}
      <header className="mobile-header">
        <button className="menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="mobile-logo">
          <LogoSVG />
        </div>
      </header>

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="sidebar-logo">
            <LogoSVG />
          </div>
          <nav className="sidebar-nav">
            <NavLink to="/dashboard" className="nav-item" onClick={() => setSidebarOpen(false)}>
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1" />
              </svg>
              Dashboard
            </NavLink>
            <NavLink to="/new-project" className="nav-item" onClick={() => setSidebarOpen(false)}>
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 4v16m8-8H4" />
              </svg>
              New Project
            </NavLink>
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <div className="user-avatar">
              {user?.fullName?.charAt(0) || 'U'}
            </div>
            <div className="user-info">
              <div className="user-name">{user?.fullName}</div>
              <div className="user-company">{user?.company || user?.email}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Log Out
          </button>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* Main content */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

function LogoSVG() {
  return (
    <svg width="120" height="30" viewBox="0 0 240 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="s-amber" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#FBBF24"/><stop offset="100%" stopColor="#D97706"/></linearGradient>
        <linearGradient id="s-mark" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#F59E0B"/><stop offset="100%" stopColor="#B45309"/></linearGradient>
        <clipPath id="s-clip"><rect width="48" height="48" rx="12"/></clipPath>
      </defs>
      <g clipPath="url(#s-clip)">
        <rect width="48" height="48" rx="12" fill="url(#s-mark)"/>
        <line x1="0" y1="16" x2="48" y2="16" stroke="#0A0F1C" strokeOpacity="0.08" strokeWidth="0.75"/>
        <line x1="0" y1="32" x2="48" y2="32" stroke="#0A0F1C" strokeOpacity="0.08" strokeWidth="0.75"/>
        <line x1="16" y1="0" x2="16" y2="48" stroke="#0A0F1C" strokeOpacity="0.08" strokeWidth="0.75"/>
        <line x1="32" y1="0" x2="32" y2="48" stroke="#0A0F1C" strokeOpacity="0.08" strokeWidth="0.75"/>
        <line x1="6" y1="42" x2="42" y2="6" stroke="#0A0F1C" strokeOpacity="0.12" strokeWidth="1.5" strokeDasharray="3 2"/>
        <text x="24" y="33" textAnchor="middle" fontFamily="Georgia, serif" fontSize="22" fontWeight="700" fill="#0A0F1C" letterSpacing="-0.5">QS</text>
      </g>
      <text x="60" y="22" fontFamily="Georgia, serif" fontSize="26" fontWeight="700" fill="#F8FAFC" letterSpacing="-0.5">AI</text>
      <text x="92" y="22" fontFamily="Georgia, serif" fontSize="26" fontWeight="400" fill="url(#s-amber)" fontStyle="italic" letterSpacing="-0.3">QS</text>
      <text x="60" y="42" fontFamily="monospace" fontSize="8.5" fill="#64748B" letterSpacing="2.5">QUANTITY SURVEYING</text>
    </svg>
  );
}
