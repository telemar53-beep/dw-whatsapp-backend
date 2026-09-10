const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber, setContactAvatarPath, updateContact } = require('./contact.repository');
const { createAgent } = require('../agents/agent.repository');
const { createSector } = require('../sectors/sector.repository');
const { createCity } = require('../cities/city.repository');
const { createMessage } = require('./message.repository');
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
  activateConversation,
  listInProgressConversations,
  listWaitingForAgentConversations,
  listInAutomationConversations,
  countClosedSince,
  listClosedSince,
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

  test('transferConversation assigns a waiting conversation directly to an agent, without requiring it to be claimed first', async () => {
    const conversation = await createConversation(contactId, channelId);
    const callingAgent = await createAgent({ email: 'agent7b@dw.com', password: 'secret123', role: 'agent' });
    const targetAgent = await createAgent({ email: 'agent7c@dw.com', password: 'secret123', role: 'agent' });
    const transferred = await transferConversation(conversation.id, callingAgent.id, targetAgent.id);
    expect(transferred.status).toBe('assigned');
    expect(transferred.assignedAgentId).toBe(targetAgent.id);
    expect(transferred.triageState).toBe('completed');
  });

  test('transferConversation returns null when the conversation is already assigned to someone else', async () => {
    const conversation = await createConversation(contactId, channelId);
    const assignedAgent = await createAgent({ email: 'agent7d@dw.com', password: 'secret123', role: 'agent' });
    const otherAgent = await createAgent({ email: 'agent7e@dw.com', password: 'secret123', role: 'agent' });
    const targetAgent = await createAgent({ email: 'agent7f@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, assignedAgent.id);
    const transferred = await transferConversation(conversation.id, otherAgent.id, targetAgent.id);
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

  test('closeConversation closes a conversation that was never claimed (still waiting in the queue)', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent9d@dw.com', password: 'secret123', role: 'agent' });
    const closed = await closeConversation(conversation.id, agent.id);
    expect(closed.status).toBe('closed');
    expect(closed.assignedAgentId).toBeNull();
  });

  test('claimConversation returns protocolNumber as null before any protocol has been claimed', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent-protocol@dw.com', password: 'secret123', role: 'agent' });
    const claimed = await claimConversation(conversation.id, agent.id);
    expect(claimed.protocolNumber).toBeNull();
  });

  test('closeConversation returns the protocol_number set for the conversation, if any', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent-protocol-2@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);
    await getPool().query('UPDATE conversations SET protocol_number = 42 WHERE id = $1', [conversation.id]);

    const closed = await closeConversation(conversation.id, agent.id);
    expect(closed.protocolNumber).toBe(42);
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

  test('getConversationWithContact includes the most recent message preview and time', async () => {
    const conversation = await createConversation(contactId, channelId);
    await createMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      content: 'Primeira mensagem',
      whatsappMessageId: 'wamid.preview1',
      status: 'received',
    });
    await createMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      content: 'Segunda mensagem',
      whatsappMessageId: 'wamid.preview2',
      status: 'received',
    });

    const result = await getConversationWithContact(conversation.id);

    expect(result.lastMessageContent).toBe('Segunda mensagem');
    expect(result.lastMessageType).toBe('text');
    expect(result.lastMessageAt).toBeDefined();
  });

  test('getConversationWithContact has null last-message fields when the conversation has no messages yet', async () => {
    const conversation = await createConversation(contactId, channelId);

    const result = await getConversationWithContact(conversation.id);

    expect(result.lastMessageContent).toBeNull();
    expect(result.lastMessageType).toBeNull();
    expect(result.lastMessageAt).toBeNull();
    expect(result.lastMessageStatus).toBeNull();
    expect(result.lastMessageDirection).toBeNull();
  });

  test('getConversationWithContact includes the last message status and direction', async () => {
    const conversation = await createConversation(contactId, channelId);
    await createMessage({
      conversationId: conversation.id,
      direction: 'outbound',
      content: 'Como posso ajudar?',
      status: 'delivered',
    });

    const result = await getConversationWithContact(conversation.id);

    expect(result.lastMessageStatus).toBe('delivered');
    expect(result.lastMessageDirection).toBe('outbound');
  });

  test('getConversationWithContact surfaces the message type when a media message has no caption', async () => {
    const conversation = await createConversation(contactId, channelId);
    await createMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      content: null,
      whatsappMessageId: 'wamid.preview3',
      status: 'received',
      messageType: 'image',
      mediaPath: 'foo.jpg',
      mediaMimeType: 'image/jpeg',
    });

    const result = await getConversationWithContact(conversation.id);

    expect(result.lastMessageContent).toBeNull();
    expect(result.lastMessageType).toBe('image');
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

  test('listWaitingConversations includes the last message preview and time', async () => {
    const conversation = await createConversation(contactId, channelId);
    await createMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      content: 'Oi, tudo bem?',
      whatsappMessageId: 'wamid.preview4',
      status: 'received',
    });

    const waiting = await listWaitingConversations();

    expect(waiting[0].lastMessageContent).toBe('Oi, tudo bem?');
    expect(waiting[0].lastMessageType).toBe('text');
    expect(waiting[0].lastMessageAt).toBeDefined();
    expect(waiting[0].lastMessageStatus).toBe('received');
    expect(waiting[0].lastMessageDirection).toBe('inbound');
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

  test('listConversationsByAgent includes the last message preview and time', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'listagent6@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);
    await createMessage({
      conversationId: conversation.id,
      direction: 'outbound',
      content: 'Como posso ajudar?',
      status: 'sent',
    });

    const mine = await listConversationsByAgent(agent.id);

    expect(mine[0].lastMessageContent).toBe('Como posso ajudar?');
    expect(mine[0].lastMessageType).toBe('text');
    expect(mine[0].lastMessageStatus).toBe('sent');
    expect(mine[0].lastMessageDirection).toBe('outbound');
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

  test('createConversation accepts an explicit status', async () => {
    const conversation = await createConversation(contactId, channelId, null, 'silent');
    expect(conversation.status).toBe('silent');
  });

  test('activateConversation flips a silent conversation to waiting', async () => {
    const created = await createConversation(contactId, channelId, null, 'silent');
    const activated = await activateConversation(created.id);
    expect(activated.status).toBe('waiting');
    const found = await findOpenConversation(contactId, channelId);
    expect(found.status).toBe('waiting');
  });

  test('activateConversation returns null for a conversation that is not silent', async () => {
    const created = await createConversation(contactId, channelId);
    const result = await activateConversation(created.id);
    expect(result).toBeNull();
  });

  test('activateConversation returns null for a non-existent conversation id', async () => {
    const result = await activateConversation('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  test('listWaitingConversations does not return silent conversations', async () => {
    await createConversation(contactId, channelId, null, 'silent');

    const waiting = await listWaitingConversations();

    expect(waiting).toEqual([]);
  });

  test('findOpenConversation finds a silent conversation', async () => {
    const created = await createConversation(contactId, channelId, null, 'silent');

    const found = await findOpenConversation(contactId, channelId);

    expect(found.id).toBe(created.id);
    expect(found.status).toBe('silent');
  });

  test('listInProgressConversations returns only assigned conversations, most recently updated first', async () => {
    const otherContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
    const waitingConversation = await createConversation(otherContact.id, channelId);
    const assignedConversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'dash1@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(assignedConversation.id, agent.id);

    const result = await listInProgressConversations();

    expect(result.map((c) => c.id)).toEqual([assignedConversation.id]);
    expect(result[0].contactPhoneNumber).toBe('+5511977776666');
    void waitingConversation;
  });

  test('listWaitingForAgentConversations returns waiting conversations whose triage is not pending', async () => {
    const waiting = await createConversation(contactId, channelId);
    const inTriageContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
    const inTriage = await createConversation(inTriageContact.id, channelId, 'pending');
    const assignedContact = await findOrCreateContactByPhoneNumber('+5511977774444', 'Terceira Pessoa');
    const agent = await createAgent({ email: 'dash2@dw.com', password: 'secret123', role: 'agent' });
    const assigned = await createConversation(assignedContact.id, channelId);
    await claimConversation(assigned.id, agent.id);

    const result = await listWaitingForAgentConversations();

    expect(result.map((c) => c.id)).toEqual([waiting.id]);
    void inTriage;
  });

  test('listInAutomationConversations returns only conversations with triage pending', async () => {
    const inTriage = await createConversation(contactId, channelId, 'pending');
    const otherContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
    const waiting = await createConversation(otherContact.id, channelId);

    const result = await listInAutomationConversations();

    expect(result.map((c) => c.id)).toEqual([inTriage.id]);
    void waiting;
  });

  test('listInAutomationConversations excludes a conversation that was closed while triage was still pending', async () => {
    const inTriage = await createConversation(contactId, channelId, 'pending');
    const otherContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
    const closedWhilePending = await createConversation(otherContact.id, channelId, 'pending');
    const agent = await createAgent({ email: 'dash5@dw.com', password: 'secret123', role: 'agent' });
    await closeConversation(closedWhilePending.id, agent.id);

    const result = await listInAutomationConversations();

    expect(result.map((c) => c.id)).toEqual([inTriage.id]);
  });

  test('countClosedSince counts only conversations closed at or after the given time', async () => {
    const agent = await createAgent({ email: 'dash3@dw.com', password: 'secret123', role: 'agent' });
    const oldEnough = await createConversation(contactId, channelId);
    await claimConversation(oldEnough.id, agent.id);
    await closeConversation(oldEnough.id, agent.id);

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const count = await countClosedSince(since);

    expect(count).toBe(1);

    const future = new Date(Date.now() + 60 * 60 * 1000);
    expect(await countClosedSince(future)).toBe(0);
  });

  test('listClosedSince returns closed conversations most recently closed first, with closedAt and pagination', async () => {
    const agent = await createAgent({ email: 'dash4@dw.com', password: 'secret123', role: 'agent' });
    const first = await createConversation(contactId, channelId);
    await claimConversation(first.id, agent.id);
    await closeConversation(first.id, agent.id);
    const second = await createConversation(contactId, channelId);
    await claimConversation(second.id, agent.id);
    await closeConversation(second.id, agent.id);

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const page1 = await listClosedSince(since, { limit: 1, offset: 0 });
    const page2 = await listClosedSince(since, { limit: 1, offset: 1 });

    expect(page1.map((c) => c.id)).toEqual([second.id]);
    expect(page1[0].closedAt).toBeDefined();
    expect(page2.map((c) => c.id)).toEqual([first.id]);
  });
});
