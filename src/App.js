import { Navigate, Route, Routes, BrowserRouter } from 'react-router-dom';
import { useAuth, AuthProvider } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import Layout from './components/Layout';

// Pages
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
import PricingPage from './pages/PricingPage';
import UserManagementPage from './pages/UserManagementPage';
import MyRatesPage from './pages/MyRatesPage';
import AIMemoryPage from './pages/AIMemoryPage';
import OnboardingPage from './pages/OnboardingPage';
import MagicLinkPage from './pages/MagicLinkPage';
import NotetakerPage from './pages/NotetakerPage';
import WhatsAppWidget from './components/WhatsAppWidget';
import AdminNotifications from './components/AdminNotifications';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="loading-mark">QS</div></div>;
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
  const { t } = useTheme();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
        {/* Magic link — handles its own auth */}
        <Route path="/magic" element={<MagicLinkPage />} />
        {/* Protected routes */}
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/new-project" element={<NewProjectPage />} />
          <Route path="/project/:id" element={<ProjectDetailPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/my-rates" element={<MyRatesPage />} />
          <Route path="/ai-memory" element={<AIMemoryPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/notetaker" element={<NotetakerPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/users" element={<UserManagementPage theme={t} />} />
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
