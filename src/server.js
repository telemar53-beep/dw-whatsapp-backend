require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { loadConfig } = require('./config/env');
const { getAllowedOrigins } = require('./config/cors-origins');
const { getPool } = require('./db/pool');
const authRoutes = require('./auth/auth.routes');
const metaCloudRoutes = require('./whatsapp-adapters/meta-cloud.routes');
const conversationsRoutes = require('./api/conversations.routes');
const agentsRoutes = require('./api/agents.routes');
const channelsRoutes = require('./api/channels.routes');
const contactsRoutes = require('./api/contacts.routes');
const quickRepliesRoutes = require('./api/quick-replies.routes');
const sectorsRoutes = require('./api/sectors.routes');
const citiesRoutes = require('./api/cities.routes');
const adminChannelsRoutes = require('./api/admin-channels.routes');
const adminAgentsRoutes = require('./api/admin-agents.routes');
const adminQuickRepliesRoutes = require('./api/admin-quick-replies.routes');
const adminSectorsRoutes = require('./api/admin-sectors.routes');
const adminCitiesRoutes = require('./api/admin-cities.routes');
const adminTriageRoutes = require('./api/admin-triage.routes');
const mediaRoutes = require('./api/media.routes');
const metricsRoutes = require('./api/metrics.routes');
const templatesRoutes = require('./api/templates.routes');
const adminTemplatesRoutes = require('./api/admin-templates.routes');
const integrationsSgpRoutes = require('./api/integrations-sgp.routes');
const adminIntegrationsRoutes = require('./api/admin-integrations.routes');
const { globalLimiter } = require('./config/rate-limiters');
const { initSocketServer } = require('./realtime/socket-server');

const config = loadConfig();
const app = express();

app.use(cors({ origin: getAllowedOrigins() }));
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get('/health', async (req, res) => {
  try {
    await getPool().query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'ok', db: 'unreachable' });
  }
});

app.get('/', (req, res) => {
  res.json({ message: 'API WhatsApp DW Telecom' });
});

app.use(globalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/channels', channelsRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/quick-replies', quickRepliesRoutes);
app.use('/api/sectors', sectorsRoutes);
app.use('/api/cities', citiesRoutes);
app.use('/api/admin/channels', adminChannelsRoutes);
app.use('/api/admin/agents', adminAgentsRoutes);
app.use('/api/admin/quick-replies', adminQuickRepliesRoutes);
app.use('/api/admin/sectors', adminSectorsRoutes);
app.use('/api/admin/cities', adminCitiesRoutes);
app.use('/api/admin/triage', adminTriageRoutes);
app.use('/api/admin/integrations', adminIntegrationsRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/admin/templates', adminTemplatesRoutes);
app.use('/api/integrations/sgp', integrationsSgpRoutes);
app.use('/webhooks', metaCloudRoutes);

app.use((err, req, res, next) => {
  console.error('Unhandled API error', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  // Required lazily (not at module top-level): outbound-worker.js and
  // baileys.manager.js transitively touch @whiskeysockets/baileys. The
  // actual Jest/ESM incompatibility was fixed at its source inside
  // baileys.manager.js, so this laziness isn't load-bearing anymore, but
  // keeping requires for boot-only concerns out of the module's static
  // import graph is harmless and avoids reintroducing the same class of
  // problem if a future change reverts that fix.
  const { startOutboundWorker } = require('./queue/outbound-worker');
  const { startAllBaileysConnections } = require('./whatsapp-adapters/baileys.manager');
  const httpServer = http.createServer(app);
  initSocketServer(httpServer);
  startOutboundWorker();
  startAllBaileysConnections().catch((err) => {
    console.error('Failed to start Baileys connections', err);
  });
  httpServer.listen(config.port, () => {
    console.log('Servidor rodando na porta ' + config.port);
  });
}

module.exports = app;
