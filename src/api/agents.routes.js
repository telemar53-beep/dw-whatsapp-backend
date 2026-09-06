const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listAgents } = require('../agents/agent.repository');
const { isAgentOnline } = require('../realtime/presence');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const agents = await listAgents();
  res.json(
    agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      online: isAgentOnline(agent.id),
    }))
  );
});

module.exports = router;
