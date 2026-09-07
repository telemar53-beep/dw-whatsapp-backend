const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber, setContactAvatarPath, updateContact } = require('./contact.repository');
const { createAgent } = require('../agents/agent.repository');
const { createSector } = require('../sectors/sector.repository');
const { createCity } = require('../cities/city.repository');
const {
  findOpenConversation,
  createConversation,
  claimConversation,
  transferConversation,
  closeConversation,
  getConversationWithContact,
  listWaitingConversations,
  listConversationsByAgent,
  listClosedConversationsByContact,
  completeTriage,
  incrementTriageAttempts,
} = require('./conversation.repository');

describe('conversation repository', () => {
  let contactId;
  let channelId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, agents, conversation_events, sectors, cities CASCADE');
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
    const closingAgent = await createAgent({ email: 'agent6@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, closingAgent.id);
    await closeConversation(conversation.id, closingAgent.id);
    const agent = await createAgent({ email: 'agent6b@dw.com', password: 'secret123', role: 'agent' });
    const claimed = await claimConversation(conversation.id, agent.id);
    expect(claimed).toBeNull();
  });

  test('transferConversation returns null for a closed conversation even if assigned_agent_id still matches fromAgentId', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent1 = await createAgent({ email: 'agent7@dw.com', password: 'secret123', role: 'agent' });
    const agent2 = await createAgent({ email: 'agent8@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent1.id);
    await closeConversation(conversation.id, agent1.id);
    const transferred = await transferConversation(conversation.id, agent1.id, agent2.id);
    expect(transferred).toBeNull();
  });

  test('closeConversation marks the conversation closed and records who closed it', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent9@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);
    const closed = await closeConversation(conversation.id, agent.id);
    expect(closed.status).toBe('closed');

    const events = await getPool().query(
      `SELECT event_type, from_agent_id FROM conversation_events WHERE conversation_id = $1 AND event_type = 'closed'`,
      [conversation.id]
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].from_agent_id).toBe(agent.id);
  });

  test('closeConversation returns null when called by an agent other than the assigned one', async () => {
    const conversation = await createConversation(contactId, channelId);
    const assignedAgent = await createAgent({ email: 'agent9b@dw.com', password: 'secret123', role: 'agent' });
    const otherAgent = await createAgent({ email: 'agent9c@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, assignedAgent.id);
    const closed = await closeConversation(conversation.id, otherAgent.id);
    expect(closed).toBeNull();
  });

  test('closeConversation returns null for a conversation that was never claimed', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent9d@dw.com', password: 'secret123', role: 'agent' });
    const closed = await closeConversation(conversation.id, agent.id);
    expect(closed).toBeNull();
  });

  test('getConversationWithContact includes the contact phone number and display name', async () => {
    const conversation = await createConversation(contactId, channelId);
    const result = await getConversationWithContact(conversation.id);
    expect(result.id).toBe(conversation.id);
    expect(result.contactPhoneNumber).toBe('+5511977776666');
    expect(result.contactDisplayName).toBe('Joao');
  });

  test('getConversationWithContact includes the contact avatar path', async () => {
    await setContactAvatarPath(contactId, 'avatars/joao.jpg');
    const conversation = await createConversation(contactId, channelId);
    const result = await getConversationWithContact(conversation.id);
    expect(result.contactAvatarPath).toBe('avatars/joao.jpg');
  });

  test('getConversationWithContact has a null contactAvatarPath when the contact has no photo', async () => {
    const conversation = await createConversation(contactId, channelId);
    const result = await getConversationWithContact(conversation.id);
    expect(result.contactAvatarPath).toBeNull();
  });

  test('getConversationWithContact includes the contact city', async () => {
    const city = await createCity({ name: 'Bahia' });
    await updateContact(contactId, { displayName: 'Joao', cityId: city.id });
    const conversation = await createConversation(contactId, channelId);

    const result = await getConversationWithContact(conversation.id);

    expect(result.contactCityId).toBe(city.id);
    expect(result.contactCityName).toBe('Bahia');
  });

  test('getConversationWithContact has null contactCityId/contactCityName when the contact has no city', async () => {
    const conversation = await createConversation(contactId, channelId);

    const result = await getConversationWithContact(conversation.id);

    expect(result.contactCityId).toBeNull();
    expect(result.contactCityName).toBeNull();
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

  test('listWaitingConversations includes the contact avatar path', async () => {
    await setContactAvatarPath(contactId, 'avatars/joao.jpg');
    await createConversation(contactId, channelId);

    const waiting = await listWaitingConversations();

    expect(waiting[0].contactAvatarPath).toBe('avatars/joao.jpg');
  });

  test('listWaitingConversations includes the contact city', async () => {
    const city = await createCity({ name: 'Bahia' });
    await updateContact(contactId, { displayName: 'Joao', cityId: city.id });
    await createConversation(contactId, channelId);

    const waiting = await listWaitingConversations();

    expect(waiting[0].contactCityId).toBe(city.id);
    expect(waiting[0].contactCityName).toBe('Bahia');
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

  test('listConversationsByAgent includes the contact avatar path', async () => {
    await setContactAvatarPath(contactId, 'avatars/joao.jpg');
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'listagent4@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);

    const mine = await listConversationsByAgent(agent.id);

    expect(mine[0].contactAvatarPath).toBe('avatars/joao.jpg');
  });

  test('listConversationsByAgent includes the contact city', async () => {
    const city = await createCity({ name: 'Bahia' });
    await updateContact(contactId, { displayName: 'Joao', cityId: city.id });
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'listagent5@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);

    const mine = await listConversationsByAgent(agent.id);

    expect(mine[0].contactCityId).toBe(city.id);
    expect(mine[0].contactCityName).toBe('Bahia');
  });

  test('listClosedConversationsByContact returns only closed conversations, most recent first', async () => {
    const agent = await createAgent({ email: 'histagent1@dw.com', password: 'secret123', role: 'agent' });
    const older = await createConversation(contactId, channelId);
    await claimConversation(older.id, agent.id);
    await closeConversation(older.id, agent.id);

    const stillOpen = await createConversation(contactId, channelId);
    await claimConversation(stillOpen.id, agent.id);

    const otherContact = await findOrCreateContactByPhoneNumber('+5511900001111', 'Outro Cliente');
    const otherContactConversation = await createConversation(otherContact.id, channelId);
    await claimConversation(otherContactConversation.id, agent.id);
    await closeConversation(otherContactConversation.id, agent.id);

    const secondChannel = await createChannel({
      type: 'baileys',
      name: 'Canal Baileys Teste',
      phoneNumber: '+5511999991234',
      config: {},
    });
    const newer = await createConversation(contactId, secondChannel.id);
    await claimConversation(newer.id, agent.id);
    await closeConversation(newer.id, agent.id);

    const history = await listClosedConversationsByContact(contactId);

    expect(history.map((c) => c.id)).toEqual([newer.id, older.id]);
    expect(history[0].channelName).toBe('Canal Baileys Teste');
    expect(history[0].channelType).toBe('baileys');
    expect(history[1].channelName).toBe('Canal Teste');
  });

  test('createConversation defaults triageState to null when not provided', async () => {
    const conversation = await createConversation(contactId, channelId);
    expect(conversation.triageState).toBeNull();
    expect(conversation.triageAttempts).toBe(0);
    expect(conversation.sectorId).toBeNull();
  });

  test('createConversation stores a provided triageState', async () => {
    const conversation = await createConversation(contactId, channelId, 'pending');
    expect(conversation.triageState).toBe('pending');
  });

  test('claimConversation completes any pending triage as part of the claim', async () => {
    const conversation = await createConversation(contactId, channelId, 'pending');
    const agent = await createAgent({ email: 'triageagent@dw.com', password: 'secret123', role: 'agent' });

    const claimed = await claimConversation(conversation.id, agent.id);

    expect(claimed.triageState).toBe('completed');
  });

  test('completeTriage sets the sector and marks triage completed', async () => {
    const sector = await createSector({ name: 'Financeiro' });
    const conversation = await createConversation(contactId, channelId, 'pending');

    const updated = await completeTriage(conversation.id, sector.id);

    expect(updated.sectorId).toBe(sector.id);
    expect(updated.triageState).toBe('completed');
  });

  test('completeTriage accepts a null sectorId for the fallback-to-general-queue case', async () => {
    const conversation = await createConversation(contactId, channelId, 'pending');

    const updated = await completeTriage(conversation.id, null);

    expect(updated.sectorId).toBeNull();
    expect(updated.triageState).toBe('completed');
  });

  test('incrementTriageAttempts increases the counter and returns the new value', async () => {
    const conversation = await createConversation(contactId, channelId, 'pending');

    const first = await incrementTriageAttempts(conversation.id);
    const second = await incrementTriageAttempts(conversation.id);

    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  test('getConversationWithContact includes the sector name when a sector is set', async () => {
    const sector = await createSector({ name: 'Suporte' });
    const conversation = await createConversation(contactId, channelId, 'pending');
    await completeTriage(conversation.id, sector.id);

    const result = await getConversationWithContact(conversation.id);

    expect(result.sectorId).toBe(sector.id);
    expect(result.sectorName).toBe('Suporte');
  });

  test('getConversationWithContact has a null sectorName when no sector is set', async () => {
    const conversation = await createConversation(contactId, channelId);

    const result = await getConversationWithContact(conversation.id);

    expect(result.sectorId).toBeNull();
    expect(result.sectorName).toBeNull();
  });

  test('listWaitingConversations includes the sector name for a triaged conversation', async () => {
    const sector = await createSector({ name: 'Comercial' });
    const conversation = await createConversation(contactId, channelId, 'pending');
    await completeTriage(conversation.id, sector.id);

    const waiting = await listWaitingConversations();

    expect(waiting[0].sectorId).toBe(sector.id);
    expect(waiting[0].sectorName).toBe('Comercial');
  });

  test('completeTriage does not affect a conversation whose triage is not pending', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511999990000', 'Cliente Sem Triagem 1');
    const channel = await createChannel({ name: 'Canal', type: 'baileys', phoneNumber: '+5511999998888', config: {} });
    const sector = await createSector({ name: 'Financeiro' });
    const conversation = await createConversation(contact.id, channel.id, null);

    const result = await completeTriage(conversation.id, sector.id);

    expect(result).toBeNull();
  });

  test('incrementTriageAttempts does not affect a conversation whose triage is not pending', async () => {
    const contact = await findOrCreateContactByPhoneNumber('+5511999990001', 'Cliente Sem Triagem 2');
    const channel = await createChannel({ name: 'Canal 2', type: 'baileys', phoneNumber: '+5511999998889', config: {} });
    const conversation = await createConversation(contact.id, channel.id, null);

    const result = await incrementTriageAttempts(conversation.id);

    expect(result).toBe(0);
  });
});
