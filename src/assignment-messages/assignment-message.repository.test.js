const { getPool, closePool } = require('../db/pool');
const { createAgent } = require('../agents/agent.repository');
const { createChannel } = require('../channels/channel.repository');
const {
  getAssignmentMessageConfig,
  upsertAssignmentMessageConfig,
  claimProtocolNumber,
  clearProtocolNumber,
  todaySaoPauloDateString,
} = require('./assignment-message.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createConversation } = require('../conversations/conversation.repository');

describe('assignment message repository', () => {
  beforeEach(async () => {
    await getPool().query(
      'TRUNCATE assignment_message_config, assignment_message_agents, assignment_message_channels, conversations, contacts, channels, agents, protocol_counters CASCADE'
    );
  });

  afterAll(async () => {
    await closePool();
  });

  test('getAssignmentMessageConfig returns the empty default when nothing is configured', async () => {
    expect(await getAssignmentMessageConfig()).toEqual({
      id: null,
      enabled: false,
      openingMessage: '',
      closingMessage: '',
      agentIds: [],
      channelIds: [],
    });
  });

  test('upsertAssignmentMessageConfig creates the row and the agent/channel selections on first save', async () => {
    const agent = await createAgent({ name: 'Geovanna Silva', email: 'geovanna@dw.com', password: 'secret123', role: 'agent' });
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });

    const config = await upsertAssignmentMessageConfig({
      enabled: true,
      openingMessage: '@chat_saudacao_maiusculo, meu nome é @chat_atendente',
      closingMessage: 'Encerrando, protocolo @chat_protocolo',
      agentIds: [agent.id],
      channelIds: [channel.id],
    });

    expect(config.enabled).toBe(true);
    expect(config.openingMessage).toBe('@chat_saudacao_maiusculo, meu nome é @chat_atendente');
    expect(config.agentIds).toEqual([agent.id]);
    expect(config.channelIds).toEqual([channel.id]);

    const fetched = await getAssignmentMessageConfig();
    expect(fetched.id).toBe(config.id);
    expect(fetched.agentIds).toEqual([agent.id]);
  });

  test('upsertAssignmentMessageConfig updates the existing row instead of creating a second one', async () => {
    await upsertAssignmentMessageConfig({
      enabled: true,
      openingMessage: 'abertura 1',
      closingMessage: 'fechamento 1',
      agentIds: [],
      channelIds: [],
    });
    const updated = await upsertAssignmentMessageConfig({
      enabled: false,
      openingMessage: 'abertura 2',
      closingMessage: 'fechamento 2',
      agentIds: [],
      channelIds: [],
    });

    expect(updated.enabled).toBe(false);
    expect(updated.openingMessage).toBe('abertura 2');

    const all = await getPool().query('SELECT id FROM assignment_message_config');
    expect(all.rowCount).toBe(1);
  });

  test('upsertAssignmentMessageConfig replaces the agent/channel selection, not appends to it', async () => {
    const agent1 = await createAgent({ email: 'a1@dw.com', password: 'secret123', role: 'agent' });
    const agent2 = await createAgent({ email: 'a2@dw.com', password: 'secret123', role: 'agent' });

    await upsertAssignmentMessageConfig({
      enabled: true,
      openingMessage: 'x',
      closingMessage: 'y',
      agentIds: [agent1.id],
      channelIds: [],
    });
    const updated = await upsertAssignmentMessageConfig({
      enabled: true,
      openingMessage: 'x',
      closingMessage: 'y',
      agentIds: [agent2.id],
      channelIds: [],
    });

    expect(updated.agentIds).toEqual([agent2.id]);
  });

  test('claimProtocolNumber generates an AAAAMMDD-XXXX protocol on the first call for a conversation', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    const conversation = await createConversation(contact.id, channel.id);

    const protocolNumber = await claimProtocolNumber(conversation.id);
    expect(protocolNumber).toMatch(/^\d{8}-\d{4,}$/);
    expect(protocolNumber.startsWith(todaySaoPauloDateString())).toBe(true);
  });

  test('claimProtocolNumber reuses the same number on a second call for the same conversation', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    const conversation = await createConversation(contact.id, channel.id);

    const first = await claimProtocolNumber(conversation.id);
    const second = await claimProtocolNumber(conversation.id);
    expect(second).toBe(first);
  });

  test('claimProtocolNumber assigns consecutive sequence numbers to different conversations claimed the same day', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const otherContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    const conversationA = await createConversation(contact.id, channel.id);
    const conversationB = await createConversation(otherContact.id, channel.id);

    const numberA = await claimProtocolNumber(conversationA.id);
    const numberB = await claimProtocolNumber(conversationB.id);

    const seqA = Number(numberA.split('-')[1]);
    const seqB = Number(numberB.split('-')[1]);
    expect(seqB).toBe(seqA + 1);
  });

  test('clearProtocolNumber resets a claimed protocol number back to null', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    const conversation = await createConversation(contact.id, channel.id);
    await claimProtocolNumber(conversation.id);

    await clearProtocolNumber(conversation.id);

    const result = await getPool().query('SELECT protocol_number FROM conversations WHERE id = $1', [conversation.id]);
    expect(result.rows[0].protocol_number).toBeNull();
  });
});

describe('todaySaoPauloDateString', () => {
  test('returns AAAAMMDD for a time comfortably inside the São Paulo day', () => {
    expect(todaySaoPauloDateString(new Date('2026-09-11T15:00:00.000Z'))).toBe('20260911');
  });

  test('uses the São Paulo day, not the UTC day, right after UTC midnight', () => {
    // 2026-09-11T02:30:00.000Z is 2026-09-10T23:30:00 in São Paulo (UTC-3, no DST).
    expect(todaySaoPauloDateString(new Date('2026-09-11T02:30:00.000Z'))).toBe('20260910');
  });
});
