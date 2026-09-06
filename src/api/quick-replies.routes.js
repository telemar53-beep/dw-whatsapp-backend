const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listQuickReplies } = require('../quick-replies/quick-reply.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const quickReplies = await listQuickReplies();
  res.json(quickReplies);
});

module.exports = router;
