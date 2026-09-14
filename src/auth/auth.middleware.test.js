jest.mock('./auth.service');
const { verifyToken } = require('./auth.service');
const { requireAuth, requireRole, requireIntegrationsAccess, hasIntegrationsAccess, hasAdminLevelAccess } = require('./auth.middleware');

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('requireAuth', () => {
  beforeEach(() => jest.clearAllMocks());

  test('attaches decoded agent to req and calls next when token is valid', () => {
    verifyToken.mockReturnValue({ agentId: 'agent-1', role: 'agent' });
    const req = { headers: { authorization: 'Bearer valid-token' } };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(req.agent).toEqual({ agentId: 'agent-1', role: 'agent' });
    expect(next).toHaveBeenCalled();
  });

  test('returns 401 when authorization header is missing', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 401 when token is invalid', () => {
    verifyToken.mockImplementation(() => { throw new Error('invalid'); });
    const req = { headers: { authorization: 'Bearer bad-token' } };
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  test('calls next when agent has the required role', () => {
    const req = { agent: { role: 'admin' } };
    const res = mockRes();
    const next = jest.fn();

    requireRole('admin')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('returns 403 when agent lacks the required role', () => {
    const req = { agent: { role: 'agent' } };
    const res = mockRes();
    const next = jest.fn();

    requireRole('admin')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next when a manager is checked against the admin role', () => {
    const req = { agent: { role: 'manager' } };
    const res = mockRes();
    const next = jest.fn();

    requireRole('admin')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('still only matches an exact role for a non-admin check', () => {
    const req = { agent: { role: 'manager' } };
    const res = mockRes();
    const next = jest.fn();

    requireRole('agent')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('hasIntegrationsAccess', () => {
  test('returns true for an admin', () => {
    expect(hasIntegrationsAccess({ role: 'admin' })).toBe(true);
  });

  test('returns true for a manager with the flag', () => {
    expect(hasIntegrationsAccess({ role: 'manager', canManageIntegrations: true })).toBe(true);
  });

  test('returns false for a manager without the flag', () => {
    expect(hasIntegrationsAccess({ role: 'manager', canManageIntegrations: false })).toBe(false);
  });

  test('returns false for a plain agent', () => {
    expect(hasIntegrationsAccess({ role: 'agent' })).toBe(false);
  });

  test('returns false for a missing agent', () => {
    expect(hasIntegrationsAccess(undefined)).toBe(false);
  });
});

describe('hasAdminLevelAccess', () => {
  test('returns true for an admin', () => {
    expect(hasAdminLevelAccess({ role: 'admin' })).toBe(true);
  });

  test('returns true for a manager', () => {
    expect(hasAdminLevelAccess({ role: 'manager' })).toBe(true);
  });

  test('returns false for a plain agent', () => {
    expect(hasAdminLevelAccess({ role: 'agent' })).toBe(false);
  });

  test('returns false for a missing agent', () => {
    expect(hasAdminLevelAccess(undefined)).toBe(false);
  });
});

describe('requireIntegrationsAccess', () => {
  test('calls next for an admin', () => {
    const req = { agent: { role: 'admin' } };
    const res = mockRes();
    const next = jest.fn();

    requireIntegrationsAccess(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('calls next for a manager with the flag', () => {
    const req = { agent: { role: 'manager', canManageIntegrations: true } };
    const res = mockRes();
    const next = jest.fn();

    requireIntegrationsAccess(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('returns 403 for a manager without the flag', () => {
    const req = { agent: { role: 'manager', canManageIntegrations: false } };
    const res = mockRes();
    const next = jest.fn();

    requireIntegrationsAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('returns 403 for a plain agent', () => {
    const req = { agent: { role: 'agent' } };
    const res = mockRes();
    const next = jest.fn();

    requireIntegrationsAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
