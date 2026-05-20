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
import DocumentsPage from './pages/DocumentsPage';
import DocumentEditorPage from './pages/DocumentEditorPage';
import CalculatorsPage from './pages/CalculatorsPage';
import ProjectManagerPage from './pages/ProjectManagerPage';

// Office in a Box — new 3-item structure (Dashboard / Jobs / Settings).
// The old /finance, /invoices, /documents, /change-orders, /estimator/quote/:id,
// /pm routes still resolve via the redirect helpers, so existing bookmarks
// keep working. The features themselves move in chunk 2.
import OfficeDashboardPage from './pages/office/OfficeDashboardPage';
import OfficeJobsPage from './pages/office/OfficeJobsPage';
import OfficeSettingsPage from './pages/office/OfficeSettingsPage';
import JobWorkspacePage from './pages/office/JobWorkspacePage';
import { OverviewTab, EstimateTab, VariationsTab, InvoicesTab, DocumentsTab } from './pages/office/JobTabPlaceholder';
import { RedirectVariation, RedirectInvoice, RedirectQuote, RedirectDocument, RedirectJob } from './pages/office/RedirectHelpers';
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
          {/* Old Office in a Box routes — all redirected below. The page
              components are still imported because the redirect map below
              renders some of them under /office/settings (overheads, my
              rates, documents-as-templates, calculators, PM-as-alerts). */}
          <Route path="/pm" element={<Navigate to="/office" replace />} />

          {/* ─── Office in a Box — new 3-item structure ──────────────────── */}
          <Route path="/office" element={<OfficeDashboardPage />} />
          <Route path="/office/jobs" element={<OfficeJobsPage />} />
          <Route path="/office/jobs/:id" element={<JobWorkspacePage />}>
            <Route index element={<OverviewTab />} />
            <Route path="overview"   element={<OverviewTab />} />
            <Route path="estimate"   element={<EstimateTab />} />
            <Route path="estimate/:quoteId" element={<EstimateTab />} />
            <Route path="variations" element={<VariationsTab />} />
            <Route path="variations/:variationId" element={<VariationsTab />} />
            <Route path="invoices"   element={<InvoicesTab />} />
            <Route path="invoices/:invoiceId" element={<InvoicesTab />} />
            <Route path="documents"  element={<DocumentsTab />} />
            <Route path="documents/:documentId" element={<DocumentsTab />} />
          </Route>
          <Route path="/office/settings" element={<OfficeSettingsPage />} />
          <Route path="/office/settings/overheads"   element={<OverheadsPage />} />
          <Route path="/office/settings/branding"    element={<Navigate to="/onboarding?step=branding" replace />} />
          <Route path="/office/settings/rates"       element={<MyRatesPage />} />
          <Route path="/office/settings/templates"   element={<DocumentsPage />} />
          <Route path="/office/settings/calculators" element={<CalculatorsPage />} />
          <Route path="/office/settings/alerts"      element={<ProjectManagerPage />} />

          {/* ─── Legacy redirects — keep old bookmarks working ───────────── */}
          <Route path="/finance"              element={<Navigate to="/office" replace />} />
          <Route path="/finance/jobs"         element={<Navigate to="/office/jobs" replace />} />
          <Route path="/finance/jobs/:id"     element={<RedirectJob />} />
          <Route path="/finance/overheads"    element={<Navigate to="/office/settings/overheads" replace />} />
          <Route path="/estimator"            element={<Navigate to="/office/jobs" replace />} />
          <Route path="/estimator/new"        element={<Navigate to="/office?action=new-job" replace />} />
          <Route path="/estimator/quote/:id"  element={<RedirectQuote />} />
          <Route path="/invoices"             element={<Navigate to="/office/jobs" replace />} />
          <Route path="/invoices/:id"         element={<RedirectInvoice />} />
          <Route path="/documents"            element={<Navigate to="/office/settings/templates" replace />} />
          <Route path="/documents/:id"        element={<RedirectDocument />} />
          <Route path="/change-orders/new"    element={<Navigate to="/office/jobs" replace />} />
          <Route path="/change-orders/:id"    element={<RedirectVariation />} />
          <Route path="/calculators"          element={<Navigate to="/office/settings/calculators" replace />} />

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
