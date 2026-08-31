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
const rateImportRoutes = require('./rateImportRoutes');
const projectsUsage = require('./projects-usage');
const { router: activityRoutes } = require('./activityRoutes');
const { router: pipelineRoutes } = require('./pipelineRoutes');
const variationRoutes = require('./variationRoutes');
const deliverableRoutes = require('./deliverableRoutes');
const brandingRoutes = require('./brandingRoutes');
const findingsRoutes = require('./findingsRoutes');
const enhanceBrief = require('./enhance-brief');
const memoryRoutes = require('./memoryRoutes');
const superBrainRoutes = require('./superBrainRoutes');
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
// Public build/version marker so we can confirm exactly which commit is live in
// production (Render sets RENDER_GIT_COMMIT/BRANCH automatically). Registered
// before the /api routers so nothing shadows it. No auth — exposes no secrets.
const SERVER_STARTED_AT = new Date().toISOString();
let SHARP_OK = null;
function sharpAvailable() {
  if (SHARP_OK === null) {
    try { require('sharp'); SHARP_OK = true; } catch (e) { SHARP_OK = false; }
  }
  return SHARP_OK;
}
app.get('/api/version', (req, res) => {
  res.json({
    commit: process.env.RENDER_GIT_COMMIT || 'unknown',
    branch: process.env.RENDER_GIT_BRANCH || 'unknown',
    service: process.env.RENDER_SERVICE_NAME || 'unknown',
    startedAt: SERVER_STARTED_AT,
    now: new Date().toISOString(),
    sharp: sharpAvailable(),
    marker: 'logo+sharp-status',
  });
});
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
app.use('/api', rateImportRoutes);
app.use('/api', projectsUsage);
app.use('/api', activityRoutes);
app.use('/api', pipelineRoutes);
app.use('/api', variationRoutes);
app.use('/api', deliverableRoutes);
app.use('/api', brandingRoutes);
app.use('/api', findingsRoutes);
app.use('/api', memoryRoutes);
app.use('/api', superBrainRoutes);
app.use('/api', surveyRoutes);
app.use('/api', agentRoutes);
app.use('/api/estimator', estimatorRoutes);
// AI assistant on a saved quote — "tell it what changed, it proposes the edit".
// Self-contained router (see estimatorAssistantRoutes.js); mounted on the same
// prefix so it shares the estimator gates and the x-estimator-key header.
app.use('/api/estimator', require('./estimatorAssistantRoutes'));
// The same assistant on the Builder Pack / Client Copy screen — amends BOQ
// items and client-copy controls by chat. Auth-only, same project access rule
// as the other /projects/:id/builder-pack routes.
app.use('/api', require('./builderPackAssistantRoutes'));
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
// The chat widget on the marketing site (theaiqs.co.uk). Unauthenticated by
// design — a stranger asking a question before they sign up — and rate-limited
// per IP inside the router.
app.use('/api/public', require('./siteChatRoutes'));
// A2: public invoice view (/i/<token>) — same posture.
app.use('/api/public/invoices', invoicePublicRoutes);
// B4: photos on jobs.
app.use('/api/job-photos', require('./jobPhotoRoutes').router);
// Wave 3: Invoices & payment schedules.
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payment-schedules', paymentScheduleRoutes);
// Native Xero connection — one-button OAuth2, pushes invoices straight in.
app.use('/api/xero', require('./xeroRoutes'));
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
// 3D Builder (Phase 1) — parametric building -> priced take-off. Admin-only
// for now (the router gates itself with authMiddleware + adminMiddleware).
app.use('/api/builder3d', require('./builder3dRoutes'));
// Planning Leads (preview) — scan councils for recently-granted domestic
// applications and draft a headed intro letter. Locked to a single account
// (the router gates itself with authMiddleware + an email allowlist).
app.use('/api/planning-leads', require('./planningLeadsRoutes'));
// Health endpoint. Registered BEFORE the SPA catch-all, or it would be served
// index.html and report healthy no matter what state the server was in.
// Also reports whether the evidence layer came up, which is how you verify a
// deploy turned it on.
app.get('/api/health', async function (req, res) {
  let evidence = 'off';
  try {
    const { isAvailable } = require('./evidenceClient');
    evidence = (await isAvailable()) ? 'ready' : 'off';
  } catch (e) { evidence = 'off'; }
  res.json({ ok: true, evidence, uptime_s: Math.round(process.uptime()) });
});

if (process.env.NODE_ENV === 'production') {
  const buildPath = path.join(__dirname, '..', 'build');
  app.use(express.static(buildPath));
  app.get('*', function(req, res) { res.sendFile(path.join(buildPath, 'index.html')); });
}
// A3: automated payment reminders — twice-daily sweep, no-op without SMTP.
require('./paymentReminders').start();
// Rate onboarding — remind new signups to add their rates (day 3/7/14), and
// alert the admin the moment they do. Same twice-daily sweep pattern.
require('./rateOnboarding').start();
// Credit top-up drip — chase zero-balance accounts on day 2/4/6/8/10 after
// running out, then one final sign-off on day 12. Stops itself on top-up.
require('./creditNotifications').start();
// Planning Leads — start the slow background harvester that fills the local
// planning-application store one area at a time, so scans never hit PlanIt live.
require('./planningData').startHarvester();
// Evidence sidecar — runs inside this container so it shares the uploads disk.
// Always optional: if Python or PyMuPDF is missing it logs one line and the
// portal carries on, with takeoffs reported as visual-only.
try { require('./evidenceSupervisor').start(); } catch (e) { console.error('[Evidence] supervisor failed to start:', e.message); }

const server = app.listen(PORT, '0.0.0.0', function() { console.log('  AI QS Server running on port ' + PORT); });

// ── Upload timeouts ──────────────────────────────────────────────────────────
// Node 18+ defaults server.requestTimeout to 300s (5 minutes) — measured from
// the first byte of the request to the last byte of the BODY, not from the
// response. A builder on a site connection pushing a 100 MB drawing set at
// ~3 Mbps needs ~4.5 minutes; at 2 Mbps, ~7. Node was destroying those sockets
// mid-upload, so the browser saw a generic network failure with no message
// after several minutes of apparent progress — "sometimes it works" being
// exactly the difference between a fast office line and a slow site one.
// 30 minutes covers the worst realistic case (a 20-file, 100 MB-a-file
// submission on a poor link) while still capping a genuinely stuck socket.
server.requestTimeout = 30 * 60 * 1000;
// Headers must still arrive promptly — this guards slowloris without touching
// body upload time. Must stay above keepAliveTimeout.
server.headersTimeout = 65 * 1000;
server.keepAliveTimeout = 61 * 1000;
// No per-socket inactivity timeout: a large upload is one long write with no
// inbound traffic, which some proxies would otherwise read as idle.
server.setTimeout(0);
