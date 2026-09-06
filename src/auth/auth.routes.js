const express = require('express');
const { login, changePassword } = require('./auth.service');
const { requireAuth } = require('./auth.middleware');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  try {
    const result = await login({ email, password });
    res.json(result);
  } catch (err) {
    if (err.code === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (err.code === 'ACCOUNT_DISABLED') {
      return res.status(403).json({ error: 'Account disabled' });
    }
    next(err);
  }
});

router.put('/password', requireAuth, async (req, res, next) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  try {
    await changePassword({ agentId: req.agent.agentId, currentPassword, newPassword });
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err.code === 'INVALID_CURRENT_PASSWORD') {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    next(err);
  }
});

module.exports = router;
