import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import NewProjectPage from './pages/NewProjectPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import ChatPage from './pages/ChatPage';
import PipelinePage from './pages/PipelinePage';
import ClientsPage from './pages/ClientsPage';
import AdminPage from './pages/AdminPage';
import PaymentSuccessPage from './pages/PaymentSuccessPage';
import MagicLinkPage from './pages/MagicLinkPage';
import PricingPage from './pages/PricingPage';
import UserManagementPage from './pages/UserManagementPage';
import MyRatesPage from './pages/MyRatesPage';
import AIMemoryPage from './pages/AIMemoryPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import WhatsAppWidget from './components/WhatsAppWidget';
import AdminNotifications from './components/AdminNotifications';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="loading-mark">QS</div><div className="loading-text">Loading...</div></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function GuestRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="loading-mark">QS</div></div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

function AppInner() {
  const { user } = useAuth();
  const { t, mode } = useTheme();
  return (
    <BrowserRouter>
      <Routes>
        {/* Guest routes */}
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />

        {/* Magic link — no auth guard, handles its own login */}
        <Route path="/magic" element={<MagicLinkPage />} />

        {/* Force password change — needs to be outside Layout so it's full screen */}
        <Route path="/change-password" element={<ChangePasswordPage />} />

        {/* Protected routes */}
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/new-project" element={<NewProjectPage />} />
          <Route path="/project/:id" element={<ProjectDetailPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/users" element={<UserManagementPage theme={t} />} />
          <Route path="/my-rates" element={<MyRatesPage />} />
          <Route path="/ai-memory" element={<AIMemoryPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/payment-success" element={<PaymentSuccessPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      {user && <WhatsAppWidget theme={t} userName={user?.fullName} />}
      <AdminNotifications />
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </AuthProvider>
  );
}
