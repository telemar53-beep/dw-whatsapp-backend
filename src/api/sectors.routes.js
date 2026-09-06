const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listSectors } = require('../sectors/sector.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const sectors = await listSectors();
  res.json(sectors);
});

module.exports = router;
