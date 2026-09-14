const { verifyToken } = require('./auth.service');

const ADMIN_LEVEL_ROLES = ['admin', 'manager'];

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }
  const token = header.slice('Bearer '.length);
  try {
    req.agent = verifyToken(token);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    const allowed = role === 'admin' ? ADMIN_LEVEL_ROLES : [role];
    if (!allowed.includes(req.agent?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function hasIntegrationsAccess(agent) {
  return agent?.role === 'admin' || (agent?.role === 'manager' && agent?.canManageIntegrations === true);
}

function requireIntegrationsAccess(req, res, next) {
  if (!hasIntegrationsAccess(req.agent)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
}

module.exports = { requireAuth, requireRole, requireIntegrationsAccess, hasIntegrationsAccess };
