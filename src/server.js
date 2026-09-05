require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { loadConfig } = require('./config/env');
const { getPool } = require('./db/pool');
const authRoutes = require('./auth/auth.routes');
const metaCloudRoutes = require('./whatsapp-adapters/meta-cloud.routes');
const conversationsRoutes = require('./api/conversations.routes');
const { startOutboundWorker } = require('./queue/outbound-worker');

const config = loadConfig();
const app = express();

app.use(cors());
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

app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/webhooks', metaCloudRoutes);

app.use((err, req, res, next) => {
  console.error('Unhandled API error', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  startOutboundWorker();
  app.listen(config.port, () => {
    console.log('Servidor rodando na porta ' + config.port);
  });
}

module.exports = app;
