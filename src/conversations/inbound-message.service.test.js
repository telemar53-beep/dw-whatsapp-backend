jest.mock('./contact.repository');
jest.mock('./conversation.repository');
jest.mock('./message.repository');
jest.mock('../realtime/socket-server');
jest.mock('../triage/triage.service');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation, getConversationWithContact, activateConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { shouldStartTriage, sendTriageQuestion, processTriageReply } = require('../triage/triage.service');
const { ingestInboundMessage } = require('./inbound-message.service');

describe('ingestInboundMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shouldStartTriage.mockResolvedValue(false);
  });

  test('reuses an existing open conversation and broadcasts queue:new when unassigned', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({
      id: 'contact-1',
      phoneNumber: '+5511999998888',
      displayName: 'Cliente',
    });
    findOpenConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-1' });
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      assignedAgentId: null,
      contactPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
    });

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
      whatsappMessageId: 'wamid.X',
      content: 'Oi',
    });

    expect(createConversation).not.toHaveBeenCalled();
    expect(createMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      direction: 'inbound',
      content: 'Oi',
      whatsappMessageId: 'wamid.X',
      status: 'received',
    });
    expect(result).toEqual({
      contact: { id: 'contact-1', phoneNumber: '+5511999998888', displayName: 'Cliente' },
      conversation: { id: 'conv-1', assignedAgentId: null },
      message: { id: 'msg-1' },
      contactJustCreated: false,
    });
    expect(broadcast).toHaveBeenCalledWith('queue:new', {
      conversation: {
        id: 'conv-1',
        assignedAgentId: null,
        contactPhoneNumber: '+5511999998888',
        contactDisplayName: 'Cliente',
      },
      message: { id: 'msg-1' },
    });
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('always broadcasts dashboard:conversation with the up-to-date conversation, regardless of assignment', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-dash1' });
    findOpenConversation.mockResolvedValue({ id: 'conv-dash1', assignedAgentId: 'agent-9' });
    createMessage.mockResolvedValue({ id: 'msg-dash1' });
    getConversationWithContact.mockResolvedValue({
      id: 'conv-dash1',
      assignedAgentId: 'agent-9',
      status: 'assigned',
    });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999980000',
      contactDisplayName: 'Cliente Dashboard',
      whatsappMessageId: 'wamid.DASH1',
      content: 'Oi',
    });

    expect(broadcastToDashboard).toHaveBeenCalledWith('dashboard:conversation', {
      conversation: { id: 'conv-dash1', assignedAgentId: 'agent-9', status: 'assigned' },
    });
  });

  test('does not broadcast dashboard:conversation for a duplicate webhook redelivery', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-dash2' });
    findOpenConversation.mockResolvedValue({ id: 'conv-dash2', assignedAgentId: null });
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
    createMessage.mockRejectedValue(uniqueViolation);

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999980001',
      contactDisplayName: 'Reenvio Dashboard',
      whatsappMessageId: 'wamid.DASH2',
      content: 'Oi',
    });

    expect(broadcastToDashboard).not.toHaveBeenCalled();
  });

  test('emits message:new to the assigned agent when the conversation is already assigned', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({
      id: 'contact-1b',
      phoneNumber: '+5511999998888',
      displayName: 'Cliente',
    });
    findOpenConversation.mockResolvedValue({ id: 'conv-1b', assignedAgentId: 'agent-1' });
    createMessage.mockResolvedValue({ id: 'msg-1b' });
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1b',
      assignedAgentId: 'agent-1',
      contactPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
    });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
      whatsappMessageId: 'wamid.X2',
      content: 'Oi de novo',
    });

    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:new', {
      conversation: {
        id: 'conv-1b',
        assignedAgentId: 'agent-1',
        contactPhoneNumber: '+5511999998888',
        contactDisplayName: 'Cliente',
      },
      message: { id: 'msg-1b' },
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('creates a new conversation when none is open', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-2' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-2', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-2' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-2', assignedAgentId: null });

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999997777',
      contactDisplayName: 'Outro Cliente',
      whatsappMessageId: 'wamid.Y',
      content: 'Ola',
    });

    expect(createConversation).toHaveBeenCalledWith('contact-2', 'channel-1', null);
    expect(result.conversation).toEqual({ id: 'conv-2', assignedAgentId: null });
  });

  test('starts triage by sending the question when a new conversation begins on a channel with triage enabled', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-9', phoneNumber: '+5511999990000', displayName: 'Novo Cliente' });
    findOpenConversation.mockResolvedValue(null);
    shouldStartTriage.mockResolvedValue(true);
    createConversation.mockResolvedValue({ id: 'conv-9', assignedAgentId: null, triageState: 'pending' });
    createMessage.mockResolvedValue({ id: 'msg-9' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-9', assignedAgentId: null, triageState: 'pending' });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990000',
      contactDisplayName: 'Novo Cliente',
      whatsappMessageId: 'wamid.TRIAGE1',
      content: 'Oi',
    });

    expect(createConversation).toHaveBeenCalledWith('contact-9', 'channel-1', 'pending');
    expect(sendTriageQuestion).toHaveBeenCalledWith('conv-9', 'channel-1');
    expect(processTriageReply).not.toHaveBeenCalled();
  });

  test('processes a reply through triage when an existing conversation still has triage pending', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-10', phoneNumber: '+5511999990001', displayName: 'Cliente Triagem' });
    findOpenConversation.mockResolvedValue({ id: 'conv-10', assignedAgentId: null, triageState: 'pending' });
    createMessage.mockResolvedValue({ id: 'msg-10' });
    processTriageReply.mockResolvedValue({ id: 'conv-10', assignedAgentId: null, sectorId: 'sector-1', triageState: 'completed' });
    getConversationWithContact.mockResolvedValue({
      id: 'conv-10',
      assignedAgentId: null,
      sectorId: 'sector-1',
      triageState: 'completed',
      contactPhoneNumber: '+5511999990001',
      contactDisplayName: 'Cliente Triagem',
    });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990001',
      contactDisplayName: 'Cliente Triagem',
      whatsappMessageId: 'wamid.TRIAGE2',
      content: '1',
    });

    expect(shouldStartTriage).not.toHaveBeenCalled();
    expect(processTriageReply).toHaveBeenCalledWith(
      { id: 'conv-10', assignedAgentId: null, triageState: 'pending' },
      'channel-1',
      '1'
    );
    expect(sendTriageQuestion).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledWith('queue:new', {
      conversation: {
        id: 'conv-10',
        assignedAgentId: null,
        sectorId: 'sector-1',
        triageState: 'completed',
        contactPhoneNumber: '+5511999990001',
        contactDisplayName: 'Cliente Triagem',
      },
      message: { id: 'msg-10' },
    });
  });

  test('does not process triage for a duplicate webhook redelivery even if triage is pending', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-11' });
    findOpenConversation.mockResolvedValue({ id: 'conv-11', assignedAgentId: null, triageState: 'pending' });
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
    createMessage.mockRejectedValue(uniqueViolation);

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990002',
      contactDisplayName: 'Reenvio Triagem',
      whatsappMessageId: 'wamid.TRIAGE3',
      content: '1',
    });

    expect(processTriageReply).not.toHaveBeenCalled();
    expect(sendTriageQuestion).not.toHaveBeenCalled();
  });

  test('does not start triage for a new conversation when the channel does not have it enabled', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-12' });
    findOpenConversation.mockResolvedValue(null);
    shouldStartTriage.mockResolvedValue(false);
    createConversation.mockResolvedValue({ id: 'conv-12', assignedAgentId: null, triageState: null });
    createMessage.mockResolvedValue({ id: 'msg-12' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-12', assignedAgentId: null, triageState: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990003',
      contactDisplayName: 'Cliente Normal',
      whatsappMessageId: 'wamid.NOTRIAGE',
      content: 'Oi',
    });

    expect(createConversation).toHaveBeenCalledWith('contact-12', 'channel-1', null);
    expect(sendTriageQuestion).not.toHaveBeenCalled();
  });

  test('falls back to the existing conversation when createConversation races on a unique violation', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-3' });
    findOpenConversation
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'conv-3', assignedAgentId: null });
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
    createConversation.mockRejectedValue(uniqueViolation);
    createMessage.mockResolvedValue({ id: 'msg-3' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-3', assignedAgentId: null });

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999996666',
      contactDisplayName: 'Concorrente',
      whatsappMessageId: 'wamid.Z',
      content: 'Oi de novo',
    });

    expect(findOpenConversation).toHaveBeenCalledTimes(2);
    expect(result.conversation).toEqual({ id: 'conv-3', assignedAgentId: null });
    expect(result.message).toEqual({ id: 'msg-3' });
  });

  test('rethrows when createConversation fails with a non-unique-violation error', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-4' });
    findOpenConversation.mockResolvedValue(null);
    const otherError = new Error('connection lost');
    createConversation.mockRejectedValue(otherError);

    await expect(
      ingestInboundMessage({
        channelId: 'channel-1',
        fromPhoneNumber: '+5511999995555',
        contactDisplayName: 'Falha',
        whatsappMessageId: 'wamid.W',
        content: 'Oi',
      })
    ).rejects.toThrow('connection lost');

    expect(createMessage).not.toHaveBeenCalled();
    expect(emitToAgent).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('returns a null message and emits nothing when createMessage fails with a unique violation (already-processed webhook redelivery)', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-5' });
    findOpenConversation.mockResolvedValue({ id: 'conv-5', assignedAgentId: null });
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
    createMessage.mockRejectedValue(uniqueViolation);

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999994444',
      contactDisplayName: 'Reenvio',
      whatsappMessageId: 'wamid.DUP',
      content: 'Oi',
    });

    expect(result).toEqual({
      contact: { id: 'contact-5' },
      conversation: { id: 'conv-5', assignedAgentId: null },
      message: null,
      contactJustCreated: false,
    });
    expect(emitToAgent).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('rethrows when createMessage fails with a non-unique-violation error', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-6' });
    findOpenConversation.mockResolvedValue({ id: 'conv-6', assignedAgentId: null });
    const otherError = new Error('disk full');
    createMessage.mockRejectedValue(otherError);

    await expect(
      ingestInboundMessage({
        channelId: 'channel-1',
        fromPhoneNumber: '+5511999993333',
        contactDisplayName: 'Erro',
        whatsappMessageId: 'wamid.ERR',
        content: 'Oi',
      })
    ).rejects.toThrow('disk full');

    expect(emitToAgent).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('passes media fields through to createMessage and the emitted payload', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-7', phoneNumber: '+5511999992222', displayName: 'Cliente Mídia' });
    findOpenConversation.mockResolvedValue({ id: 'conv-7', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-7', messageType: 'image', mediaPath: 'abc.jpg' });
    getConversationWithContact.mockResolvedValue({
      id: 'conv-7',
      assignedAgentId: null,
      contactPhoneNumber: '+5511999992222',
      contactDisplayName: 'Cliente Mídia',
    });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999992222',
      contactDisplayName: 'Cliente Mídia',
      whatsappMessageId: 'wamid.IMG',
      content: 'Comprovante',
      messageType: 'image',
      mediaPath: 'abc.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
    });

    expect(createMessage).toHaveBeenCalledWith({
      conversationId: 'conv-7',
      direction: 'inbound',
      content: 'Comprovante',
      whatsappMessageId: 'wamid.IMG',
      status: 'received',
      messageType: 'image',
      mediaPath: 'abc.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
      locationLatitude: undefined,
      locationLongitude: undefined,
    });
    expect(broadcast).toHaveBeenCalledWith('queue:new', {
      conversation: {
        id: 'conv-7',
        assignedAgentId: null,
        contactPhoneNumber: '+5511999992222',
        contactDisplayName: 'Cliente Mídia',
      },
      message: { id: 'msg-7', messageType: 'image', mediaPath: 'abc.jpg' },
    });
  });

  test('defaults messageType-related fields to undefined when not provided (plain text still works)', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-8' });
    findOpenConversation.mockResolvedValue({ id: 'conv-8', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-8' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-8', assignedAgentId: null });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999991111',
      contactDisplayName: 'Cliente Texto',
      whatsappMessageId: 'wamid.TXT',
      content: 'Oi',
    });

    expect(createMessage).toHaveBeenCalledWith({
      conversationId: 'conv-8',
      direction: 'inbound',
      content: 'Oi',
      whatsappMessageId: 'wamid.TXT',
      status: 'received',
      messageType: undefined,
      mediaPath: undefined,
      mediaMimeType: undefined,
      mediaFilename: undefined,
      locationLatitude: undefined,
      locationLongitude: undefined,
    });
  });

  test('reports contactJustCreated as true when the contact repository reports a new contact', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-13', wasCreated: true });
    findOpenConversation.mockResolvedValue({ id: 'conv-13', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-13' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-13', assignedAgentId: null });

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990010',
      contactDisplayName: 'Cliente Novo',
      whatsappMessageId: 'wamid.NEW1',
      content: 'Oi',
    });

    expect(result.contactJustCreated).toBe(true);
    expect(result.contact).toEqual({ id: 'contact-13' });
  });

  test('reports contactJustCreated as false when reusing an existing contact', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-14', wasCreated: false });
    findOpenConversation.mockResolvedValue({ id: 'conv-14', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-14' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-14', assignedAgentId: null });

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990011',
      contactDisplayName: 'Cliente Existente',
      whatsappMessageId: 'wamid.NEW2',
      content: 'Oi',
    });

    expect(result.contactJustCreated).toBe(false);
  });

  test("activates a silent conversation on the customer's first reply and broadcasts queue:new", async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-sgp-1' });
    findOpenConversation.mockResolvedValue({ id: 'conv-sgp-1', assignedAgentId: null, status: 'silent' });
    activateConversation.mockResolvedValue({ id: 'conv-sgp-1', assignedAgentId: null, status: 'waiting' });
    createMessage.mockResolvedValue({ id: 'msg-sgp-1' });
    getConversationWithContact.mockResolvedValue({
      id: 'conv-sgp-1',
      assignedAgentId: null,
      status: 'waiting',
      contactPhoneNumber: '+5511999990099',
    });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990099',
      contactDisplayName: 'Cliente SGP',
      whatsappMessageId: 'wamid.SGP1',
      content: 'Já paguei, obrigado!',
    });

    expect(activateConversation).toHaveBeenCalledWith('conv-sgp-1');
    expect(createConversation).not.toHaveBeenCalled();
    expect(createMessage).toHaveBeenCalledWith({
      conversationId: 'conv-sgp-1',
      direction: 'inbound',
      content: 'Já paguei, obrigado!',
      whatsappMessageId: 'wamid.SGP1',
      status: 'received',
    });
    expect(broadcast).toHaveBeenCalledWith('queue:new', {
      conversation: {
        id: 'conv-sgp-1',
        assignedAgentId: null,
        status: 'waiting',
        contactPhoneNumber: '+5511999990099',
      },
      message: { id: 'msg-sgp-1' },
    });
  });

  test('does not call activateConversation when the existing conversation is not silent', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-sgp-2' });
    findOpenConversation.mockResolvedValue({ id: 'conv-sgp-2', assignedAgentId: null, status: 'waiting' });
    createMessage.mockResolvedValue({ id: 'msg-sgp-2' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-sgp-2', assignedAgentId: null, status: 'waiting' });

    await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999990098',
      contactDisplayName: 'Cliente Normal',
      whatsappMessageId: 'wamid.NORM1',
      content: 'Oi',
    });

    expect(activateConversation).not.toHaveBeenCalled();
  });
});
