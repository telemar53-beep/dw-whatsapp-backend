const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listAgents } = require('../agents/agent.repository');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const agents = await listAgents();
  res.json(agents.map((agent) => ({ id: agent.id, email: agent.email, role: agent.role })));
});

module.exports = router;
