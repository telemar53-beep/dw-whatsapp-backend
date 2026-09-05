jest.mock('../agents/agent.repository');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { findAgentByEmail } = require('../agents/agent.repository');
const { login, verifyToken } = require('./auth.service');

describe('auth service', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    jest.clearAllMocks();
  });

  test('login returns a token when credentials are valid', async () => {
    const passwordHash = await bcrypt.hash('secret123', 10);
    findAgentByEmail.mockResolvedValue({ id: 'agent-1', email: 'a@dw.com', role: 'agent', passwordHash });

    const result = await login({ email: 'a@dw.com', password: 'secret123' });

    expect(result.token).toBeDefined();
    const decoded = jwt.verify(result.token, 'test-secret');
    expect(decoded.agentId).toBe('agent-1');
    expect(decoded.role).toBe('agent');
  });

  test('login throws when agent does not exist', async () => {
    findAgentByEmail.mockResolvedValue(null);
    await expect(login({ email: 'missing@dw.com', password: 'x' })).rejects.toThrow('Invalid credentials');
  });

  test('login throws when password is wrong', async () => {
    const passwordHash = await bcrypt.hash('secret123', 10);
    findAgentByEmail.mockResolvedValue({ id: 'agent-1', email: 'a@dw.com', role: 'agent', passwordHash });
    await expect(login({ email: 'a@dw.com', password: 'wrong' })).rejects.toThrow('Invalid credentials');
  });

  test('verifyToken returns the decoded payload for a valid token', () => {
    const token = jwt.sign({ agentId: 'agent-1', role: 'admin' }, 'test-secret');
    const decoded = verifyToken(token);
    expect(decoded.agentId).toBe('agent-1');
    expect(decoded.role).toBe('admin');
  });

  test('verifyToken throws for an invalid token', () => {
    expect(() => verifyToken('not-a-token')).toThrow();
  });
});
