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
const rateRoutes = require('./rateRoutes');
const ratesExtra = require('./rates-extra');
const projectsUsage = require('./projects-usage');
const { router: activityRoutes } = require('./activityRoutes');
const { router: pipelineRoutes } = require('./pipelineRoutes');
const variationRoutes = require('./variationRoutes');
const { authMiddleware } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
app.use(express.json());
app.use(cookieParser());

app.use('/api', routes);
app.use('/api', chatRoutes);
app.use('/api', webhookRoutes);
app.use('/api/credits', authMiddleware, creditRoutes);
app.use('/api', rateRoutes);
app.use('/api', ratesExtra);
app.use('/api', projectsUsage);
app.use('/api', activityRoutes);
app.use('/api', pipelineRoutes);
app.use('/api', variationRoutes);

if (process.env.NODE_ENV === 'production') {
  const buildPath = path.join(__dirname, '..', 'build');
  app.use(express.static(buildPath));
  app.get('*', function(req, res) { res.sendFile(path.join(buildPath, 'index.html')); });
}

app.listen(PORT, '0.0.0.0', function() { console.log('  AI QS Server running on port ' + PORT); });
