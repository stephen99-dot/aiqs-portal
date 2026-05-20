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
import UserManagementPage from './pages/UserManagementPage';
import MyRatesPage from './pages/MyRatesPage';
import AIMemoryPage from './pages/AIMemoryPage';
import OnboardingPage from './pages/OnboardingPage';
import MagicLinkPage from './pages/MagicLinkPage';
import VariationsPage from './pages/VariationsPage';
import SubmitDrawingsPage from './pages/SubmitDrawingsPage';
import SubmissionsInboxPage from './pages/SubmissionsInboxPage';
import BuilderPackPage from './pages/BuilderPackPage';
import VariationsHubPage from './pages/VariationsHubPage';
import FindingsEditorPage from './pages/FindingsEditorPage';
import EstimatorPage from './pages/EstimatorPage';
import EstimatorBuilderPage from './pages/EstimatorBuilderPage';
import FinanceDashboardPage from './pages/FinanceDashboardPage';
import OverheadsPage from './pages/OverheadsPage';
import JobsPage from './pages/JobsPage';
import JobDetailPage from './pages/JobDetailPage';
import VariationEditorPage from './pages/VariationEditorPage';
import VariationApprovalPage from './pages/VariationApprovalPage';
import InvoicesPage from './pages/InvoicesPage';
import InvoiceEditorPage from './pages/InvoiceEditorPage';
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
        {/* Public variation approval — outside ProtectedRoute on purpose. */}
        <Route path="/v/:token" element={<VariationApprovalPage />} />
        {/* Protected routes */}
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/new-project" element={<NewProjectPage />} />
          <Route path="/submit-drawings" element={<SubmitDrawingsPage />} />
          <Route path="/project/:id" element={<ProjectDetailPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/my-rates" element={<MyRatesPage />} />
          <Route path="/ai-memory" element={<AIMemoryPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/users" element={<UserManagementPage theme={t} />} />
          <Route path="/admin/submissions" element={<SubmissionsInboxPage />} />
          <Route path="/variations" element={<VariationsHubPage />} />
          <Route path="/project/:id/variations" element={<VariationsPage />} />
          <Route path="/project/:id/builder-pack" element={<BuilderPackPage />} />
          <Route path="/project/:id/findings" element={<FindingsEditorPage />} />
          <Route path="/estimator" element={<EstimatorPage />} />
          <Route path="/estimator/new" element={<EstimatorBuilderPage />} />
          <Route path="/estimator/quote/:id" element={<EstimatorBuilderPage />} />
          <Route path="/finance" element={<FinanceDashboardPage />} />
          <Route path="/finance/overheads" element={<OverheadsPage />} />
          <Route path="/finance/jobs" element={<JobsPage />} />
          <Route path="/finance/jobs/:id" element={<JobDetailPage />} />
          <Route path="/change-orders/new" element={<VariationEditorPage />} />
          <Route path="/change-orders/:id" element={<VariationEditorPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/:id" element={<InvoiceEditorPage />} />
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
