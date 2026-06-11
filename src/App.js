import { Navigate, Route, Routes, BrowserRouter, useParams } from 'react-router-dom';
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
import OverheadsPage from './pages/OverheadsPage';
import JobsPage from './pages/JobsPage';
import JobDetailPage from './pages/JobDetailPage';
import VariationEditorPage from './pages/VariationEditorPage';
import VariationApprovalPage from './pages/VariationApprovalPage';
import QuoteAcceptancePage from './pages/QuoteAcceptancePage';
import InvoicePublicPage from './pages/InvoicePublicPage';
import MoneyPage from './pages/MoneyPage';
import InvoiceEditorPage from './pages/InvoiceEditorPage';
import DocumentsPage from './pages/DocumentsPage';
import DocumentEditorPage from './pages/DocumentEditorPage';
import CalculatorsPage from './pages/CalculatorsPage';
import MaterialsPage from './pages/MaterialsPage';
import TodayPage from './pages/TodayPage';
import ToolsPage from './pages/ToolsPage';
import SetupWizardPage from './pages/SetupWizardPage';
import OfficeInABoxPage from './pages/OfficeInABoxPage';
import OfficeDemoPage from './pages/OfficeDemoPage';
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
  if (user) return <Navigate to={user.hasEstimator ? '/office' : '/dashboard'} replace />;
  return children;
}

// Office in a Box subscribers land on Today (/office); everyone else on the
// BOQ-pipeline dashboard. Used for the catch-all and post-login redirect.
function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="loading-mark">QS</div></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.hasEstimator ? '/office' : '/dashboard'} replace />;
}

// Old bookmark redirects that need to carry the :id through.
function JobIdRedirect() {
  const { id } = useParams();
  return <Navigate to={'/jobs/' + id} replace />;
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
        {/* Public quote acceptance — same pattern, the builder's client opens this. */}
        <Route path="/q/:token" element={<QuoteAcceptancePage />} />
        {/* Public invoice view — emailed/WhatsApped to the builder's client. */}
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
          {/* Office in a Box — three destinations: Today / Jobs / Money (+ Tools). */}
          <Route path="/office" element={<TodayPage />} />
          <Route path="/office/setup" element={<SetupWizardPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/money" element={<MoneyPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/estimator" element={<EstimatorPage />} />
          <Route path="/estimator/new" element={<EstimatorBuilderPage />} />
          <Route path="/estimator/quote/:id" element={<EstimatorBuilderPage />} />
          <Route path="/finance/overheads" element={<OverheadsPage />} />
          <Route path="/change-orders/new" element={<VariationEditorPage />} />
          <Route path="/change-orders/:id" element={<VariationEditorPage />} />
          <Route path="/invoices/:id" element={<InvoiceEditorPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/documents/:id" element={<DocumentEditorPage />} />
          <Route path="/calculators" element={<CalculatorsPage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          {/* Old OiB homes — keep bookmarks and in-app links working. */}
          <Route path="/pm" element={<Navigate to="/office" replace />} />
          <Route path="/finance" element={<Navigate to="/money" replace />} />
          <Route path="/finance/jobs" element={<Navigate to="/jobs" replace />} />
          <Route path="/finance/jobs/:id" element={<JobIdRedirect />} />
          <Route path="/invoices" element={<Navigate to="/money" replace />} />
          <Route path="/office-in-a-box" element={<OfficeInABoxPage />} />
          {/* D — example-data sandbox, open to non-subscribers on purpose. */}
          <Route path="/office-demo" element={<OfficeDemoPage />} />
          <Route path="/branding" element={<BrandingPage />} />
          <Route path="/settings" element={<BrandingPage />} />
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
        <AppInner />
      </ThemeProvider>
    </AuthProvider>
  );
}
