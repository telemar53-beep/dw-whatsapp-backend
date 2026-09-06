const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('./contact.repository');
const { createConversation } = require('./conversation.repository');
const {
  createMessage,
  updateMessageStatus,
  recordMessageSent,
  listMessagesByConversation,
  findMessageById,
} = require('./message.repository');

describe('message repository', () => {
  let conversationId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, messages CASCADE');
    const contact = await findOrCreateContactByPhoneNumber('+5511966665555', 'Ana');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Teste 2',
      phoneNumber: '+5511999990010',
      config: { phoneNumberId: '222', accessToken: 'tok2' },
    });
    const conversation = await createConversation(contact.id, channel.id);
    conversationId = conversation.id;
  });

  afterAll(async () => {
    await closePool();
  });

  test('createMessage stores an inbound text message with messageType defaulting to text', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Oi, preciso de ajuda',
      whatsappMessageId: 'wamid.ABC123',
      status: 'received',
    });
    expect(message.id).toBeDefined();
    expect(message.direction).toBe('inbound');
    expect(message.status).toBe('received');
    expect(message.messageType).toBe('text');
    expect(message.mediaPath).toBeNull();
  });

  test('createMessage stores an image message with a caption and media fields', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Aqui está o comprovante',
      whatsappMessageId: 'wamid.IMG1',
      status: 'received',
      messageType: 'image',
      mediaPath: 'abc123.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
    });
    expect(message.messageType).toBe('image');
    expect(message.mediaPath).toBe('abc123.jpg');
    expect(message.mediaMimeType).toBe('image/jpeg');
    expect(message.content).toBe('Aqui está o comprovante');
  });

  test('createMessage stores a message with no content when there is no caption', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      whatsappMessageId: 'wamid.AUD1',
      status: 'received',
      messageType: 'audio',
      mediaPath: 'def456.ogg',
      mediaMimeType: 'audio/ogg',
    });
    expect(message.content).toBeNull();
    expect(message.messageType).toBe('audio');
  });

  test('createMessage stores a location message with coordinates and no media', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'inbound',
      whatsappMessageId: 'wamid.LOC1',
      status: 'received',
      messageType: 'location',
      locationLatitude: -3.119,
      locationLongitude: -60.021,
    });
    expect(message.messageType).toBe('location');
    expect(message.locationLatitude).toBe(-3.119);
    expect(message.locationLongitude).toBe(-60.021);
    expect(message.mediaPath).toBeNull();
  });

  test('updateMessageStatus changes the status', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'outbound',
      content: 'Resposta',
      whatsappMessageId: null,
      status: 'sent',
    });
    const updated = await updateMessageStatus(message.id, 'failed');
    expect(updated.status).toBe('failed');
  });

  test('recordMessageSent sets the whatsapp message id', async () => {
    const message = await createMessage({
      conversationId,
      direction: 'outbound',
      content: 'Resposta',
      whatsappMessageId: null,
      status: 'sent',
    });
    const updated = await recordMessageSent(message.id, 'wamid.OUT1');
    expect(updated.whatsappMessageId).toBe('wamid.OUT1');
  });

  test('listMessagesByConversation returns messages in chronological order', async () => {
    await createMessage({ conversationId, direction: 'inbound', content: 'primeira', whatsappMessageId: 'wamid.1', status: 'received' });
    await createMessage({ conversationId, direction: 'outbound', content: 'segunda', whatsappMessageId: null, status: 'sent' });
    const messages = await listMessagesByConversation(conversationId);
    expect(messages.map((m) => m.content)).toEqual(['primeira', 'segunda']);
  });

  test('findMessageById returns the message with its media fields', async () => {
    const created = await createMessage({
      conversationId,
      direction: 'inbound',
      whatsappMessageId: 'wamid.DOC1',
      status: 'received',
      messageType: 'document',
      mediaPath: 'ghi789.pdf',
      mediaMimeType: 'application/pdf',
      mediaFilename: 'comprovante.pdf',
    });
    const found = await findMessageById(created.id);
    expect(found.mediaPath).toBe('ghi789.pdf');
    expect(found.mediaFilename).toBe('comprovante.pdf');
  });

  test('findMessageById returns null when not found', async () => {
    const found = await findMessageById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});
