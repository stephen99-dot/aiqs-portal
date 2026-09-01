import { Navigate, Route, Routes, BrowserRouter } from 'react-router-dom';
import { useAuth, AuthProvider } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { ToastProvider } from './ui';
import Layout from './components/Layout';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import NewProjectPage from './pages/NewProjectPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import ChatPage from './pages/ChatPage';
import AdminPage from './pages/AdminPage';
import PaymentSuccessPage from './pages/PaymentSuccessPage';
import UserManagementPage from './pages/UserManagementPage';
import MyRatesPage from './pages/MyRatesPage';
import AIMemoryPage from './pages/AIMemoryPage';
import SuperBrainPage from './pages/SuperBrainPage';
import OnboardingPage from './pages/OnboardingPage';
import MagicLinkPage from './pages/MagicLinkPage';
import TeamInvitePage from './pages/TeamInvitePage';
import VariationsPage from './pages/VariationsPage';
import SubmitDrawingsPage from './pages/SubmitDrawingsPage';
import SubmissionsInboxPage from './pages/SubmissionsInboxPage';
import BuilderPackPage from './pages/BuilderPackPage';
import VariationsHubPage from './pages/VariationsHubPage';
import FindingsEditorPage from './pages/FindingsEditorPage';
import VariationApprovalPage from './pages/VariationApprovalPage';
import QuoteAcceptancePage from './pages/QuoteAcceptancePage';
import InvoicePublicPage from './pages/InvoicePublicPage';
import Builder3DPage from './pages/Builder3DPage';
import BrandingPage from './pages/BrandingPage';
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

// Everyone lands on the BOQ-pipeline dashboard. Used for the catch-all and
// post-login redirect.
function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="loading-mark">QS</div></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to="/dashboard" replace />;
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
        <Route path="/team-invite" element={<TeamInvitePage />} />
        {/* Public variation approval — outside ProtectedRoute on purpose. */}
        <Route path="/v/:token" element={<VariationApprovalPage />} />
        {/* Public quote/invoice views — kept so links already sent to
            builders' clients keep resolving (Office in a Box itself is
            retired; nothing in the portal creates new ones). */}
        <Route path="/q/:token" element={<QuoteAcceptancePage />} />
        <Route path="/i/:token" element={<InvoicePublicPage />} />
        {/* Protected routes */}
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/new-project" element={<NewProjectPage />} />
          <Route path="/submit-drawings" element={<SubmitDrawingsPage />} />
          <Route path="/project/:id" element={<ProjectDetailPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/my-rates" element={<MyRatesPage />} />
          <Route path="/ai-memory" element={<AIMemoryPage />} />
          <Route path="/super-brain" element={<SuperBrainPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/users" element={<UserManagementPage theme={t} />} />
          <Route path="/admin/submissions" element={<SubmissionsInboxPage />} />
          {/* Variations live on the project: raised from the project page,
              scanned across projects from the hub. */}
          <Route path="/variations" element={<VariationsHubPage />} />
          <Route path="/project/:id/variations" element={<VariationsPage />} />
          <Route path="/project/:id/builder-pack" element={<BuilderPackPage />} />
          <Route path="/project/:id/findings" element={<FindingsEditorPage />} />
          {/* 3D Builder — admin-only preview (page self-guards on role). */}
          <Route path="/builder3d" element={<Builder3DPage />} />
          {/* Office in a Box is retired. Old bookmarks land on the dashboard
              rather than anywhere that sells a second product — signing up
              here and then again somewhere else is what confused people. */}
          <Route path="/office" element={<Navigate to="/dashboard" replace />} />
          <Route path="/jobs" element={<Navigate to="/dashboard" replace />} />
          <Route path="/money" element={<Navigate to="/dashboard" replace />} />
          <Route path="/clients" element={<Navigate to="/dashboard" replace />} />
          <Route path="/documents" element={<Navigate to="/dashboard" replace />} />
          <Route path="/tools" element={<Navigate to="/dashboard" replace />} />
          <Route path="/estimator" element={<Navigate to="/dashboard" replace />} />
          <Route path="/calculators" element={<Navigate to="/dashboard" replace />} />
          <Route path="/materials" element={<Navigate to="/dashboard" replace />} />
          <Route path="/pm" element={<Navigate to="/dashboard" replace />} />
          <Route path="/finance" element={<Navigate to="/dashboard" replace />} />
          <Route path="/invoices" element={<Navigate to="/dashboard" replace />} />
          <Route path="/office-in-a-box" element={<Navigate to="/dashboard" replace />} />
          <Route path="/office-demo" element={<Navigate to="/dashboard" replace />} />
          <Route path="/ai-trades-pilot" element={<Navigate to="/dashboard" replace />} />
          <Route path="/branding" element={<BrandingPage />} />
          <Route path="/payment-success" element={<PaymentSuccessPage />} />
        </Route>
        <Route path="*" element={<HomeRedirect />} />
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
        <ToastProvider>
          <AppInner />
        </ToastProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
