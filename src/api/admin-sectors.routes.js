const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { createSector, updateSector, deleteSector } = require('../sectors/sector.repository');

const router = express.Router();

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name: rawName } = req.body || {};
  const name = (rawName || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const sector = await createSector({ name });
  res.status(201).json(sector);
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { name: rawName } = req.body || {};
  const name = (rawName || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const sector = await updateSector(req.params.id, { name });
  if (!sector) {
    return res.status(404).json({ error: 'Sector not found' });
  }
  res.json(sector);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const deleted = await deleteSector(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Sector not found' });
  }
  res.status(204).send();
});

module.exports = router;
