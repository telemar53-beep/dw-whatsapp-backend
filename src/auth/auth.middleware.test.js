jest.mock('./auth.service');
const { verifyToken } = require('./auth.service');
const { requireAuth, requireRole } = require('./auth.middleware');

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
});
