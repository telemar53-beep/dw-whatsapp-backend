const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { listAgents, createAgent, setAgentActive } = require('../agents/agent.repository');

const router = express.Router();

const UNIQUE_VIOLATION = '23505';
const VALID_ROLES = ['agent', 'admin'];

function toResponseShape(agent) {
  return { id: agent.id, name: agent.name, email: agent.email, role: agent.role, active: agent.active };
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const agents = await listAgents();
  res.json(agents.map(toResponseShape));
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password and role are required' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'role must be agent or admin' });
  }
  try {
    const agent = await createAgent({ name, email, password, role });
    res.status(201).json(toResponseShape(agent));
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ error: 'An agent with this email already exists' });
    }
    throw err;
  }
});

router.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'active must be a boolean' });
  }
  if (req.params.id === req.agent.agentId && active === false) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  }
  const agent = await setAgentActive(req.params.id, active);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json(toResponseShape(agent));
});

module.exports = router;
