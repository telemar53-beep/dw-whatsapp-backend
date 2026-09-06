const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createConversation } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage, processOutboundQueue, closeOutboundQueue } = require('./outbound-queue');

describe('outbound queue', () => {
  let conversationId;
  let channelId;

  beforeEach(async () => {
    await getPool().query('TRUNCATE conversations, contacts, channels, messages CASCADE');
    const contact = await findOrCreateContactByPhoneNumber('+5511911112222', 'Fila Teste');
    const channel = await createChannel({
      type: 'meta_cloud',
      name: 'Canal Fila',
      phoneNumber: '+5511999990020',
      config: { phoneNumberId: '333', accessToken: 'tok3' },
    });
    conversationId = (await createConversation(contact.id, channel.id)).id;
    channelId = channel.id;
  });

  afterEach(async () => {
    await closeOutboundQueue();
  });

  afterAll(async () => {
    await closePool();
  });

  test('creates a message row immediately and delivers its id to the processor', (done) => {
    processOutboundQueue((data) => {
      try {
        expect(data.conversationId).toBe(conversationId);
        expect(data.channelId).toBe(channelId);
        expect(data.content).toBe('Ola');
        expect(data.messageId).toBeDefined();
        done();
      } catch (err) {
        done(err);
      }
    });
    enqueueOutboundMessage({ conversationId, channelId, content: 'Ola' }).then((message) => {
      expect(message.status).toBe('sent');
    });
  });

  test('passes media fields through to the created message and the queued job', (done) => {
    processOutboundQueue((data) => {
      try {
        expect(data.messageType).toBe('image');
        expect(data.mediaPath).toBe('some-file.jpg');
        expect(data.mediaMimeType).toBe('image/jpeg');
        done();
      } catch (err) {
        done(err);
      }
    });
    enqueueOutboundMessage({
      conversationId,
      channelId,
      content: 'Aqui está',
      messageType: 'image',
      mediaPath: 'some-file.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
    }).then((message) => {
      expect(message.messageType).toBe('image');
    });
  });
});
