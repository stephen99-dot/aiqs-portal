import { Navigate, Route, Routes, BrowserRouter, useParams } from 'react-router-dom';
import { useAuth, AuthProvider } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { ToastProvider } from './ui';
import Layout from './components/Layout';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import DeleteAccountInfoPage from './pages/DeleteAccountInfoPage';
import DashboardPage from './pages/DashboardPage';
import NewProjectPage from './pages/NewProjectPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import ChatPage from './pages/ChatPage';
import AdminPage from './pages/AdminPage';
import PaymentSuccessPage from './pages/PaymentSuccessPage';
import UpgradePage from './pages/UpgradePage';
import UserManagementPage from './pages/UserManagementPage';
import MyRatesPage from './pages/MyRatesPage';
import AIMemoryPage from './pages/AIMemoryPage';
import SuperBrainPage from './pages/SuperBrainPage';
import OnboardingPage from './pages/OnboardingPage';
import MagicLinkPage from './pages/MagicLinkPage';
import TeamInvitePage from './pages/TeamInvitePage';
import SubmitDrawingsPage from './pages/SubmitDrawingsPage';
import SubmissionsInboxPage from './pages/SubmissionsInboxPage';
import BuilderPackPage from './pages/BuilderPackPage';
import FindingsEditorPage from './pages/FindingsEditorPage';
import VariationApprovalPage from './pages/VariationApprovalPage';
import QuoteAcceptancePage from './pages/QuoteAcceptancePage';
import InvoicePublicPage from './pages/InvoicePublicPage';
import Builder3DPage from './pages/Builder3DPage';
import BrandingPage from './pages/BrandingPage';
import OAuthSuccessPage from './pages/OAuthSuccessPage';
import EstimatesPage from './pages/EstimatesPage';
import EstimatePage from './pages/EstimatePage';
import SurveysPage from './pages/SurveysPage';
import SurveyPage from './pages/SurveyPage';
import SurveyRoomPage from './pages/SurveyRoomPage';
import WhatsAppWidget from './components/WhatsAppWidget';
import AdminNotifications from './components/AdminNotifications';
import OfflineBanner from './components/OfflineBanner';
import NativeBridge from './native/NativeBridge';

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
function ProjectVariationsRedirect() {
  const { id } = useParams();
  return <Navigate to={'/project/' + id} replace />;
}

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
      {/* Native shell glue (deep links, status bar, splash) — a no-op on the web. */}
      <NativeBridge />
      <OfflineBanner />
      <Routes>
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
        <Route path="/forgot-password" element={<GuestRoute><ForgotPasswordPage /></GuestRoute>} />
        {/* Public: how to delete an account. Required by Google Play and
            Apple as a web address that works without signing in. */}
        <Route path="/delete-account" element={<DeleteAccountInfoPage />} />
        {/* Magic link — handles its own auth */}
        <Route path="/magic" element={<MagicLinkPage />} />
        {/* Where the server lands the browser after Google sign-in (?token=) */}
        <Route path="/auth/google/success" element={<OAuthSuccessPage />} />
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
          {/* MAX small-job estimates — drafted by MAX, edited and sent here. */}
          <Route path="/estimates" element={<EstimatesPage />} />
          <Route path="/estimates/:id" element={<EstimatePage />} />
          <Route path="/surveys" element={<SurveysPage />} />
          <Route path="/surveys/:id" element={<SurveyPage />} />
          <Route path="/surveys/:id/rooms/:roomId" element={<SurveyRoomPage />} />
          <Route path="/my-rates" element={<MyRatesPage />} />
          <Route path="/ai-memory" element={<AIMemoryPage />} />
          <Route path="/super-brain" element={<SuperBrainPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/users" element={<UserManagementPage theme={t} />} />
          <Route path="/admin/submissions" element={<SubmissionsInboxPage />} />
          {/* Variations are retired. Old bookmarks land on the dashboard or the
              project; the customer's approval page (/v/:token) still works for
              links already sent. */}
          <Route path="/variations" element={<Navigate to="/dashboard" replace />} />
          <Route path="/project/:id/variations" element={<ProjectVariationsRedirect />} />
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
          {/* The MAX packages: buy, switch, cancel. /plans is the same page. */}
          <Route path="/upgrade" element={<UpgradePage />} />
          <Route path="/plans" element={<Navigate to="/upgrade" replace />} />
          <Route path="/payment-success" element={<PaymentSuccessPage />} />
        </Route>
        <Route path="*" element={<HomeRedirect />} />
      </Routes>
      {/* Customer support widget — not for admins, who are the people answering it. */}
      {user && user.role !== 'admin' && <WhatsAppWidget theme={t} userName={user?.fullName} />}
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
