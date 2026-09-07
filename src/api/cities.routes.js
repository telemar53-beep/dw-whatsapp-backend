const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listCities } = require('../cities/city.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const cities = await listCities();
  res.json(cities);
});

module.exports = router;
