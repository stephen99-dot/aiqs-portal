require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const routes = require('./routes');
const chatRoutes = require('./chat');
const stripeWebhook = require('./stripe-webhook');
const webhookRoutes = require('./webhookRoutes');
const creditRoutes = require('./creditRoutes');
const submissionRoutes = require('./submissionRoutes');
const rateRoutes = require('./rateRoutes');
const ratesExtra = require('./rates-extra');
const projectsUsage = require('./projects-usage');
const { router: activityRoutes } = require('./activityRoutes');
const { router: pipelineRoutes } = require('./pipelineRoutes');
const variationRoutes = require('./variationRoutes');
const deliverableRoutes = require('./deliverableRoutes');
const brandingRoutes = require('./brandingRoutes');
const findingsRoutes = require('./findingsRoutes');
const enhanceBrief = require('./enhance-brief');
const memoryRoutes = require('./memoryRoutes');
const surveyRoutes = require('./surveyRoutes');
const agentRoutes = require('./agentRoutes');
const estimatorRoutes = require('./estimatorRoutes');
const financeRoutes = require('./financeRoutes');
const estimatorVariationRoutes = require('./estimatorVariationRoutes');
const quotePublicRoutes = require('./quotePublicRoutes');
const invoicePublicRoutes = require('./invoicePublicRoutes');
const invoiceRoutes = require('./invoiceRoutes');
const paymentScheduleRoutes = require('./paymentScheduleRoutes');
const documentsRoutes = require('./documentsRoutes');
const projectManagerRoutes = require('./projectManagerRoutes');
const materialsRoutes = require('./materialsRoutes');
const { authMiddleware } = require('./auth');
const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors({ origin: true, credentials: true }));
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());
app.use('/api', routes);
app.use('/api', chatRoutes);
app.use('/api', webhookRoutes);
app.use('/api', enhanceBrief);
app.use('/api/credits', authMiddleware, creditRoutes);
// Public Pipedream callback (no auth — secret-protected) MUST be registered
// before the authMiddleware-guarded mount, otherwise the auth runs first and
// rejects unauthenticated webhook calls.
app.post('/api/submissions/webhook/drive-link', submissionRoutes.driveLinkWebhookHandler);
app.use('/api/submissions', authMiddleware, submissionRoutes);
app.use('/api', rateRoutes);
app.use('/api', ratesExtra);
app.use('/api', projectsUsage);
app.use('/api', activityRoutes);
app.use('/api', pipelineRoutes);
app.use('/api', variationRoutes);
app.use('/api', deliverableRoutes);
app.use('/api', brandingRoutes);
app.use('/api', findingsRoutes);
app.use('/api', memoryRoutes);
app.use('/api', surveyRoutes);
app.use('/api', agentRoutes);
app.use('/api/estimator', estimatorRoutes);
app.use('/api/finance', financeRoutes);
// Wave 4: Variations / Change Orders. Owner side is /api/change-orders to
// avoid colliding with the BOQ-pipeline /api/variations/:projectId routes.
// /api/public/variations is unauthenticated by design — that's the path the
// client opens via the shareable approval link.
app.use('/api/change-orders', estimatorVariationRoutes.ownerRouter);
app.use('/api/public/variations', estimatorVariationRoutes.publicRouter);
// A1: public quote acceptance — unauthenticated by design (tokened /q/<token>
// links), rate-limited inside the router.
app.use('/api/public/quotes', quotePublicRoutes);
// A2: public invoice view (/i/<token>) — same posture.
app.use('/api/public/invoices', invoicePublicRoutes);
// B4: photos on jobs.
app.use('/api/job-photos', require('./jobPhotoRoutes').router);
// Wave 3: Invoices & payment schedules.
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payment-schedules', paymentScheduleRoutes);
// Wave 5: Documents & Compliance — fillable templates -> branded PDF.
app.use('/api/documents', documentsRoutes);
// AI Project Manager — deterministic alerts engine (Part A) + LLM-grounded Q&A (Part B).
app.use('/api/pm', projectManagerRoutes);
// UK Materials Pricing — searchable catalogue + supplier price comparison that
// plugs into the quote builder. Gated behind the Office-in-a-Box add-on.
app.use('/api/materials', materialsRoutes);
// Wave 6: Intelligent Build Schedule (Stage 1). Available to all Office in a
// Box users — the router gates itself with authMiddleware + requireEstimator.
// See BUILD_SCHEDULE_SPEC.md.
app.use('/api/schedule', require('./scheduleRoutes'));
if (process.env.NODE_ENV === 'production') {
  const buildPath = path.join(__dirname, '..', 'build');
  app.use(express.static(buildPath));
  app.get('*', function(req, res) { res.sendFile(path.join(buildPath, 'index.html')); });
}
// A3: automated payment reminders — twice-daily sweep, no-op without SMTP.
require('./paymentReminders').start();
app.listen(PORT, '0.0.0.0', function() { console.log('  AI QS Server running on port ' + PORT); });
