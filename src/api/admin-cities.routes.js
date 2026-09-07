const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { createCity, deleteCity } = require('../cities/city.repository');

const router = express.Router();

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name: rawName } = req.body || {};
  const name = (rawName || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const city = await createCity({ name });
  res.status(201).json(city);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const deleted = await deleteCity(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'City not found' });
  }
  res.status(204).send();
});

module.exports = router;
