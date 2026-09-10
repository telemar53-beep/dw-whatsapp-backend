const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { listAllReasons, createReason, updateReason } = require('../reasons/reason.repository');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const reasons = await listAllReasons();
  res.json(reasons);
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name: rawName } = req.body || {};
  const name = (rawName || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  const reason = await createReason({ name });
  res.status(201).json(reason);
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { name: rawName, active } = req.body || {};
  if (rawName === undefined && active === undefined) {
    return res.status(400).json({ error: 'name or active is required' });
  }
  let name;
  if (rawName !== undefined) {
    name = (rawName || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
  }
  if (active !== undefined && typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active must be a boolean' });
  }
  const reason = await updateReason(req.params.id, { name, active });
  if (!reason) {
    return res.status(404).json({ error: 'Reason not found' });
  }
  res.json(reason);
});

module.exports = router;
