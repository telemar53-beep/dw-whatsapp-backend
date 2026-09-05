const express = require('express');
const { login } = require('./auth.service');

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
    next(err);
  }
});

module.exports = router;
