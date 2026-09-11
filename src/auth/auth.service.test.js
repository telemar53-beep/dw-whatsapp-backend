jest.mock('../agents/agent.repository');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { findAgentByEmail, findAgentByIdWithPasswordHash, updateAgentPassword } = require('../agents/agent.repository');
const { login, verifyToken, changePassword, resetAgentPassword } = require('./auth.service');

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
    await expect(login({ email: 'missing@dw.com', password: 'x' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  test('login throws when password is wrong', async () => {
    const passwordHash = await bcrypt.hash('secret123', 10);
    findAgentByEmail.mockResolvedValue({ id: 'agent-1', email: 'a@dw.com', role: 'agent', passwordHash });
    await expect(login({ email: 'a@dw.com', password: 'wrong' })).rejects.toThrow('Invalid credentials');
    await expect(login({ email: 'a@dw.com', password: 'wrong' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
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

  test('login throws ACCOUNT_DISABLED when the agent is deactivated', async () => {
    const passwordHash = await bcrypt.hash('secret123', 10);
    findAgentByEmail.mockResolvedValue({ id: 'agent-1', email: 'a@dw.com', role: 'agent', active: false, passwordHash });

    await expect(login({ email: 'a@dw.com', password: 'secret123' })).rejects.toMatchObject({
      code: 'ACCOUNT_DISABLED',
    });
  });

  test('login succeeds when active is not explicitly false (legacy rows)', async () => {
    const passwordHash = await bcrypt.hash('secret123', 10);
    findAgentByEmail.mockResolvedValue({ id: 'agent-1', email: 'a@dw.com', role: 'agent', passwordHash });

    const result = await login({ email: 'a@dw.com', password: 'secret123' });

    expect(result.token).toBeDefined();
  });

  describe('changePassword', () => {
    test('updates the password when the current password matches', async () => {
      const currentHash = await bcrypt.hash('oldpassword123', 10);
      findAgentByIdWithPasswordHash.mockResolvedValue({ id: 'agent-1', email: 'a@dw.com', passwordHash: currentHash });

      await changePassword({ agentId: 'agent-1', currentPassword: 'oldpassword123', newPassword: 'newpassword456' });

      expect(updateAgentPassword).toHaveBeenCalledWith('agent-1', expect.any(String));
      const newHash = updateAgentPassword.mock.calls[0][1];
      expect(await bcrypt.compare('newpassword456', newHash)).toBe(true);
    });

    test('throws INVALID_CURRENT_PASSWORD when the current password is wrong', async () => {
      const currentHash = await bcrypt.hash('oldpassword123', 10);
      findAgentByIdWithPasswordHash.mockResolvedValue({ id: 'agent-1', email: 'a@dw.com', passwordHash: currentHash });

      await expect(
        changePassword({ agentId: 'agent-1', currentPassword: 'wrongpassword', newPassword: 'newpassword456' })
      ).rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });
      expect(updateAgentPassword).not.toHaveBeenCalled();
    });
  });

  describe('resetAgentPassword', () => {
    test('generates a new password, hashes it, and returns the plaintext password', async () => {
      const newPassword = await resetAgentPassword('agent-1');

      expect(typeof newPassword).toBe('string');
      expect(newPassword.length).toBeGreaterThanOrEqual(10);
      expect(updateAgentPassword).toHaveBeenCalledWith('agent-1', expect.any(String));
      const newHash = updateAgentPassword.mock.calls[0][1];
      expect(await bcrypt.compare(newPassword, newHash)).toBe(true);
    });

    test('generates a different password on each call', async () => {
      const first = await resetAgentPassword('agent-1');
      const second = await resetAgentPassword('agent-1');
      expect(first).not.toBe(second);
    });

    test('only uses unambiguous alphanumeric characters (no 0/O/1/I/l)', async () => {
      const newPassword = await resetAgentPassword('agent-1');
      expect(newPassword).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]+$/);
    });
  });
});
