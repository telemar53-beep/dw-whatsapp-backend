const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const {
  getAssignmentMessageConfig,
  upsertAssignmentMessageConfig,
} = require('../assignment-messages/assignment-message.repository');

const router = express.Router();

function toResponse(config) {
  return {
    id: config.id,
    enabled: config.enabled,
    openingMessage: config.openingMessage,
    closingMessage: config.closingMessage,
    agentIds: config.agentIds,
    channelIds: config.channelIds,
  };
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const config = await getAssignmentMessageConfig();
  res.json(toResponse(config));
});

router.put('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { enabled, openingMessage, closingMessage, agentIds, channelIds } = req.body || {};
  if (!Array.isArray(agentIds)) {
    return res.status(400).json({ error: 'agentIds must be an array' });
  }
  if (!Array.isArray(channelIds)) {
    return res.status(400).json({ error: 'channelIds must be an array' });
  }
  if (typeof openingMessage !== 'string' || !openingMessage.trim()) {
    return res.status(400).json({ error: 'openingMessage is required' });
  }
  if (typeof closingMessage !== 'string' || !closingMessage.trim()) {
    return res.status(400).json({ error: 'closingMessage is required' });
  }
  const config = await upsertAssignmentMessageConfig({
    enabled: Boolean(enabled),
    openingMessage,
    closingMessage,
    agentIds,
    channelIds,
  });
  res.json(toResponse(config));
});

module.exports = router;
