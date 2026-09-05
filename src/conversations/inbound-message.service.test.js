jest.mock('./contact.repository');
jest.mock('./conversation.repository');
jest.mock('./message.repository');
jest.mock('../realtime/socket-server');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { findOpenConversation, createConversation } = require('./conversation.repository');
const { createMessage } = require('./message.repository');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { ingestInboundMessage } = require('./inbound-message.service');

describe('ingestInboundMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('reuses an existing open conversation and broadcasts queue:new when unassigned', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({
      id: 'contact-1',
      phoneNumber: '+5511999998888',
      displayName: 'Cliente',
    });
    findOpenConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: null });
    createMessage.mockResolvedValue({ id: 'msg-1' });

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

  test('emits message:new to the assigned agent when the conversation is already assigned', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({
      id: 'contact-1b',
      phoneNumber: '+5511999998888',
      displayName: 'Cliente',
    });
    findOpenConversation.mockResolvedValue({ id: 'conv-1b', assignedAgentId: 'agent-1' });
    createMessage.mockResolvedValue({ id: 'msg-1b' });

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

    const result = await ingestInboundMessage({
      channelId: 'channel-1',
      fromPhoneNumber: '+5511999997777',
      contactDisplayName: 'Outro Cliente',
      whatsappMessageId: 'wamid.Y',
      content: 'Ola',
    });

    expect(createConversation).toHaveBeenCalledWith('contact-2', 'channel-1');
    expect(result.conversation).toEqual({ id: 'conv-2', assignedAgentId: null });
  });

  test('falls back to the existing conversation when createConversation races on a unique violation', async () => {
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-3' });
    findOpenConversation
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'conv-3', assignedAgentId: null });
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
    createConversation.mockRejectedValue(uniqueViolation);
    createMessage.mockResolvedValue({ id: 'msg-3' });

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
});
