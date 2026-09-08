const { getPool, closePool } = require('../db/pool');
const { createChannel } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { createConversation } = require('../conversations/conversation.repository');
const { createMessage } = require('../conversations/message.repository');
const { getOutboundQueue, enqueueOutboundMessage, processOutboundQueue, closeOutboundQueue } = require('./outbound-queue');

describe('outbound queue', () => {
  let conversationId;
  let channelId;

  beforeEach(async () => {
    // Drain before each test too, not just after: a run that starts from an already-polluted
    // queue (e.g. a prior crashed run) would otherwise fail its first test before self-healing.
    await getOutboundQueue().obliterate({ force: true });
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
    // The Bull queue is durable in Redis: without draining it, a job left behind by one test is
    // picked up by the next test's freshly registered processor, shifting every assertion by one.
    await getOutboundQueue().obliterate({ force: true });
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

  test('passes template fields through to the queued job', (done) => {
    processOutboundQueue((data) => {
      try {
        expect(data.templateName).toBe('fatura_vencida');
        expect(data.templateLanguage).toBe('pt_BR');
        expect(data.templateVariables).toEqual(['João', 'R$150,00']);
        done();
      } catch (err) {
        done(err);
      }
    });
    enqueueOutboundMessage({
      conversationId, channelId, content: 'Olá João, sua fatura de R$150,00 venceu.',
      templateName: 'fatura_vencida', templateLanguage: 'pt_BR', templateVariables: ['João', 'R$150,00'],
    });
  });

  test('defaults template fields to null when not a template message', (done) => {
    processOutboundQueue((data) => {
      try {
        expect(data.templateName).toBeNull();
        expect(data.templateLanguage).toBeNull();
        expect(data.templateVariables).toBeNull();
        done();
      } catch (err) {
        done(err);
      }
    });
    enqueueOutboundMessage({ conversationId, channelId, content: 'Mensagem normal' });
  });

  test('passes header fields through to the queued job', (done) => {
    processOutboundQueue((data) => {
      try {
        expect(data.headerType).toBe('document');
        expect(data.headerLink).toBe('https://boleto.link/xyz.pdf');
        done();
      } catch (err) {
        done(err);
      }
    });
    enqueueOutboundMessage({
      conversationId, channelId, content: 'Olá João', templateName: 'aviso_cobranca', templateLanguage: 'pt_BR',
      templateVariables: ['João'], headerType: 'document', headerLink: 'https://boleto.link/xyz.pdf',
    });
  });

  test('defaults header fields to null when not provided', (done) => {
    processOutboundQueue((data) => {
      try {
        expect(data.headerType).toBeNull();
        expect(data.headerLink).toBeNull();
        done();
      } catch (err) {
        done(err);
      }
    });
    enqueueOutboundMessage({ conversationId, channelId, content: 'Mensagem normal' });
  });

  test('passes repliedToMessageId through to the queued job', (done) => {
    // replied_to_message_id is a UUID FK to messages(id) (Task 1's migration), so this test
    // creates a real original message rather than using a placeholder string like 'msg-original'.
    createMessage({
      conversationId,
      direction: 'inbound',
      content: 'Qual o valor da fatura?',
      whatsappMessageId: 'wamid.ORIG1',
      status: 'received',
    }).then((original) => {
      processOutboundQueue((data) => {
        try {
          expect(data.repliedToMessageId).toBe(original.id);
          done();
        } catch (err) {
          done(err);
        }
      });
      enqueueOutboundMessage({ conversationId, channelId, content: 'R$150,00', repliedToMessageId: original.id });
    });
  });

  test('defaults repliedToMessageId to null when not provided', (done) => {
    processOutboundQueue((data) => {
      try {
        expect(data.repliedToMessageId).toBeNull();
        done();
      } catch (err) {
        done(err);
      }
    });
    enqueueOutboundMessage({ conversationId, channelId, content: 'Mensagem normal' });
  });
});
