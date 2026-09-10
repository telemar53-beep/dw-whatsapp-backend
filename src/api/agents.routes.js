const express = require('express');
const { requireAuth } = require('../auth/auth.middleware');
const { listAgents, findAgentById, updateAgentProfile } = require('../agents/agent.repository');
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
      avatarPath: agent.avatarPath,
      online: isAgentOnline(agent.id),
    }))
  );
});

router.get('/me', requireAuth, async (req, res) => {
  const agent = await findAgentById(req.agent.agentId);
  res.json({ id: agent.id, name: agent.name, email: agent.email, phone: agent.phone, avatarPath: agent.avatarPath, role: agent.role });
});

router.patch('/me', requireAuth, async (req, res) => {
  const { name, phone } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    return res.status(400).json({ error: 'name is required' });
  }
  const agent = await updateAgentProfile(req.agent.agentId, { name: trimmedName, phone: phone || null });
  res.json({ id: agent.id, name: agent.name, email: agent.email, phone: agent.phone, avatarPath: agent.avatarPath, role: agent.role });
});

module.exports = router;
