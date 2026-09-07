const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listApprovedTemplatesForChannel } = require('../templates/template.service');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { channelId } = req.query;
  if (!channelId) {
    return res.status(400).json({ error: 'channelId is required' });
  }
  const templates = await listApprovedTemplatesForChannel(channelId);
  res.json(templates);
});

module.exports = router;
