const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listChannels } = require('../channels/channel.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const channels = await listChannels();
  res.json(
    channels.map((channel) => ({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      phoneNumber: channel.phoneNumber,
      status: channel.status,
    }))
  );
});

module.exports = router;
