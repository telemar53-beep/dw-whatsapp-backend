const express = require('express');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { resetAgentPassword } = require('../auth/auth.service');
const { listAgents, createAgent, setAgentActive, findAgentById } = require('../agents/agent.repository');
const { setAgentSectors } = require('../sectors/sector.repository');

const router = express.Router();

const UNIQUE_VIOLATION = '23505';
const VALID_ROLES = ['agent', 'admin', 'manager'];

function toResponseShape(agent) {
  return {
    id: agent.id,
    name: agent.name,
    email: agent.email,
    role: agent.role,
    active: agent.active,
    canManageIntegrations: agent.canManageIntegrations,
    sectors: agent.sectors || [],
  };
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const agents = await listAgents();
  res.json(agents.map(toResponseShape));
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, email, password, role, canManageIntegrations } = req.body || {};
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password and role are required' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'role must be agent, manager or admin' });
  }
  if (req.agent.role === 'manager' && role !== 'agent') {
    return res.status(403).json({ error: 'Managers can only create attendant accounts' });
  }
  try {
    const agent = await createAgent({
      name,
      email,
      password,
      role,
      canManageIntegrations: role === 'manager' ? Boolean(canManageIntegrations) : false,
    });
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
  if (req.agent.role === 'manager') {
    const target = await findAgentById(req.params.id);
    if (!target) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    if (target.role !== 'agent') {
      return res.status(403).json({ error: 'Managers can only manage attendant accounts' });
    }
  }
  const agent = await setAgentActive(req.params.id, active);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json(toResponseShape(agent));
});

router.put('/:id/password', requireAuth, requireRole('admin'), async (req, res) => {
  if (req.params.id === req.agent.agentId) {
    return res.status(400).json({ error: 'You cannot reset your own password here' });
  }
  const agent = await findAgentById(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  if (req.agent.role === 'manager' && agent.role !== 'agent') {
    return res.status(403).json({ error: 'Managers can only manage attendant accounts' });
  }
  const newPassword = await resetAgentPassword(req.params.id);
  res.json({ newPassword });
});

router.put('/:id/sectors', requireAuth, requireRole('admin'), async (req, res) => {
  const { sectorIds } = req.body || {};
  if (!Array.isArray(sectorIds)) {
    return res.status(400).json({ error: 'sectorIds must be an array' });
  }
  const agent = await findAgentById(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  if (req.agent.role === 'manager' && agent.role !== 'agent') {
    return res.status(403).json({ error: 'Managers can only manage attendant accounts' });
  }
  await setAgentSectors(req.params.id, sectorIds);
  res.status(200).json({ ok: true });
});

module.exports = router;
