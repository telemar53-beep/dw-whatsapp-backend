const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const {
  findOrCreateContactByPhoneNumber,
  setContactAvatarPath,
  updateContact,
  setContactSgpLink,
} = require('./contact.repository');
const { createAgent } = require('../agents/agent.repository');
const { createReason } = require('../reasons/reason.repository');
const { createSector } = require('../sectors/sector.repository');
const { createCity } = require('../cities/city.repository');
const { createMessage } = require('./message.repository');
const {
  findOpenConversation,
  createConversation,
  claimConversation,
  transferConversation,
  closeConversation,
  adminTransferConversation,
  adminCloseConversation,
  getConversationWithContact,
  findConversationByProtocolNumber,
  listConversationsByContact,
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
  countClosedConversationsByAgent,
  listClosedConversationsByAgent,
  markBusinessHoursNoticeSent,
  setSuggestedReason,
  setConversationSector,
  concludeAiTriage,
  markTriageResolvedByAi,
  closeConversationByAi,
  findRecentAiClosedConversation,
  markPhoneContested,
  isPhoneContested,
  setThirdPartyScope,
  getThirdPartyScope,
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

  test('closeConversation records the reason_id when one is passed', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent9e@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);
    const reasonResult = await getPool().query(
      `INSERT INTO contact_reasons (name) VALUES ('Troca de senha') RETURNING id`
    );
    const reasonId = reasonResult.rows[0].id;

    await closeConversation(conversation.id, agent.id, reasonId);

    const events = await getPool().query(
      `SELECT reason_id FROM conversation_events WHERE conversation_id = $1 AND event_type = 'closed'`,
      [conversation.id]
    );
    expect(events.rows[0].reason_id).toBe(reasonId);
  });

  test('closeConversation leaves reason_id null when none is passed', async () => {
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'agent9f@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);

    await closeConversation(conversation.id, agent.id);

    const events = await getPool().query(
      `SELECT reason_id FROM conversation_events WHERE conversation_id = $1 AND event_type = 'closed'`,
      [conversation.id]
    );
    expect(events.rows[0].reason_id).toBeNull();
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

  test('adminTransferConversation moves the conversation even when called by someone other than the assigned agent', async () => {
    const conversation = await createConversation(contactId, channelId);
    const assignedAgent = await createAgent({ email: 'agent-admin-xfer-1@dw.com', password: 'secret123', role: 'agent' });
    const targetAgent = await createAgent({ email: 'agent-admin-xfer-2@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, assignedAgent.id);

    const transferred = await adminTransferConversation(conversation.id, targetAgent.id);

    expect(transferred.assignedAgentId).toBe(targetAgent.id);
  });

  test('adminTransferConversation records the previously assigned agent as from_agent_id', async () => {
    const conversation = await createConversation(contactId, channelId);
    const assignedAgent = await createAgent({ email: 'agent-admin-xfer-3@dw.com', password: 'secret123', role: 'agent' });
    const targetAgent = await createAgent({ email: 'agent-admin-xfer-4@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, assignedAgent.id);

    await adminTransferConversation(conversation.id, targetAgent.id);

    const events = await getPool().query(
      `SELECT from_agent_id, to_agent_id FROM conversation_events WHERE conversation_id = $1 AND event_type = 'transferred'`,
      [conversation.id]
    );
    expect(events.rows[0].from_agent_id).toBe(assignedAgent.id);
    expect(events.rows[0].to_agent_id).toBe(targetAgent.id);
  });

  test('adminTransferConversation assigns an unclaimed waiting conversation directly', async () => {
    const conversation = await createConversation(contactId, channelId);
    const targetAgent = await createAgent({ email: 'agent-admin-xfer-5@dw.com', password: 'secret123', role: 'agent' });

    const transferred = await adminTransferConversation(conversation.id, targetAgent.id);

    expect(transferred.assignedAgentId).toBe(targetAgent.id);
  });

  test('adminTransferConversation returns null for a closed conversation', async () => {
    const conversation = await createConversation(contactId, channelId);
    const assignedAgent = await createAgent({ email: 'agent-admin-xfer-6@dw.com', password: 'secret123', role: 'agent' });
    const targetAgent = await createAgent({ email: 'agent-admin-xfer-7@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, assignedAgent.id);
    await closeConversation(conversation.id, assignedAgent.id);

    const transferred = await adminTransferConversation(conversation.id, targetAgent.id);

    expect(transferred).toBeNull();
  });

  test('adminCloseConversation closes the conversation even when called by an admin who never claimed it', async () => {
    const conversation = await createConversation(contactId, channelId);
    const assignedAgent = await createAgent({ email: 'agent-admin-close-1@dw.com', password: 'secret123', role: 'agent' });
    const admin = await createAgent({ email: 'admin-close-1@dw.com', password: 'secret123', role: 'admin' });
    await claimConversation(conversation.id, assignedAgent.id);

    const closed = await adminCloseConversation(conversation.id, admin.id, null);

    expect(closed.status).toBe('closed');
  });

  test('adminCloseConversation records the admin as from_agent_id, not the originally assigned agent', async () => {
    const conversation = await createConversation(contactId, channelId);
    const assignedAgent = await createAgent({ email: 'agent-admin-close-2@dw.com', password: 'secret123', role: 'agent' });
    const admin = await createAgent({ email: 'admin-close-2@dw.com', password: 'secret123', role: 'admin' });
    await claimConversation(conversation.id, assignedAgent.id);

    await adminCloseConversation(conversation.id, admin.id, null);

    const events = await getPool().query(
      `SELECT from_agent_id FROM conversation_events WHERE conversation_id = $1 AND event_type = 'closed'`,
      [conversation.id]
    );
    expect(events.rows[0].from_agent_id).toBe(admin.id);
  });

  test('adminCloseConversation records the reason_id when one is passed', async () => {
    const conversation = await createConversation(contactId, channelId);
    const admin = await createAgent({ email: 'admin-close-3@dw.com', password: 'secret123', role: 'admin' });
    const reasonResult = await getPool().query(`INSERT INTO contact_reasons (name) VALUES ('Atendente ausente') RETURNING id`);
    const reasonId = reasonResult.rows[0].id;

    await adminCloseConversation(conversation.id, admin.id, reasonId);

    const events = await getPool().query(
      `SELECT reason_id FROM conversation_events WHERE conversation_id = $1 AND event_type = 'closed'`,
      [conversation.id]
    );
    expect(events.rows[0].reason_id).toBe(reasonId);
  });

  test('adminCloseConversation returns null for an already closed conversation', async () => {
    const conversation = await createConversation(contactId, channelId);
    const assignedAgent = await createAgent({ email: 'agent-admin-close-4@dw.com', password: 'secret123', role: 'agent' });
    const admin = await createAgent({ email: 'admin-close-4@dw.com', password: 'secret123', role: 'admin' });
    await claimConversation(conversation.id, assignedAgent.id);
    await closeConversation(conversation.id, assignedAgent.id);

    const closed = await adminCloseConversation(conversation.id, admin.id, null);

    expect(closed).toBeNull();
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
    await getPool().query("UPDATE conversations SET protocol_number = '42' WHERE id = $1", [conversation.id]);

    const closed = await closeConversation(conversation.id, agent.id);
    expect(closed.protocolNumber).toBe('42');
  });

  test('getConversationWithContact includes the contact phone number and display name', async () => {
    const conversation = await createConversation(contactId, channelId);
    const result = await getConversationWithContact(conversation.id);
    expect(result.id).toBe(conversation.id);
    expect(result.contactPhoneNumber).toBe('+5511977776666');
    expect(result.contactDisplayName).toBe('Joao');
  });

  test('getConversationWithContact includes the protocol number when one has been claimed', async () => {
    const conversation = await createConversation(contactId, channelId);
    await getPool().query("UPDATE conversations SET protocol_number = '1042' WHERE id = $1", [conversation.id]);

    const result = await getConversationWithContact(conversation.id);

    expect(result.protocolNumber).toBe('1042');
  });

  test('getConversationWithContact has a null protocolNumber before one is claimed', async () => {
    const conversation = await createConversation(contactId, channelId);
    const result = await getConversationWithContact(conversation.id);
    expect(result.protocolNumber).toBeNull();
  });

  test('findConversationByProtocolNumber finds the conversation with that protocol number', async () => {
    const conversation = await createConversation(contactId, channelId);
    await getPool().query("UPDATE conversations SET protocol_number = '1042' WHERE id = $1", [conversation.id]);

    const result = await findConversationByProtocolNumber('1042');

    expect(result.id).toBe(conversation.id);
    expect(result.contactPhoneNumber).toBe('+5511977776666');
  });

  test('findConversationByProtocolNumber returns null when no conversation has that protocol number', async () => {
    const result = await findConversationByProtocolNumber(999999);
    expect(result).toBeNull();
  });

  test('listConversationsByContact returns every conversation for that contact regardless of status, most recent first', async () => {
    const agent = await createAgent({ email: 'by-contact-1@dw.com', password: 'secret123', role: 'agent' });
    const first = await createConversation(contactId, channelId);
    await claimConversation(first.id, agent.id);
    await closeConversation(first.id, agent.id);
    const second = await createConversation(contactId, channelId);

    const result = await listConversationsByContact(contactId);

    expect(result.map((c) => c.id)).toEqual([second.id, first.id]);
    expect(result.find((c) => c.id === first.id).status).toBe('closed');
    expect(result.find((c) => c.id === second.id).status).toBe('waiting');
  });

  test('listConversationsByContact excludes conversations belonging to a different contact', async () => {
    const mine = await createConversation(contactId, channelId);
    const otherContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
    await createConversation(otherContact.id, channelId);

    const result = await listConversationsByContact(contactId);

    expect(result.map((c) => c.id)).toEqual([mine.id]);
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

  test('getConversationWithContact includes the contact internal note', async () => {
    await updateContact(contactId, { displayName: 'Joao', cityId: null, internalNote: 'Já reclamou 3x' });
    const conversation = await createConversation(contactId, channelId);

    const result = await getConversationWithContact(conversation.id);

    expect(result.contactInternalNote).toBe('Já reclamou 3x');
  });

  test('getConversationWithContact has a null contactInternalNote when the contact has no note', async () => {
    const conversation = await createConversation(contactId, channelId);

    const result = await getConversationWithContact(conversation.id);

    expect(result.contactInternalNote).toBeNull();
  });

  test('getConversationWithContact includes the contact sgp document', async () => {
    await setContactSgpLink(contactId, { sgpClientId: 9, sgpContractId: 17402, sgpDocument: '11122233344' });
    const conversation = await createConversation(contactId, channelId);

    const result = await getConversationWithContact(conversation.id);

    expect(result.contactSgpDocument).toBe('11122233344');
  });

  test('getConversationWithContact has a null contactSgpDocument when the contact has no sgp link', async () => {
    const conversation = await createConversation(contactId, channelId);

    const result = await getConversationWithContact(conversation.id);

    expect(result.contactSgpDocument).toBeNull();
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

  test('getConversationWithContact carries the reason the AI suggested', async () => {
    const conversation = await createConversation(contactId, channelId);
    const reason = await getPool().query("INSERT INTO contact_reasons (name) VALUES ('Lentidão') RETURNING id");
    await setSuggestedReason(conversation.id, reason.rows[0].id);

    const result = await getConversationWithContact(conversation.id);

    expect(result.suggestedReasonId).toBe(reason.rows[0].id);
  });

  test('getConversationWithContact has a null suggestedReasonId when the AI has not classified this conversation', async () => {
    const conversation = await createConversation(contactId, channelId);

    const result = await getConversationWithContact(conversation.id);

    expect(result.suggestedReasonId).toBeNull();
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

  // A fila e FIFO: quem esta esperando ha mais tempo fica em cima. O teste
  // acima diz "oldest first" no nome mas cria uma conversa so, entao nao
  // provava ordem nenhuma — trocar ASC por DESC passava despercebido.
  test('listWaitingConversations devolve a fila por ordem de chegada, mais antigo primeiro', async () => {
    const maira = await findOrCreateContactByPhoneNumber('+5511977771111', 'Maira');
    const berg = await findOrCreateContactByPhoneNumber('+5511977772222', 'Berg');

    const joao = await createConversation(contactId, channelId);
    const daMaira = await createConversation(maira.id, channelId);
    const doBerg = await createConversation(berg.id, channelId);

    const fila = await listWaitingConversations();

    expect(fila.map((c) => c.id)).toEqual([joao.id, daMaira.id, doBerg.id]);
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

  test('listConversationsByAgent includes the contact sgp document', async () => {
    await setContactSgpLink(contactId, { sgpClientId: 9, sgpContractId: 17402, sgpDocument: '11122233344' });
    const conversation = await createConversation(contactId, channelId);
    const agent = await createAgent({ email: 'listagent5b@dw.com', password: 'secret123', role: 'agent' });
    await claimConversation(conversation.id, agent.id);

    const mine = await listConversationsByAgent(agent.id);

    expect(mine[0].contactSgpDocument).toBe('11122233344');
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

  test('countClosedConversationsByAgent counts only that agent\'s closed conversations', async () => {
    const agent = await createAgent({ email: 'my-closed-1@dw.com', password: 'secret123', role: 'agent' });
    const otherAgent = await createAgent({ email: 'my-closed-2@dw.com', password: 'secret123', role: 'agent' });
    const mine = await createConversation(contactId, channelId);
    await claimConversation(mine.id, agent.id);
    await closeConversation(mine.id, agent.id);
    const otherContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
    const theirs = await createConversation(otherContact.id, channelId);
    await claimConversation(theirs.id, otherAgent.id);
    await closeConversation(theirs.id, otherAgent.id);

    expect(await countClosedConversationsByAgent(agent.id)).toBe(1);
    expect(await countClosedConversationsByAgent(otherAgent.id)).toBe(1);
  });

  test('listClosedConversationsByAgent returns only that agent\'s closed conversations, most recently closed first, with pagination', async () => {
    const agent = await createAgent({ email: 'my-closed-3@dw.com', password: 'secret123', role: 'agent' });
    const otherAgent = await createAgent({ email: 'my-closed-4@dw.com', password: 'secret123', role: 'agent' });
    const first = await createConversation(contactId, channelId);
    await claimConversation(first.id, agent.id);
    await closeConversation(first.id, agent.id);
    const second = await createConversation(contactId, channelId);
    await claimConversation(second.id, agent.id);
    await closeConversation(second.id, agent.id);
    const otherContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
    const theirs = await createConversation(otherContact.id, channelId);
    await claimConversation(theirs.id, otherAgent.id);
    await closeConversation(theirs.id, otherAgent.id);

    const page1 = await listClosedConversationsByAgent(agent.id, { limit: 1, offset: 0 });
    const page2 = await listClosedConversationsByAgent(agent.id, { limit: 1, offset: 1 });

    expect(page1.map((c) => c.id)).toEqual([second.id]);
    expect(page2.map((c) => c.id)).toEqual([first.id]);
  });

  test('listClosedConversationsByAgent excludes a conversation still open for that agent', async () => {
    const agent = await createAgent({ email: 'my-closed-5@dw.com', password: 'secret123', role: 'agent' });
    const closed = await createConversation(contactId, channelId);
    await claimConversation(closed.id, agent.id);
    await closeConversation(closed.id, agent.id);
    const otherContact = await findOrCreateContactByPhoneNumber('+5511977775555', 'Segunda Pessoa');
    const stillOpen = await createConversation(otherContact.id, channelId);
    await claimConversation(stillOpen.id, agent.id);

    const result = await listClosedConversationsByAgent(agent.id, { limit: 10, offset: 0 });

    expect(result.map((c) => c.id)).toEqual([closed.id]);
  });

  test('listClosedConversationsByAgent still shows a conversation closed by an admin override', async () => {
    const agent = await createAgent({ email: 'my-closed-6@dw.com', password: 'secret123', role: 'agent' });
    const admin = await createAgent({ email: 'my-closed-admin@dw.com', password: 'secret123', role: 'admin' });
    const conversation = await createConversation(contactId, channelId);
    await claimConversation(conversation.id, agent.id);
    await adminCloseConversation(conversation.id, admin.id, null);

    const result = await listClosedConversationsByAgent(agent.id, { limit: 10, offset: 0 });

    expect(result.map((c) => c.id)).toEqual([conversation.id]);
  });

  test('a freshly created conversation has a null businessHoursNoticeSentAt', async () => {
    const conversation = await createConversation(contactId, channelId);
    expect(conversation.businessHoursNoticeSentAt).toBeNull();
  });

  test('markBusinessHoursNoticeSent sets a timestamp', async () => {
    const conversation = await createConversation(contactId, channelId);

    const updated = await markBusinessHoursNoticeSent(conversation.id);

    expect(updated.businessHoursNoticeSentAt).not.toBeNull();
  });

  test('findOpenConversation returns businessHoursNoticeSentAt after it was marked', async () => {
    const conversation = await createConversation(contactId, channelId);
    await markBusinessHoursNoticeSent(conversation.id);

    const found = await findOpenConversation(contactId, channelId);

    expect(found.businessHoursNoticeSentAt).not.toBeNull();
  });

  test('activateConversation preserves a previously marked businessHoursNoticeSentAt', async () => {
    const conversation = await createConversation(contactId, channelId, null, 'silent');
    await markBusinessHoursNoticeSent(conversation.id);

    const activated = await activateConversation(conversation.id);

    expect(activated.businessHoursNoticeSentAt).not.toBeNull();
  });

  test('concludeAiTriage grava a triagem, o setor final e o motivo sugerido, e conclui', async () => {
    const conv = await createConversation(contactId, channelId, 'pending');
    const setor = (await getPool().query("INSERT INTO sectors (name) VALUES ('Financeiro') RETURNING id")).rows[0].id;
    const motivo = (await getPool().query("INSERT INTO contact_reasons (name) VALUES ('Segunda via') RETURNING id")).rows[0].id;

    const done = await concludeAiTriage(conv.id, {
      sectorId: setor, reasonId: motivo, confidence: 0.93, summary: 'Cliente pediu segunda via.',
      identifiedBy: 'phone', lowConfidence: false, resolvedByAi: true,
    });

    expect(done.triageState).toBe('completed');
    expect(done.sectorId).toBe(setor);
    expect(done.aiTriageSectorId).toBe(setor);
    expect(done.suggestedReasonId).toBe(motivo);
    expect(done.aiTriageReasonId).toBe(motivo);
    expect(done.aiTriageConfidence).toBeCloseTo(0.93, 3);
    expect(done.aiTriageIdentifiedBy).toBe('phone');
    expect(done.aiTriageResolvedByAi).toBe(true);
    expect(done.aiTriageCompletedAt).toBeInstanceOf(Date);
  });

  test('concludeAiTriage aceita setor nulo (triagem inconclusiva) e é idempotente', async () => {
    const conv = await createConversation(contactId, channelId, 'pending');
    const first = await concludeAiTriage(conv.id, { sectorId: null, reasonId: null, confidence: null, summary: 'inconclusiva', identifiedBy: 'none', lowConfidence: true, resolvedByAi: false });
    expect(first.sectorId).toBeNull();
    expect(first.aiTriageLowConfidence).toBe(true);
    expect(await concludeAiTriage(conv.id, { sectorId: null, reasonId: null, confidence: null, summary: 'x', identifiedBy: 'none', lowConfidence: false, resolvedByAi: false })).toBeNull();
  });

  test('os campos da triagem IA chegam por TODAS as leituras, não só pelo RETURNING', async () => {
    // A armadilha das colunas enumeradas: escreve por uma função, relê por outras.
    const conv = await createConversation(contactId, channelId, 'pending');
    const setor = (await getPool().query("INSERT INTO sectors (name) VALUES ('Suporte') RETURNING id")).rows[0].id;
    await concludeAiTriage(conv.id, { sectorId: setor, reasonId: null, confidence: 0.5, summary: 'resumo X', identifiedBy: 'cpf', lowConfidence: true, resolvedByAi: false });

    const agent = await createAgent({ email: 'ai-triage-reads@dw.com', password: 'secret123', role: 'agent' });

    const leituras = {
      getConversationWithContact: await getConversationWithContact(conv.id),
      listWaiting: (await listWaitingConversations()).find((c) => c.id === conv.id),
      listWaitingForAgent: (await listWaitingForAgentConversations()).find((c) => c.id === conv.id),
      findOpen: await findOpenConversation(contactId, channelId),
    };
    for (const [nome, c] of Object.entries(leituras)) {
      if (!c) throw new Error(`${nome}: esperava encontrar a conversa`);
      expect(c.aiTriageSummary).toBe('resumo X');
      expect(c.aiTriageIdentifiedBy).toBe('cpf');
      expect(c.aiTriageLowConfidence).toBe(true);
      expect(c.aiTriageSectorId).toBe(setor);
    }
    // E as escritas que devolvem a conversa também precisam carregá-los.
    const claimed = await claimConversation(conv.id, agent.id);
    expect(claimed.aiTriageSummary).toBe('resumo X');
    const moved = await setConversationSector(conv.id, setor);
    expect(moved.aiTriageSummary).toBe('resumo X');
  });

  test('aiTriageReasonName (nome do motivo da triagem IA) chega pelas consultas que alimentam a fila, "minhas conversas" e o encerramento', async () => {
    // Mesma armadilha das colunas enumeradas do teste acima, mas para o LEFT JOIN
    // contact_reasons: escreve pela conclusão da triagem, relê pelas consultas
    // de resumo (toConversationSummary) que a fila, o painel do atendente e o
    // relatório de encerrados usam.
    const conv = await createConversation(contactId, channelId, 'pending');
    const setor = (await getPool().query("INSERT INTO sectors (name) VALUES ('Comercial') RETURNING id")).rows[0].id;
    const motivo = (await getPool().query("INSERT INTO contact_reasons (name) VALUES ('Mudança de endereço') RETURNING id")).rows[0].id;
    await concludeAiTriage(conv.id, {
      sectorId: setor, reasonId: motivo, confidence: 0.9, summary: 'resumo Y',
      identifiedBy: 'memory', lowConfidence: false, resolvedByAi: false,
    });

    const leituras = {
      getConversationWithContact: await getConversationWithContact(conv.id),
      listConversationsByContact: (await listConversationsByContact(contactId)).find((c) => c.id === conv.id),
      listWaitingConversations: (await listWaitingConversations()).find((c) => c.id === conv.id),
      listWaitingForAgentConversations: (await listWaitingForAgentConversations()).find((c) => c.id === conv.id),
    };
    for (const [nome, c] of Object.entries(leituras)) {
      if (!c) throw new Error(`${nome}: esperava encontrar a conversa`);
      expect(c.aiTriageReasonName).toBe('Mudança de endereço');
    }

    const agent = await createAgent({ email: 'ai-triage-reason-name@dw.com', password: 'secret123', role: 'agent' });
    const claimed = await claimConversation(conv.id, agent.id);
    expect(claimed).not.toBeNull();

    const assigned = (await listConversationsByAgent(agent.id)).find((c) => c.id === conv.id);
    expect(assigned.aiTriageReasonName).toBe('Mudança de endereço');
    const inProgress = (await listInProgressConversations()).find((c) => c.id === conv.id);
    expect(inProgress.aiTriageReasonName).toBe('Mudança de endereço');

    await closeConversation(conv.id, agent.id, null);
    const closedByAgent = (await listClosedConversationsByAgent(agent.id, { limit: 10, offset: 0 })).find((c) => c.id === conv.id);
    expect(closedByAgent.aiTriageReasonName).toBe('Mudança de endereço');
    const closedSince = (await listClosedSince(new Date(Date.now() - 60000), { limit: 10, offset: 0 })).find((c) => c.id === conv.id);
    expect(closedSince.aiTriageReasonName).toBe('Mudança de endereço');
  });

  describe('encerramento do atendimento pela própria IA', () => {
    test('markTriageResolvedByAi marca a flag só enquanto a triagem está pendente', async () => {
      const conv = await createConversation(contactId, channelId, 'pending');
      expect(await markTriageResolvedByAi(conv.id)).toBe(true);
      expect((await getConversationWithContact(conv.id)).aiTriageResolvedByAi).toBe(true);

      await concludeAiTriage(conv.id, { sectorId: null, reasonId: null, confidence: null, summary: 'x', identifiedBy: 'none', lowConfidence: false, resolvedByAi: false });
      expect(await markTriageResolvedByAi(conv.id)).toBe(false);
    });

    test('concludeAiTriage não zera a flag gravada num turno anterior', async () => {
      // A entrega do boleto/PIX pode ter sido há dois turnos: se a conclusão
      // sobrescrevesse com o resolvidoPelaIa (em memória) deste turno, o
      // "Resolvido pela IA" sumia do resumo e o timeout deixaria de encerrar.
      const conv = await createConversation(contactId, channelId, 'pending');
      await markTriageResolvedByAi(conv.id);

      const done = await concludeAiTriage(conv.id, {
        sectorId: null, reasonId: null, confidence: null, summary: 'resumo',
        identifiedBy: 'none', lowConfidence: false, resolvedByAi: false,
      });

      expect(done.aiTriageResolvedByAi).toBe(true);
    });

    test('closeConversationByAi fecha a conversa, grava o evento sem atendente e é idempotente', async () => {
      const conv = await createConversation(contactId, channelId, 'pending');
      const motivo = (await getPool().query("INSERT INTO contact_reasons (name) VALUES ('Resolvido pela IA') RETURNING id")).rows[0].id;

      const fechada = await closeConversationByAi(conv.id, { reasonId: motivo, summary: 'Resolvido pela IA e encerrado sem atendente.' });
      expect(fechada.status).toBe('closed');
      expect(fechada.triageState).toBe('completed');
      expect(fechada.assignedAgentId).toBeNull();
      expect(fechada.aiTriageResolvedByAi).toBe(true);
      expect(fechada.aiTriageSummary).toBe('Resolvido pela IA e encerrado sem atendente.');
      expect(fechada.aiTriageIdentifiedBy).toBe('none');
      expect(fechada.aiTriageCompletedAt).toBeInstanceOf(Date);

      const eventos = await getPool().query(
        `SELECT from_agent_id, reason_id FROM conversation_events WHERE conversation_id = $1 AND event_type = 'closed'`,
        [conv.id]
      );
      expect(eventos.rowCount).toBe(1);
      expect(eventos.rows[0].from_agent_id).toBeNull();
      expect(eventos.rows[0].reason_id).toBe(motivo);

      expect(await closeConversationByAi(conv.id, { reasonId: motivo, summary: 'de novo' })).toBeNull();
      expect((await getPool().query(`SELECT 1 FROM conversation_events WHERE conversation_id = $1 AND event_type = 'closed'`, [conv.id])).rowCount).toBe(1);
    });

    test('findRecentAiClosedConversation acha só o encerramento pela IA dentro da janela', async () => {
      const motivo = (await getPool().query("INSERT INTO contact_reasons (name) VALUES ('Resolvido pela IA') RETURNING id")).rows[0].id;
      const conv = await createConversation(contactId, channelId, 'pending');
      await closeConversationByAi(conv.id, { reasonId: motivo, summary: 'ok' });

      const achada = await findRecentAiClosedConversation(contactId, channelId, 30 * 60 * 1000);
      expect(achada).not.toBeNull();
      expect(achada.id).toBe(conv.id);
      expect(achada.status).toBe('closed');

      // Fora da janela: o evento é "velho" demais.
      await getPool().query(`UPDATE conversation_events SET created_at = now() - interval '31 minutes' WHERE conversation_id = $1`, [conv.id]);
      expect(await findRecentAiClosedConversation(contactId, channelId, 30 * 60 * 1000)).toBeNull();
    });

    test('findRecentAiClosedConversation ignora encerramento feito por atendente', async () => {
      const agent = await createAgent({ email: 'ai-close-human@dw.com', password: 'secret123', role: 'agent' });
      const conv = await createConversation(contactId, channelId);
      await claimConversation(conv.id, agent.id);
      await closeConversation(conv.id, agent.id, null);

      expect(await findRecentAiClosedConversation(contactId, channelId, 30 * 60 * 1000)).toBeNull();
    });

    test('closeConversationByAi não toca conversa com atendente, já concluída ou fora de espera', async () => {
      const agent = await createAgent({ email: 'ai-close@dw.com', password: 'secret123', role: 'agent' });

      const comAtendente = await createConversation(contactId, channelId, 'pending');
      await getPool().query("UPDATE conversations SET assigned_agent_id = $2, status = 'assigned' WHERE id = $1", [comAtendente.id, agent.id]);
      expect(await closeConversationByAi(comAtendente.id, { reasonId: null, summary: 's' })).toBeNull();
      // Só existe uma conversa aberta por contato+canal: libera para a próxima.
      await getPool().query("UPDATE conversations SET status = 'closed' WHERE id = $1", [comAtendente.id]);

      const conversaConcluida = await createConversation(contactId, channelId, 'pending');
      await getPool().query("UPDATE conversations SET triage_state = 'completed' WHERE id = $1", [conversaConcluida.id]);
      expect(await closeConversationByAi(conversaConcluida.id, { reasonId: null, summary: 's' })).toBeNull();
      await getPool().query("UPDATE conversations SET status = 'closed' WHERE id = $1", [conversaConcluida.id]);

      const silenciosa = await createConversation(contactId, channelId, 'pending', 'silent');
      expect(await closeConversationByAi(silenciosa.id, { reasonId: null, summary: 's' })).toBeNull();
    });
  });

  describe('ai_triage_phone_contested', () => {
    test('isPhoneContested é false por padrão numa conversa nova', async () => {
      const conv = await createConversation(contactId, channelId, 'pending');
      expect(await isPhoneContested(conv.id)).toBe(false);
    });

    test('markPhoneContested marca a coluna e isPhoneContested passa a devolver true', async () => {
      const conv = await createConversation(contactId, channelId, 'pending');
      await markPhoneContested(conv.id);
      expect(await isPhoneContested(conv.id)).toBe(true);
    });

    test('isPhoneContested devolve false para uma conversa que não existe', async () => {
      expect(await isPhoneContested('00000000-0000-0000-0000-000000000000')).toBe(false);
    });
  });

  test('guarda, lê e limpa o escopo de terceiro da conversa', async () => {
    const conversation = await createConversation(contactId, channelId);
    expect(await getThirdPartyScope(conversation.id)).toBeNull();

    const escopo = { nome: 'Maria', contratos: [10, 11], expiraEm: '2026-09-17T23:00:00.000Z' };
    await setThirdPartyScope(conversation.id, escopo);
    expect(await getThirdPartyScope(conversation.id)).toEqual(escopo);

    await setThirdPartyScope(conversation.id, null);
    expect(await getThirdPartyScope(conversation.id)).toBeNull();
  });

  test('o escopo de terceiro de uma conversa inexistente é nulo', async () => {
    expect(await getThirdPartyScope('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

// No histórico de um cliente que volta, a data sozinha não diz nada: quem
// atendeu, quem encerrou e por quê é o que permite retomar de onde parou.
// Quem atendeu e quem encerrou nem sempre é a mesma pessoa — o admin pode
// encerrar sem estar atribuído — então os dois vêm separados.
describe('listClosedConversationsByContact — quem atendeu, quem encerrou e por quê', () => {
  let contactId;
  let channelId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, agents, contact_reasons CASCADE');
    const contact = await findOrCreateContactByPhoneNumber('+5598984454546', 'Noah Gabriel');
    contactId = contact.id;
    const channel = await createChannel({ type: 'baileys', name: 'DW Telcom 1', phoneNumber: '+5598984129046', config: {} });
    channelId = channel.id;
  });

  test('traz o nome de quem atendeu e de quem encerrou', async () => {
    const tatiane = await createAgent({ email: 'tatiane@dw.com', password: 'secret123', role: 'agent', name: 'Tatiane' });
    const conversa = await createConversation(contactId, channelId);
    await claimConversation(conversa.id, tatiane.id);
    await closeConversation(conversa.id, tatiane.id);

    const [historico] = await listClosedConversationsByContact(contactId);

    expect(historico.assignedAgentName).toBe('Tatiane');
    expect(historico.closedByAgentName).toBe('Tatiane');
  });

  test('distingue o admin que encerrou do atendente que atendeu', async () => {
    const tatiane = await createAgent({ email: 'tatiane2@dw.com', password: 'secret123', role: 'agent', name: 'Tatiane' });
    const willemberg = await createAgent({ email: 'will@dw.com', password: 'secret123', role: 'admin', name: 'Willemberg' });
    const conversa = await createConversation(contactId, channelId);
    await claimConversation(conversa.id, tatiane.id);
    await adminCloseConversation(conversa.id, willemberg.id);

    const [historico] = await listClosedConversationsByContact(contactId);

    expect(historico.assignedAgentName).toBe('Tatiane');
    expect(historico.closedByAgentName).toBe('Willemberg');
  });

  test('traz o motivo do encerramento', async () => {
    const tatiane = await createAgent({ email: 'tatiane3@dw.com', password: 'secret123', role: 'agent', name: 'Tatiane' });
    const motivo = await createReason({ name: 'Segunda via de fatura' });
    const conversa = await createConversation(contactId, channelId);
    await claimConversation(conversa.id, tatiane.id);
    await closeConversation(conversa.id, tatiane.id, motivo.id);

    const [historico] = await listClosedConversationsByContact(contactId);

    expect(historico.closeReasonName).toBe('Segunda via de fatura');
  });

  test('aguenta um encerramento sem motivo e sem atendente', async () => {
    const conversa = await createConversation(contactId, channelId);
    await closeConversation(conversa.id, null);

    const [historico] = await listClosedConversationsByContact(contactId);

    expect(historico.assignedAgentName).toBeNull();
    expect(historico.closedByAgentName).toBeNull();
    expect(historico.closeReasonName).toBeNull();
  });
});
