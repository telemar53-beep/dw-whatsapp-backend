const { getPool, closePool } = require('../db/pool');
const { createAgent } = require('../agents/agent.repository');
const { createSector, setAgentSectors } = require('../sectors/sector.repository');
const { getMetricsForAgent, getMetricsForAllAgents, getMetricsBySector } = require('./metrics.repository');

let contactCounter = 0;

async function seedChannel() {
  const result = await getPool().query(
    `INSERT INTO channels (type, name, phone_number, config) VALUES ('baileys', 'Canal de Teste', $1, '{}') RETURNING id`,
    [`+55119${Date.now()}${Math.floor(Math.random() * 1000)}`]
  );
  return result.rows[0].id;
}

async function seedContact() {
  contactCounter += 1;
  const result = await getPool().query('INSERT INTO contacts (phone_number) VALUES ($1) RETURNING id', [
    `5511900${String(contactCounter).padStart(6, '0')}`,
  ]);
  return result.rows[0].id;
}

async function seedClosedConversation({ channelId, contactId, agentId, startedAt, closedAt, firstResponseAt }) {
  const conv = await getPool().query(
    `INSERT INTO conversations (contact_id, channel_id, status, assigned_agent_id, created_at, updated_at)
     VALUES ($1, $2, 'closed', $3, $4, $4) RETURNING id`,
    [contactId, channelId, agentId, startedAt]
  );
  const conversationId = conv.rows[0].id;
  await getPool().query(
    `INSERT INTO conversation_events (conversation_id, event_type, from_agent_id, created_at)
     VALUES ($1, 'closed', $2, $3)`,
    [conversationId, agentId, closedAt]
  );
  if (firstResponseAt) {
    await getPool().query(
      `INSERT INTO messages (conversation_id, direction, content, created_at)
       VALUES ($1, 'outbound', 'Resposta de teste', $2)`,
      [conversationId, firstResponseAt]
    );
  }
  return conversationId;
}

describe('metrics repository', () => {
  beforeEach(async () => {
    await getPool().query(
      'TRUNCATE messages, conversation_events, conversations, contacts, channels, agent_sectors, sectors, agents CASCADE'
    );
    contactCounter = 0;
  });

  afterAll(async () => {
    await closePool();
  });

  const SINCE = new Date('2026-01-02T00:00:00Z');
  const BEFORE_SINCE = new Date('2026-01-01T09:00:00Z');

  test('getMetricsForAgent averages resolution and first-response time, ignoring conversations with no response for the first-response average', async () => {
    const agent = await createAgent({ email: 'metrics-agent1@dw.com', password: 'secret123', role: 'agent' });
    const channelId = await seedChannel();
    const contactA = await seedContact();
    const contactB = await seedContact();

    await seedClosedConversation({
      channelId,
      contactId: contactA,
      agentId: agent.id,
      startedAt: new Date('2026-01-02T10:00:00Z'),
      closedAt: new Date('2026-01-02T10:30:00Z'),
      firstResponseAt: new Date('2026-01-02T10:05:00Z'),
    });
    await seedClosedConversation({
      channelId,
      contactId: contactB,
      agentId: agent.id,
      startedAt: new Date('2026-01-02T11:00:00Z'),
      closedAt: new Date('2026-01-02T11:20:00Z'),
      firstResponseAt: null,
    });

    const metrics = await getMetricsForAgent(agent.id, SINCE);

    expect(metrics.closedCount).toBe(2);
    expect(metrics.avgResolutionMinutes).toBe(25);
    expect(metrics.avgFirstResponseMinutes).toBe(5);
  });

  test('getMetricsForAgent excludes conversations closed before the since timestamp', async () => {
    const agent = await createAgent({ email: 'metrics-agent2@dw.com', password: 'secret123', role: 'agent' });
    const channelId = await seedChannel();
    const contactId = await seedContact();

    await seedClosedConversation({
      channelId,
      contactId,
      agentId: agent.id,
      startedAt: BEFORE_SINCE,
      closedAt: new Date('2026-01-01T09:15:00Z'),
      firstResponseAt: new Date('2026-01-01T09:05:00Z'),
    });

    const metrics = await getMetricsForAgent(agent.id, SINCE);

    expect(metrics.closedCount).toBe(0);
    expect(metrics.avgResolutionMinutes).toBeNull();
    expect(metrics.avgFirstResponseMinutes).toBeNull();
  });

  test('getMetricsForAgent returns zero/null for an agent with no closed conversations', async () => {
    const agent = await createAgent({ email: 'metrics-agent3@dw.com', password: 'secret123', role: 'agent' });

    const metrics = await getMetricsForAgent(agent.id, SINCE);

    expect(metrics).toEqual({ closedCount: 0, avgResolutionMinutes: null, avgFirstResponseMinutes: null });
  });

  test('getMetricsForAllAgents returns one entry per agent with at least one closed conversation, ordered by name', async () => {
    const zeta = await createAgent({ name: 'Zeta', email: 'metrics-zeta@dw.com', password: 'secret123', role: 'agent' });
    const alpha = await createAgent({ name: 'Alpha', email: 'metrics-alpha@dw.com', password: 'secret123', role: 'agent' });
    const noConversations = await createAgent({ name: 'Semconversa', email: 'metrics-none@dw.com', password: 'secret123', role: 'agent' });
    const channelId = await seedChannel();

    await seedClosedConversation({
      channelId,
      contactId: await seedContact(),
      agentId: zeta.id,
      startedAt: new Date('2026-01-02T10:00:00Z'),
      closedAt: new Date('2026-01-02T10:30:00Z'),
      firstResponseAt: new Date('2026-01-02T10:05:00Z'),
    });
    await seedClosedConversation({
      channelId,
      contactId: await seedContact(),
      agentId: alpha.id,
      startedAt: new Date('2026-01-02T11:00:00Z'),
      closedAt: new Date('2026-01-02T11:10:00Z'),
      firstResponseAt: new Date('2026-01-02T11:02:00Z'),
    });

    const metrics = await getMetricsForAllAgents(SINCE);

    expect(metrics.map((m) => m.agentName)).toEqual(['Alpha', 'Zeta']);
    expect(metrics.find((m) => m.agentId === alpha.id).closedCount).toBe(1);
    expect(metrics.find((m) => m.agentId === zeta.id).closedCount).toBe(1);
    expect(metrics.some((m) => m.agentId === noConversations.id)).toBe(false);
  });

  test('getMetricsBySector counts a closed conversation toward every sector the closing agent belongs to', async () => {
    const agent = await createAgent({ email: 'metrics-multisector@dw.com', password: 'secret123', role: 'agent' });
    const financeiro = await createSector({ name: 'Financeiro' });
    const comercial = await createSector({ name: 'Comercial' });
    await setAgentSectors(agent.id, [financeiro.id, comercial.id]);
    const channelId = await seedChannel();

    await seedClosedConversation({
      channelId,
      contactId: await seedContact(),
      agentId: agent.id,
      startedAt: new Date('2026-01-02T10:00:00Z'),
      closedAt: new Date('2026-01-02T10:30:00Z'),
      firstResponseAt: new Date('2026-01-02T10:05:00Z'),
    });

    const metrics = await getMetricsBySector(SINCE);

    expect(metrics.map((m) => m.sectorName).sort()).toEqual(['Comercial', 'Financeiro']);
    expect(metrics.every((m) => m.closedCount === 1)).toBe(true);
  });

  test('getMetricsBySector omits an agent who belongs to no sector', async () => {
    const agent = await createAgent({ email: 'metrics-nosector@dw.com', password: 'secret123', role: 'agent' });
    const channelId = await seedChannel();

    await seedClosedConversation({
      channelId,
      contactId: await seedContact(),
      agentId: agent.id,
      startedAt: new Date('2026-01-02T10:00:00Z'),
      closedAt: new Date('2026-01-02T10:30:00Z'),
      firstResponseAt: new Date('2026-01-02T10:05:00Z'),
    });

    const metrics = await getMetricsBySector(SINCE);

    expect(metrics).toEqual([]);
  });
});
