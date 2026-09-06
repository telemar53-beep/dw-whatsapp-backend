const bcrypt = require('bcrypt');
const { getPool, closePool } = require('../db/pool');
const {
  createAgent,
  findAgentByEmail,
  findAgentById,
  listAgents,
  setAgentActive,
  updateAgentPassword,
} = require('./agent.repository');

describe('agent repository', () => {
  beforeEach(async () => {
    await getPool().query('TRUNCATE agents CASCADE');
  });

  afterAll(async () => {
    await closePool();
  });

  test('createAgent stores a hashed password and returns the agent without it', async () => {
    const agent = await createAgent({ name: 'Ana', email: 'a@dw.com', password: 'secret123', role: 'agent' });
    expect(agent.name).toBe('Ana');
    expect(agent.email).toBe('a@dw.com');
    expect(agent.role).toBe('agent');
    expect(agent.active).toBe(true);
    expect(agent.passwordHash).toBeUndefined();
    expect(agent.id).toBeDefined();
  });

  test('findAgentByEmail returns the agent with its password hash and active flag', async () => {
    await createAgent({ name: 'Beto', email: 'b@dw.com', password: 'secret123', role: 'admin' });
    const agent = await findAgentByEmail('b@dw.com');
    expect(agent.name).toBe('Beto');
    expect(agent.email).toBe('b@dw.com');
    expect(agent.active).toBe(true);
    const matches = await bcrypt.compare('secret123', agent.passwordHash);
    expect(matches).toBe(true);
  });

  test('findAgentByEmail returns null when not found', async () => {
    const agent = await findAgentByEmail('missing@dw.com');
    expect(agent).toBeNull();
  });

  test('findAgentById returns the agent without its password hash', async () => {
    const created = await createAgent({ name: 'Carla', email: 'c@dw.com', password: 'secret123', role: 'agent' });
    const agent = await findAgentById(created.id);
    expect(agent.name).toBe('Carla');
    expect(agent.email).toBe('c@dw.com');
    expect(agent.passwordHash).toBeUndefined();
  });

  test('listAgents returns every agent ordered by email', async () => {
    await createAgent({ name: 'Zeta', email: 'zeta@dw.com', password: 'secret123', role: 'agent' });
    await createAgent({ name: 'Alpha', email: 'alpha@dw.com', password: 'secret123', role: 'admin' });

    const agents = await listAgents();

    expect(agents.map((a) => a.email)).toEqual(['alpha@dw.com', 'zeta@dw.com']);
    expect(agents[0].passwordHash).toBeUndefined();
  });

  test('setAgentActive deactivates and reactivates an agent', async () => {
    const created = await createAgent({ name: 'Duda', email: 'd@dw.com', password: 'secret123', role: 'agent' });

    const deactivated = await setAgentActive(created.id, false);
    expect(deactivated.active).toBe(false);

    const reactivated = await setAgentActive(created.id, true);
    expect(reactivated.active).toBe(true);
  });

  test('setAgentActive returns null when the agent does not exist', async () => {
    const result = await setAgentActive('00000000-0000-0000-0000-000000000000', false);
    expect(result).toBeNull();
  });

  test('updateAgentPassword changes the stored password hash', async () => {
    const created = await createAgent({ name: 'Elias', email: 'e@dw.com', password: 'secret123', role: 'agent' });
    const newHash = await bcrypt.hash('newpassword456', 10);

    await updateAgentPassword(created.id, newHash);

    const agent = await findAgentByEmail('e@dw.com');
    const matchesNew = await bcrypt.compare('newpassword456', agent.passwordHash);
    const matchesOld = await bcrypt.compare('secret123', agent.passwordHash);
    expect(matchesNew).toBe(true);
    expect(matchesOld).toBe(false);
  });
});
