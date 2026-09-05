const bcrypt = require('bcrypt');
const { getPool, closePool } = require('../db/pool');
const { createAgent, findAgentByEmail, findAgentById, listAgents } = require('./agent.repository');

describe('agent repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE agents CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createAgent stores a hashed password and returns the agent without it', async () => {
    const agent = await createAgent({ email: 'a@dw.com', password: 'secret123', role: 'agent' });
    expect(agent.email).toBe('a@dw.com');
    expect(agent.role).toBe('agent');
    expect(agent.passwordHash).toBeUndefined();
    expect(agent.id).toBeDefined();
  });

  test('findAgentByEmail returns the agent with its password hash', async () => {
    await createAgent({ email: 'b@dw.com', password: 'secret123', role: 'admin' });
    const agent = await findAgentByEmail('b@dw.com');
    expect(agent.email).toBe('b@dw.com');
    const matches = await bcrypt.compare('secret123', agent.passwordHash);
    expect(matches).toBe(true);
  });

  test('findAgentByEmail returns null when not found', async () => {
    const agent = await findAgentByEmail('missing@dw.com');
    expect(agent).toBeNull();
  });

  test('findAgentById returns the agent without its password hash', async () => {
    const created = await createAgent({ email: 'c@dw.com', password: 'secret123', role: 'agent' });
    const agent = await findAgentById(created.id);
    expect(agent.email).toBe('c@dw.com');
    expect(agent.passwordHash).toBeUndefined();
  });

  test('listAgents returns every agent ordered by email', async () => {
    await createAgent({ email: 'zeta@dw.com', password: 'secret123', role: 'agent' });
    await createAgent({ email: 'alpha@dw.com', password: 'secret123', role: 'admin' });

    const agents = await listAgents();

    expect(agents.map((a) => a.email)).toEqual(['alpha@dw.com', 'zeta@dw.com']);
    expect(agents[0].passwordHash).toBeUndefined();
  });
});
