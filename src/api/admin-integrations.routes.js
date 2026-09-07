const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  listSgpIntegrations,
  createSgpIntegration,
  updateSgpIntegration,
  rotateSgpApiKey,
} = require('../integrations/sgp-integration.repository');
const { findChannelById } = require('../channels/channel.repository');

const router = express.Router();

function toIntegrationResponse(integration) {
  return {
    id: integration.id,
    description: integration.description,
    channelId: integration.channelId,
    mode: integration.mode,
    defaultTemplateId: integration.defaultTemplateId,
    enabled: integration.enabled,
    hasApiKey: integration.hasApiKey,
  };
}

function modeForChannel(channel) {
  return channel.type === 'meta_cloud' ? 'template' : 'freetext';
}

router.get('/sgp', requireAuth, requireRole('admin'), async (req, res) => {
  const integrations = await listSgpIntegrations();
  res.json(integrations.map(toIntegrationResponse));
});

router.post('/sgp', requireAuth, requireRole('admin'), async (req, res) => {
  const { description, channelId, defaultTemplateId, enabled } = req.body || {};
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }
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
  if (channel.type !== 'baileys' && channel.type !== 'meta_cloud') {
    return res.status(400).json({ error: 'Unsupported channel type' });
  }
  const mode = modeForChannel(channel);
  const integration = await createSgpIntegration({
    description: description.trim(),
    channelId,
    mode,
    defaultTemplateId: mode === 'template' ? defaultTemplateId || null : null,
    enabled,
  });
  res.status(201).json(toIntegrationResponse(integration));
});

router.put('/sgp/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { description, channelId, defaultTemplateId, enabled } = req.body || {};
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }
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
  if (channel.type !== 'baileys' && channel.type !== 'meta_cloud') {
    return res.status(400).json({ error: 'Unsupported channel type' });
  }
  const mode = modeForChannel(channel);
  const integration = await updateSgpIntegration(req.params.id, {
    description: description.trim(),
    channelId,
    mode,
    defaultTemplateId: mode === 'template' ? defaultTemplateId || null : null,
    enabled,
  });
  if (!integration) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  res.json(toIntegrationResponse(integration));
});

router.post('/sgp/:id/rotate-key', requireAuth, requireRole('admin'), async (req, res) => {
  const rotated = await rotateSgpApiKey(req.params.id);
  if (!rotated) {
    return res.status(404).json({ error: 'Integration not found' });
  }
  res.json({ apiKey: rotated.apiKey, ...toIntegrationResponse(rotated.integration) });
});

module.exports = router;
