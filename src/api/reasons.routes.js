const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listActiveReasons } = require('../reasons/reason.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const reasons = await listActiveReasons();
  res.json(reasons);
});

module.exports = router;
