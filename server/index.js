require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

// ─── Existing routes ────────────────────────────────────────────────────────
const routes = require('./routes');
const chatRoutes = require('./chat');
const stripeWebhook = require('./stripe-webhook');

// ─── New routes ─────────────────────────────────────────────────────────────
const webhookRoutes = require('./webhookRoutes');
const creditRoutes = require('./creditRoutes');
const userRoutes = require('./userRoutes');
const { authMiddleware } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));

// Stripe webhook needs raw body — must come BEFORE express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);

app.use(express.json());
app.use(cookieParser());

// ─── Existing routes (handle their own auth internally) ─────────────────────
app.use('/api', routes);
app.use('/api', chatRoutes);

// ─── Webhook routes — NO auth (Pipedream calls these) ───────────────────────
app.use('/api', webhookRoutes);

// ─── New authenticated routes ───────────────────────────────────────────────
// Mounted at specific prefixes so they NEVER intercept /api/auth/*
app.use('/api/credits', authMiddleware, creditRoutes);
app.use('/api/admin', authMiddleware, userRoutes);

// ─── Serve frontend in production ───────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const buildPath = path.join(__dirname, '..', 'build');
  app.use(express.static(buildPath));
  app.get('*', (req, res) => res.sendFile(path.join(buildPath, 'index.html')));
}

app.listen(PORT, '0.0.0.0', () => console.log(`\n  ⚡ AI QS Server running on port ${PORT}\n`));
