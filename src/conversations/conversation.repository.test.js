const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { createAgent } = require('../agents/agent.repository');
const {
  findOpenConversation,
  createConversation,
  claimConversation,
  transferConversation,
  closeConversation,
  getConversationWithContact,
  listWaitingConversations,
  listConversationsByAgent,
} = require('./conversation.repository');

describe('conversation repository', () => {
  let contactId;
  let channelId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, agents, conversation_events CASCADE');
    const contact = await findOrCreateContactByPhoneNumber('+5511977776666', 'Joao');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste',
      phoneNumber: '+5511999990009',
      config: { phoneNumberId: '111', accessToken: 'tok' },
    });
    contactId = contact.id;
    channelId = channel.id;
  });

  afterAll(async () => {
    await closePool();
  });

  test('findOpenConversation returns null when none exists', async () => {
    const conversation = await findOpenConversation(contactId, channelId);
    expect(conversation).toBeNull();
  });

  test('createConversation starts a conversation in waiting status', async () => {
    const conversation = await createConversation(contactId, channelId);
    expect(conversation.status).toBe('waiting');
    expect(conversation.assignedAgentId).toBeNull();
  });

  test('findOpenConversation finds the created conversation', async () => {
    const created = await createConversation(contactId, channelId);
    const found = await findOpenConversation(contactId, channelId);
    expect(found.id).toBe(created.id);
  });

  test('claimConversation assigns an unassigned conversation atomically', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent1@dw.com', password: 'secret123', role: 'agent' });
    const claimed = await claimConversation(conversation.id, agent.id);
    expect(claimed.status).toBe('assigned');
    expect(claimed.assignedAgentId).toBe(agent.id);
  });

  test('claimConversation returns null when already assigned', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent1 = await createAgent({ email: 'agent2@dw.com', password: 'secret123', role: 'agent' });
    const agent2 = await createAgent({ email: 'agent3@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent1.id);
    const secondClaim = await claimConversation(conversation.id, agent2.id);
    expect(secondClaim).toBeNull();
  });

  test('transferConversation moves the conversation to another agent', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent1 = await createAgent({ email: 'agent4@dw.com', password: 'secret123', role: 'agent' });
    const agent2 = await createAgent({ email: 'agent5@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent1.id);
    const transferred = await transferConversation(conversation.id, agent1.id, agent2.id);
    expect(transferred.assignedAgentId).toBe(agent2.id);
  });

  test('claimConversation returns null for a closed conversation', async () => {
    const conversation = await createConversation(contactId, channelId);
    await closeConversation(conversation.id);
    const agent = await createAgent({ email: 'agent6@dw.com', password: 'secret123', role: 'agent' });
    const claimed = await claimConversation(conversation.id, agent.id);
    expect(claimed).toBeNull();
  });

  test('transferConversation returns null for a closed conversation even if assigned_agent_id still matches fromAgentId', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent1 = await createAgent({ email: 'agent7@dw.com', password: 'secret123', role: 'agent' });
    const agent2 = await createAgent({ email: 'agent8@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent1.id);
    await closeConversation(conversation.id);
    const transferred = await transferConversation(conversation.id, agent1.id, agent2.id);
    expect(transferred).toBeNull();
  });

  test('closeConversation marks the conversation closed', async () => {
    const conversation = await createConversation(contactId, channelId);
    const closed = await closeConversation(conversation.id);
    expect(closed.status).toBe('closed');
  });

  test('getConversationWithContact includes the contact phone number', async () => {
    const conversation = await createConversation(contactId, channelId);
    const result = await getConversationWithContact(conversation.id);
    expect(result.id).toBe(conversation.id);
    expect(result.contactPhoneNumber).toBe('+5511977776666');
  });

  test('listWaitingConversations returns only waiting conversations with contact info, oldest first', async () => {
    const otherContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
    const waitingConversation = await createConversation(contactId, channelId);
    const assignedConversation = await createConversation(otherContact.id, channelId);
    const agent = await createAgent({ email: 'listagent1@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(assignedConversation.id, agent.id);

    const waiting = await listWaitingConversations();

    expect(waiting.map((c) => c.id)).toEqual([waitingConversation.id]);
    expect(waiting[0].contactPhoneNumber).toBe('+5511977776666');
    expect(waiting[0].contactDisplayName).toBe('Joao');
  });

  test('listConversationsByAgent returns only that agent non-closed conversations', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'listagent2@dw.com', password: 'secret123', role: 'agent' });
    const otherAgent = await createAgent({ email: 'listagent3@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);
    const otherContact = await findOrCreateContactByPhoneNumber('+5511911119999', 'Outra Pessoa');
    const otherConversation = await createConversation(otherContact.id, channelId);
    await claimConversation(otherConversation.id, otherAgent.id);

    const mine = await listConversationsByAgent(agent.id);

    expect(mine.map((c) => c.id)).toEqual([conversation.id]);
  });
});
