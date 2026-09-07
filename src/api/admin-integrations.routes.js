const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { getSgpIntegration, saveSgpIntegrationChannel, rotateSgpApiKey } = require('../integrations/sgp-integration.repository');
const { findChannelById } = require('../channels/channel.repository');

const router = express.Router();

function toIntegrationResponse(integration) {
  if (!integration) return { configured: false };
  return {
    configured: true,
    channelId: integration.channelId,
    enabled: integration.enabled,
    hasApiKey: integration.hasApiKey,
  };
}

router.get('/sgp', requireAuth, requireRole('admin'), async (req, res) => {
  const integration = await getSgpIntegration();
  res.json(toIntegrationResponse(integration));
});

router.put('/sgp', requireAuth, requireRole('admin'), async (req, res) => {
  const { channelId, enabled } = req.body || {};
  if (!channelId || typeof channelId !== 'string') {
    return res.status(400).json({ error: 'channelId is required' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }
  const channel = await findChannelById(channelId);
  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  if (channel.type !== 'baileys') {
    return res.status(400).json({ error: 'Only Baileys channels can be used for the SGP integration' });
  }
  const integration = await saveSgpIntegrationChannel({ channelId, enabled });
  res.json(toIntegrationResponse(integration));
});

router.post('/sgp/rotate-key', requireAuth, requireRole('admin'), async (req, res) => {
  const rotated = await rotateSgpApiKey();
  if (!rotated) {
    return res.status(400).json({ error: 'Choose a channel for the SGP integration before generating a key' });
  }
  res.json({ apiKey: rotated.apiKey, ...toIntegrationResponse(rotated.integration) });
});

module.exports = router;
