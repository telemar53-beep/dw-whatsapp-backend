jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/message.repository');
jest.mock('../queue/outbound-queue');
jest.mock('../realtime/socket-server');
jest.mock('../media/media-storage', () => ({
  ...jest.requireActual('../media/media-storage'),
  saveMediaFile: jest.fn(),
}));
jest.mock('../channels/channel.repository');
jest.mock('../conversations/contact.repository');
jest.mock('../whatsapp-adapters/baileys.manager');
jest.mock('../templates/template.repository');
jest.mock('../assignment-messages/assignment-message.service');
jest.mock('../reasons/reason.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const {
  listWaitingConversations,
  listConversationsByAgent,
  listClosedConversationsByAgent,
  countClosedConversationsByAgent,
  getConversationWithContact,
  claimConversation,
  transferConversation,
  closeConversation,
  adminTransferConversation,
  adminCloseConversation,
  listClosedConversationsByContact,
  findOpenConversation,
  createConversation,
} = require('../conversations/conversation.repository');
const { listMessagesByConversation, findMessageById } = require('../conversations/message.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { emitToAgent, broadcast, broadcastToDashboard } = require('../realtime/socket-server');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findChannelById } = require('../channels/channel.repository');
const { findTemplateById } = require('../templates/template.repository');
const {
  sendOpeningMessageIfApplicable,
  sendClosingMessageIfApplicable,
} = require('../assignment-messages/assignment-message.service');
const { findReasonById } = require('../reasons/reason.repository');
const conversationsRoutes = require('./conversations.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

// :id must look like a UUID to pass the router.param('id', ...) guard, since the
// conversations.id column is a Postgres UUID. Use two distinct valid-looking UUIDs:
// one standing in for a real conversation reached by the route handler, and one
// standing in for a conversation the mocked repository reports as not found.
const CONVERSATION_ID = '11111111-1111-1111-1111-111111111111';
const NON_EXISTENT_ID = '22222222-2222-2222-2222-222222222222';

describe('GET /api/conversations/queue', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the waiting queue for an authenticated agent', async () => {
    listWaitingConversations.mockResolvedValue([{ id: 'conv-1', status: 'waiting' }]);
    const res = await request(buildApp())
      .get('/api/conversations/queue')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'conv-1', status: 'waiting' }]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/conversations/queue');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/conversations/mine', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns conversations assigned to the requesting agent', async () => {
    listConversationsByAgent.mockResolvedValue([{ id: 'conv-2', assignedAgentId: 'agent-1' }]);
    const res = await request(buildApp())
      .get('/api/conversations/mine')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(listConversationsByAgent).toHaveBeenCalledWith('agent-1');
    expect(res.body).toEqual([{ id: 'conv-2', assignedAgentId: 'agent-1' }]);
  });
});

describe('GET /api/conversations/mine/closed', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns a page of the requesting agent\'s closed conversations with hasMore true when more remain', async () => {
    listClosedConversationsByAgent.mockResolvedValue([{ id: 'conv-1', closedAt: '2026-09-09T10:00:00.000Z' }]);
    countClosedConversationsByAgent.mockResolvedValue(3);

    const res = await request(buildApp())
      .get('/api/conversations/mine/closed?limit=1&offset=0')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ id: 'conv-1', closedAt: '2026-09-09T10:00:00.000Z' }], hasMore: true });
    expect(listClosedConversationsByAgent).toHaveBeenCalledWith('agent-1', { limit: 1, offset: 0 });
    expect(countClosedConversationsByAgent).toHaveBeenCalledWith('agent-1');
  });

  test('returns hasMore false when the page reaches the end', async () => {
    listClosedConversationsByAgent.mockResolvedValue([{ id: 'conv-1' }]);
    countClosedConversationsByAgent.mockResolvedValue(1);

    const res = await request(buildApp())
      .get('/api/conversations/mine/closed?limit=20&offset=0')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.body.hasMore).toBe(false);
  });

  test('defaults limit to 20 and caps it at 50', async () => {
    listClosedConversationsByAgent.mockResolvedValue([]);
    countClosedConversationsByAgent.mockResolvedValue(0);

    await request(buildApp())
      .get('/api/conversations/mine/closed')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(listClosedConversationsByAgent).toHaveBeenCalledWith('agent-1', { limit: 20, offset: 0 });

    jest.clearAllMocks();
    listClosedConversationsByAgent.mockResolvedValue([]);
    countClosedConversationsByAgent.mockResolvedValue(0);
    await request(buildApp())
      .get('/api/conversations/mine/closed?limit=999')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(listClosedConversationsByAgent).toHaveBeenCalledWith('agent-1', { limit: 50, offset: 0 });
  });

  test('only lists the requesting agent\'s own closed conversations, never another agent\'s', async () => {
    listClosedConversationsByAgent.mockResolvedValue([]);
    countClosedConversationsByAgent.mockResolvedValue(0);

    await request(buildApp())
      .get('/api/conversations/mine/closed')
      .set('Authorization', `Bearer ${tokenFor('agent-2', 'agent')}`);

    expect(listClosedConversationsByAgent).toHaveBeenCalledWith('agent-2', expect.any(Object));
    expect(countClosedConversationsByAgent).toHaveBeenCalledWith('agent-2');
  });
});

describe('GET /api/conversations/contacts/:contactId/history', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the closed conversation history for a contact', async () => {
    listClosedConversationsByContact.mockResolvedValue([
      { id: 'conv-old', channelName: 'Berg', channelType: 'baileys', updatedAt: new Date() },
    ]);
    const res = await request(buildApp())
      .get('/api/conversations/contacts/contact-1/history')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(listClosedConversationsByContact).toHaveBeenCalledWith('contact-1');
    expect(res.body).toEqual([
      { id: 'conv-old', channelName: 'Berg', channelType: 'baileys', updatedAt: expect.any(String) },
    ]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/conversations/contacts/contact-1/history');
    expect(res.status).toBe(401);
    expect(listClosedConversationsByContact).not.toHaveBeenCalled();
  });
});

describe('GET /api/conversations/:id/messages', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the message history for an existing conversation', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1' });
    listMessagesByConversation.mockResolvedValue([{ id: 'msg-1', content: 'Oi' }]);
    const res = await request(buildApp())
      .get(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'msg-1', content: 'Oi' }]);
  });

  test('returns 404 when the conversation does not exist', async () => {
    getConversationWithContact.mockResolvedValue(null);
    const res = await request(buildApp())
      .get(`/api/conversations/${NON_EXISTENT_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 without querying the repository when :id is not a UUID', async () => {
    const res = await request(buildApp())
      .get('/api/conversations/not-a-uuid/messages')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
    expect(getConversationWithContact).not.toHaveBeenCalled();
  });
});

describe('POST /api/conversations/:id/claim', () => {
  beforeEach(() => jest.clearAllMocks());

  test('claims a waiting conversation for the requesting agent', async () => {
    claimConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(claimConversation).toHaveBeenCalledWith(CONVERSATION_ID, 'agent-1');
    expect(res.body.status).toBe('assigned');
  });

  test('returns 409 when the conversation is already assigned or closed', async () => {
    claimConversation.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(409);
  });

  test('broadcasts queue:removed and notifies the claiming agent on success', async () => {
    claimConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
      contactPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
    });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(broadcast).toHaveBeenCalledWith('queue:removed', { conversationId: 'conv-1' });
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:assigned', {
      conversation: {
        id: 'conv-1',
        status: 'assigned',
        assignedAgentId: 'agent-1',
        contactPhoneNumber: '+5511999998888',
        contactDisplayName: 'Cliente',
      },
    });
  });

  test('also broadcasts dashboard:conversation on a successful claim', async () => {
    claimConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(broadcastToDashboard).toHaveBeenCalledWith('dashboard:conversation', {
      conversation: { id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' },
    });
  });

  test('does not emit anything when claim fails', async () => {
    claimConversation.mockResolvedValue(null);
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(broadcast).not.toHaveBeenCalled();
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('calls sendOpeningMessageIfApplicable with the claimed conversation and agent id', async () => {
    const claimedConversation = { id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1', channelId: 'channel-1', protocolNumber: null };
    claimConversation.mockResolvedValue(claimedConversation);
    getConversationWithContact.mockResolvedValue(claimedConversation);
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(sendOpeningMessageIfApplicable).toHaveBeenCalledWith(claimedConversation, 'agent-1');
  });

  test('does not call sendOpeningMessageIfApplicable when the claim fails', async () => {
    claimConversation.mockResolvedValue(null);
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(sendOpeningMessageIfApplicable).not.toHaveBeenCalled();
  });

  test('a failure inside sendOpeningMessageIfApplicable does not break the 200 response', async () => {
    const claimedConversation = { id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1', channelId: 'channel-1', protocolNumber: null };
    claimConversation.mockResolvedValue(claimedConversation);
    getConversationWithContact.mockResolvedValue(claimedConversation);
    sendOpeningMessageIfApplicable.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/conversations/:id/messages', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enqueues a message when the requester is the assigned agent', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-1', status: 'sent' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Ola cliente' });
    expect(res.status).toBe(201);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Ola cliente',
    });
    expect(res.body).toEqual({ id: 'msg-1', status: 'sent' });
  });

  test('returns 400 when content is missing', async () => {
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('returns 404 when the conversation does not exist', async () => {
    getConversationWithContact.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${NON_EXISTENT_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Ola' });
    expect(res.status).toBe(404);
  });

  test('returns 403 when the requester is not the assigned agent', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-2' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Ola' });
    expect(res.status).toBe(403);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('returns 409 when the conversation is closed, even for the assigned agent', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      channelId: 'channel-1',
      status: 'closed',
      assignedAgentId: 'agent-1',
    });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Ola' });
    expect(res.status).toBe(409);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('accepts a multipart upload with an image file and no text content', async () => {
    const { saveMediaFile } = require('../media/media-storage');
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      channelId: 'channel-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
    });
    saveMediaFile.mockResolvedValue('generated-name.jpg');
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-1', messageType: 'image' });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'foto.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(saveMediaFile).toHaveBeenCalledWith(Buffer.from('fake-image-bytes'), '.jpg');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      channelId: 'channel-1',
      content: null,
      messageType: 'image',
      mediaPath: 'generated-name.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: 'foto.jpg',
    });
  });

  test('accepts a multipart upload with both a file and a caption', async () => {
    const { saveMediaFile } = require('../media/media-storage');
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      channelId: 'channel-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
    });
    saveMediaFile.mockResolvedValue('generated-doc.pdf');
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-2', messageType: 'document' });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .field('content', 'Segue o comprovante')
      .attach('file', Buffer.from('fake-pdf-bytes'), { filename: 'comprovante.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      channelId: 'channel-1',
      content: 'Segue o comprovante',
      messageType: 'document',
      mediaPath: 'generated-doc.pdf',
      mediaMimeType: 'application/pdf',
      mediaFilename: 'comprovante.pdf',
    });
  });

  test('rejects a request with neither content nor a file', async () => {
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('accepts a multipart upload with an audio file and no caption', async () => {
    const { saveMediaFile } = require('../media/media-storage');
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      channelId: 'channel-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
    });
    saveMediaFile.mockResolvedValue('generated-audio.ogg');
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-3', messageType: 'audio' });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .attach('file', Buffer.from('fake-audio-bytes'), { filename: 'audio.ogg', contentType: 'audio/ogg' });

    expect(res.status).toBe(201);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      channelId: 'channel-1',
      content: null,
      messageType: 'audio',
      mediaPath: 'generated-audio.ogg',
      mediaMimeType: 'audio/ogg',
      mediaFilename: 'audio.ogg',
    });
  });

  test('converts a WebM recording to Ogg/Opus before storing it, so WhatsApp can decode it', async () => {
    const { spawnSync } = require('child_process');
    const ffmpegPath = require('ffmpeg-static');
    const { stdout: webm } = spawnSync(
      ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-c:a', 'libopus', '-b:a', '32k', '-f', 'webm', 'pipe:1'],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    expect(webm.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));

    const { saveMediaFile } = require('../media/media-storage');
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      channelId: 'channel-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
    });
    saveMediaFile.mockResolvedValue('generated-audio.ogg');
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-3', messageType: 'audio' });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .attach('file', webm, { filename: 'gravacao.webm', contentType: 'audio/webm;codecs=opus' });

    expect(res.status).toBe(201);
    const [storedBuffer, storedExtension] = saveMediaFile.mock.calls[0];
    expect(storedBuffer.subarray(0, 4).toString('ascii')).toBe('OggS');
    expect(storedExtension).toBe('.ogg');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      channelId: 'channel-1',
      content: null,
      messageType: 'audio',
      mediaPath: 'generated-audio.ogg',
      mediaMimeType: 'audio/ogg; codecs=opus',
      mediaFilename: 'gravacao.ogg',
    });
  });

  test('rejects an audio upload that cannot be converted instead of sending it silently', async () => {
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      channelId: 'channel-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
    });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .attach('file', Buffer.from('not audio at all'), { filename: 'quebrado.webm', contentType: 'audio/webm' });

    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('rejects an audio upload that also includes a caption', async () => {
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      channelId: 'channel-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
    });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .field('content', 'texto')
      .attach('file', Buffer.from('fake-audio-bytes'), { filename: 'audio.ogg', contentType: 'audio/ogg' });

    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('rejects a file larger than the type-specific size limit', async () => {
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      channelId: 'channel-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
    });
    const tooLarge = Buffer.alloc(17 * 1024 * 1024); // 17MB, over the 16MB image limit

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .attach('file', tooLarge, { filename: 'grande.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('rejects a file larger than multer\'s own 100MB global cap with a 400, not a 500', async () => {
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      channelId: 'channel-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
    });
    const overGlobalCap = Buffer.alloc(101 * 1024 * 1024); // 101MB, over multer's 100MB global cap

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .attach('file', overGlobalCap, { filename: 'gigante.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('accepts a repliedToMessageId and passes it to enqueueOutboundMessage', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    findMessageById.mockResolvedValue({
      id: 'msg-original',
      conversationId: 'conv-1',
      content: 'Qual o valor?',
      whatsappMessageId: 'wamid.ORIG1',
    });
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-reply', status: 'sent' });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'R$150,00', repliedToMessageId: 'msg-original' });

    expect(res.status).toBe(201);
    expect(findMessageById).toHaveBeenCalledWith('msg-original');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'R$150,00',
      repliedToMessageId: 'msg-original',
    });
  });

  test('returns 400 when repliedToMessageId does not exist', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    findMessageById.mockResolvedValue(null);

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'R$150,00', repliedToMessageId: 'does-not-exist' });

    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('returns 400 when repliedToMessageId belongs to a different conversation', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    findMessageById.mockResolvedValue({
      id: 'msg-original',
      conversationId: 'conv-OTHER',
      content: 'Qual o valor?',
      whatsappMessageId: 'wamid.ORIG1',
    });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'R$150,00', repliedToMessageId: 'msg-original' });

    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('returns 400 when repliedToMessageId points to a message with no text content', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    findMessageById.mockResolvedValue({
      id: 'msg-original',
      conversationId: 'conv-1',
      content: null,
      whatsappMessageId: 'wamid.ORIG1',
    });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'R$150,00', repliedToMessageId: 'msg-original' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/text/i);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('returns 400 when repliedToMessageId points to a message not yet delivered', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    findMessageById.mockResolvedValue({
      id: 'msg-original',
      conversationId: 'conv-1',
      content: 'Ainda na fila',
      whatsappMessageId: null,
    });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'R$150,00', repliedToMessageId: 'msg-original' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/delivered/i);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('includes repliedToPreview in the response when the message was a reply', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    findMessageById.mockResolvedValue({
      id: 'msg-original',
      conversationId: 'conv-1',
      content: 'Qual o valor?',
      direction: 'inbound',
      whatsappMessageId: 'wamid.ORIG1',
    });
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-reply', status: 'sent' });

    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'R$150,00', repliedToMessageId: 'msg-original' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'msg-reply', status: 'sent', repliedToPreview: { content: 'Qual o valor?', direction: 'inbound' } });
  });
});

describe('POST /api/conversations/:id/transfer', () => {
  beforeEach(() => jest.clearAllMocks());

  test('transfers the conversation when the requester currently owns it', async () => {
    transferConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-2' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(res.status).toBe(200);
    expect(transferConversation).toHaveBeenCalledWith(CONVERSATION_ID, 'agent-1', 'agent-2');
    expect(res.body.assignedAgentId).toBe('agent-2');
  });

  test('returns 400 when toAgentId is missing', async () => {
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(transferConversation).not.toHaveBeenCalled();
  });

  test('returns 409 when the requester does not currently own the conversation', async () => {
    transferConversation.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(res.status).toBe(409);
  });

  test('notifies both the previous and new agent on a successful transfer', async () => {
    transferConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-2' });
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      assignedAgentId: 'agent-2',
      contactPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
    });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:removed', { conversationId: 'conv-1' });
    expect(emitToAgent).toHaveBeenCalledWith('agent-2', 'conversation:assigned', {
      conversation: {
        id: 'conv-1',
        assignedAgentId: 'agent-2',
        contactPhoneNumber: '+5511999998888',
        contactDisplayName: 'Cliente',
      },
    });
  });

  test('transfers a conversation that was still waiting in the queue, without requiring the caller to have claimed it', async () => {
    transferConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-2' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-2' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(res.status).toBe(200);
    expect(transferConversation).toHaveBeenCalledWith(CONVERSATION_ID, 'agent-1', 'agent-2');
  });

  test('also broadcasts dashboard:conversation on a successful transfer', async () => {
    transferConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-2' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-2' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(broadcastToDashboard).toHaveBeenCalledWith('dashboard:conversation', {
      conversation: { id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-2' },
    });
  });

  test('broadcasts queue:removed on every successful transfer, so the item disappears from everyone\'s queue if it was there', async () => {
    transferConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-2' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-2' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(broadcast).toHaveBeenCalledWith('queue:removed', { conversationId: 'conv-1' });
  });

  test('never calls sendOpeningMessageIfApplicable or sendClosingMessageIfApplicable', async () => {
    transferConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-2' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(sendOpeningMessageIfApplicable).not.toHaveBeenCalled();
    expect(sendClosingMessageIfApplicable).not.toHaveBeenCalled();
  });

  test('an admin can transfer a conversation assigned to a different agent', async () => {
    adminTransferConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-2' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ toAgentId: 'agent-2' });
    expect(res.status).toBe(200);
    expect(adminTransferConversation).toHaveBeenCalledWith(CONVERSATION_ID, 'agent-2');
    expect(transferConversation).not.toHaveBeenCalled();
  });

  test('does not emit conversation:removed to the admin performing the transfer, only conversation:assigned to the new agent', async () => {
    adminTransferConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-2' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-2' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ toAgentId: 'agent-2' });
    expect(emitToAgent).not.toHaveBeenCalledWith('admin-1', 'conversation:removed', expect.anything());
    expect(emitToAgent).toHaveBeenCalledWith('agent-2', 'conversation:assigned', {
      conversation: { id: 'conv-1', assignedAgentId: 'agent-2' },
    });
  });

  test('returns 409 when an admin tries to transfer a conversation that does not exist or is already closed', async () => {
    adminTransferConversation.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ toAgentId: 'agent-2' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/conversations/:id/close', () => {
  const REASON_ID = '33333333-3333-3333-3333-333333333333';
  const NON_EXISTENT_REASON_ID = '44444444-4444-4444-4444-444444444444';

  beforeEach(() => {
    jest.clearAllMocks();
    findReasonById.mockResolvedValue({ id: REASON_ID, name: 'Troca de senha', active: true });
  });

  test('closes an open conversation', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: REASON_ID });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
    expect(closeConversation).toHaveBeenCalledWith(CONVERSATION_ID, 'agent-1', REASON_ID);
  });

  test('closes a conversation without a reasonId, passing null through (quick-close from the queue)', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({});
    expect(res.status).toBe(200);
    expect(closeConversation).toHaveBeenCalledWith(CONVERSATION_ID, 'agent-1', null);
    expect(findReasonById).not.toHaveBeenCalled();
  });

  test('returns 400 when the reason does not exist', async () => {
    findReasonById.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: NON_EXISTENT_REASON_ID });
    expect(res.status).toBe(400);
    expect(closeConversation).not.toHaveBeenCalled();
  });

  test('returns 400 when the reason is inactive', async () => {
    findReasonById.mockResolvedValue({ id: REASON_ID, name: 'Antigo', active: false });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: REASON_ID });
    expect(res.status).toBe(400);
    expect(closeConversation).not.toHaveBeenCalled();
  });

  test('returns 400 and does not call findReasonById when reasonId is not a valid UUID', async () => {
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: 'not-a-uuid' });
    expect(res.status).toBe(400);
    expect(findReasonById).not.toHaveBeenCalled();
    expect(closeConversation).not.toHaveBeenCalled();
  });

  test('returns 409 when the conversation is not assigned to the caller, does not exist, or is already closed', async () => {
    closeConversation.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: REASON_ID });
    expect(res.status).toBe(409);
  });

  test('notifies the assigned agent when closing an assigned conversation', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: REASON_ID });
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:closed', { conversationId: 'conv-1' });
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('broadcasts queue:removed when closing a conversation that was never assigned', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: null });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: REASON_ID });
    expect(broadcast).toHaveBeenCalledWith('queue:removed', { conversationId: 'conv-1' });
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('also broadcasts dashboard:conversation with a closedAt timestamp on a successful close', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: REASON_ID });
    expect(broadcastToDashboard).toHaveBeenCalledWith(
      'dashboard:conversation',
      expect.objectContaining({
        conversation: { id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' },
        closedAt: expect.any(String),
      })
    );
  });

  test('calls sendClosingMessageIfApplicable with the closed conversation and agent id', async () => {
    const closedConversation = { id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1', channelId: 'channel-1', protocolNumber: 1042 };
    closeConversation.mockResolvedValue(closedConversation);
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: REASON_ID });
    expect(sendClosingMessageIfApplicable).toHaveBeenCalledWith(closedConversation, 'agent-1');
  });

  test('does not call sendClosingMessageIfApplicable when the close fails', async () => {
    closeConversation.mockResolvedValue(null);
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: REASON_ID });
    expect(sendClosingMessageIfApplicable).not.toHaveBeenCalled();
  });

  test('a failure inside sendClosingMessageIfApplicable does not break the 200 response', async () => {
    const closedConversation = { id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1', channelId: 'channel-1', protocolNumber: 1042 };
    closeConversation.mockResolvedValue(closedConversation);
    sendClosingMessageIfApplicable.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ reasonId: REASON_ID });
    expect(res.status).toBe(200);
  });

  test('an admin can close a conversation assigned to a different agent', async () => {
    adminCloseConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ reasonId: REASON_ID });
    expect(res.status).toBe(200);
    expect(adminCloseConversation).toHaveBeenCalledWith(CONVERSATION_ID, 'admin-1', REASON_ID);
    expect(closeConversation).not.toHaveBeenCalled();
  });

  test('notifies the originally assigned agent when an admin closes their conversation', async () => {
    adminCloseConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ reasonId: REASON_ID });
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:closed', { conversationId: 'conv-1' });
  });

  test('returns 409 when an admin tries to close a conversation that does not exist or is already closed', async () => {
    adminCloseConversation.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ reasonId: REASON_ID });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/conversations/start', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    baileysManager.fetchContactAvatarForChannel.mockResolvedValue(undefined);
  });

  const BAILEYS_CHANNEL = { id: 'channel-1', type: 'baileys', status: 'connected' };

  test('returns 400 when channelId, phoneNumber or content is missing', async () => {
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ phoneNumber: '5598999990000', content: 'Oi' });
    expect(res.status).toBe(400);
    expect(findChannelById).not.toHaveBeenCalled();
  });

  test('returns 400 when phoneNumber is not a string', async () => {
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: 5598999990000, content: 'Oi' });
    expect(res.status).toBe(400);
    expect(findChannelById).not.toHaveBeenCalled();
  });

  test('returns 404 when the channel id is not validly formatted', async () => {
    const dbError = new Error('invalid input syntax for type uuid');
    dbError.code = '22P02';
    findChannelById.mockRejectedValue(dbError);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'not-a-uuid', phoneNumber: '5598999990000', content: 'Oi' });
    expect(res.status).toBe(404);
  });

  test('returns 404 when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' });
    expect(res.status).toBe(404);
  });

  test('returns 400 when the channel is not a Baileys channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'sms', status: 'connected' });
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported channel type/i);
    expect(findOrCreateContactByPhoneNumber).not.toHaveBeenCalled();
  });

  test('returns 400 when the Baileys channel is not connected', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', status: 'awaiting_qr' });
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not connected/i);
  });

  test('returns 400 when the phone number has no digits after normalization', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '+++', content: 'Oi' });
    expect(res.status).toBe(400);
    expect(findOrCreateContactByPhoneNumber).not.toHaveBeenCalled();
  });

  test('returns 400 when the phone number is not registered on WhatsApp', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    baileysManager.resolveWhatsAppJid.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not.*whatsapp/i);
    expect(baileysManager.resolveWhatsAppJid).toHaveBeenCalledWith(BAILEYS_CHANNEL, '5598999990000');
    expect(findOrCreateContactByPhoneNumber).not.toHaveBeenCalled();
  });

  test('returns 409 when the contact already has an open (waiting) conversation on this channel', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    baileysManager.resolveWhatsAppJid.mockResolvedValue('5598999990000');
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5598999990000' });
    findOpenConversation.mockResolvedValue({ id: 'conv-existing', status: 'waiting' });
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '(55) 98 99999-0000', content: 'Oi' });
    expect(res.status).toBe(409);
    expect(createConversation).not.toHaveBeenCalled();
    expect(claimConversation).not.toHaveBeenCalled();
  });

  test('returns 409 when the contact already has an open (assigned) conversation on this channel', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    baileysManager.resolveWhatsAppJid.mockResolvedValue('5598999990000');
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5598999990000' });
    findOpenConversation.mockResolvedValue({ id: 'conv-existing', status: 'assigned' });
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '(55) 98 99999-0000', content: 'Oi' });
    expect(res.status).toBe(409);
    expect(createConversation).not.toHaveBeenCalled();
    expect(claimConversation).not.toHaveBeenCalled();
  });

  test('adopts a dormant silent conversation instead of creating a new one', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    baileysManager.resolveWhatsAppJid.mockResolvedValue('5598999990000');
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5598999990000' });
    findOpenConversation.mockResolvedValue({ id: 'conv-silent', status: 'silent' });
    claimConversation.mockResolvedValue({
      id: 'conv-silent',
      contactId: 'contact-1',
      channelId: 'channel-1',
      assignedAgentId: 'agent-1',
    });
    getConversationWithContact.mockResolvedValue({
      id: 'conv-silent',
      contactId: 'contact-1',
      channelId: 'channel-1',
      assignedAgentId: 'agent-1',
      contactPhoneNumber: '5598999990000',
      contactDisplayName: null,
    });

    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '(55) 98 99999-0000', content: 'Oi, tudo bem?' });

    expect(res.status).toBe(201);
    expect(createConversation).not.toHaveBeenCalled();
    expect(claimConversation).toHaveBeenCalledWith('conv-silent', 'agent-1');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-silent',
      channelId: 'channel-1',
      content: 'Oi, tudo bem?',
    });
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:assigned', {
      conversation: expect.objectContaining({ id: 'conv-silent' }),
    });
    expect(res.body).toEqual(expect.objectContaining({ id: 'conv-silent' }));
  });

  test('returns 409 when adopting a silent conversation races and someone else claims it first', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    baileysManager.resolveWhatsAppJid.mockResolvedValue('5598999990000');
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5598999990000' });
    findOpenConversation.mockResolvedValue({ id: 'conv-silent', status: 'silent' });
    claimConversation.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' });

    expect(res.status).toBe(409);
    expect(createConversation).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('creates, claims and enqueues the first message on the happy path, using the canonical number WhatsApp reports', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    // The attendant types a number with the extra 9th digit; WhatsApp reports back
    // the canonical form without it — the route must use WhatsApp's version, not the raw input.
    baileysManager.resolveWhatsAppJid.mockResolvedValue('559899990000');
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '559899990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1' });
    claimConversation.mockResolvedValue({
      id: CONVERSATION_ID,
      contactId: 'contact-1',
      channelId: 'channel-1',
      assignedAgentId: 'agent-1',
    });
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      contactId: 'contact-1',
      channelId: 'channel-1',
      assignedAgentId: 'agent-1',
      contactPhoneNumber: '559899990000',
      contactDisplayName: null,
    });

    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '(55) 98 99999-0000', content: 'Oi, tudo bem?' });

    expect(res.status).toBe(201);
    expect(baileysManager.resolveWhatsAppJid).toHaveBeenCalledWith(BAILEYS_CHANNEL, '5598999990000');
    expect(findOrCreateContactByPhoneNumber).toHaveBeenCalledWith('559899990000', null);
    expect(findOpenConversation).toHaveBeenCalledWith('contact-1', 'channel-1');
    expect(createConversation).toHaveBeenCalledWith('contact-1', 'channel-1');
    expect(claimConversation).toHaveBeenCalledWith(CONVERSATION_ID, 'agent-1');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      channelId: 'channel-1',
      content: 'Oi, tudo bem?',
    });
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:assigned', {
      conversation: expect.objectContaining({ id: CONVERSATION_ID }),
    });
    expect(res.body).toEqual(expect.objectContaining({ id: CONVERSATION_ID, contactPhoneNumber: '559899990000' }));
  });

  test('calls sendOpeningMessageIfApplicable before enqueuing the typed content, on the happy path', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    baileysManager.resolveWhatsAppJid.mockResolvedValue('559899990000');
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '559899990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1' });
    const claimedConversation = { id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1', assignedAgentId: 'agent-1', protocolNumber: null };
    claimConversation.mockResolvedValue(claimedConversation);
    getConversationWithContact.mockResolvedValue({ ...claimedConversation, contactPhoneNumber: '559899990000' });

    const callOrder = [];
    sendOpeningMessageIfApplicable.mockImplementation(async () => { callOrder.push('opening'); });
    enqueueOutboundMessage.mockImplementation(async () => { callOrder.push('enqueue'); return { id: 'msg-1' }; });

    await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi, tudo bem?' });

    expect(sendOpeningMessageIfApplicable).toHaveBeenCalledWith(claimedConversation, 'agent-1');
    expect(callOrder).toEqual(['opening', 'enqueue']);
  });

  test('also broadcasts dashboard:conversation on the happy path', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    baileysManager.resolveWhatsAppJid.mockResolvedValue('559899990000');
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '559899990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-1', channelId: 'channel-1' });
    claimConversation.mockResolvedValue({
      id: CONVERSATION_ID,
      contactId: 'contact-1',
      channelId: 'channel-1',
      assignedAgentId: 'agent-1',
    });
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      contactId: 'contact-1',
      channelId: 'channel-1',
      assignedAgentId: 'agent-1',
      contactPhoneNumber: '559899990000',
      contactDisplayName: null,
    });

    await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi, tudo bem?' });

    expect(broadcastToDashboard).toHaveBeenCalledWith('dashboard:conversation', {
      conversation: expect.objectContaining({ id: CONVERSATION_ID }),
    });
  });

  test('fires off a fire-and-forget avatar fetch when the contact was just created on a Baileys channel', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    baileysManager.resolveWhatsAppJid.mockResolvedValue('559899990001');
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-new-1', phoneNumber: '559899990001', wasCreated: true });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-new-1', channelId: 'channel-1' });
    claimConversation.mockResolvedValue({
      id: CONVERSATION_ID,
      contactId: 'contact-new-1',
      channelId: 'channel-1',
      assignedAgentId: 'agent-1',
    });
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      contactId: 'contact-new-1',
      channelId: 'channel-1',
      assignedAgentId: 'agent-1',
      contactPhoneNumber: '559899990001',
      contactDisplayName: null,
    });

    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '559899990001', content: 'Oi' });

    expect(res.status).toBe(201);
    expect(baileysManager.fetchContactAvatarForChannel).toHaveBeenCalledWith(BAILEYS_CHANNEL, 'contact-new-1', '559899990001');
  });

  test('also asks the adapter to re-check the avatar when the contact already existed (adapter throttles)', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    baileysManager.resolveWhatsAppJid.mockResolvedValue('559899990002');
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-2', phoneNumber: '559899990002', wasCreated: false });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: CONVERSATION_ID, contactId: 'contact-2', channelId: 'channel-1' });
    claimConversation.mockResolvedValue({
      id: CONVERSATION_ID,
      contactId: 'contact-2',
      channelId: 'channel-1',
      assignedAgentId: 'agent-1',
    });
    getConversationWithContact.mockResolvedValue({
      id: CONVERSATION_ID,
      contactId: 'contact-2',
      channelId: 'channel-1',
      assignedAgentId: 'agent-1',
      contactPhoneNumber: '559899990002',
      contactDisplayName: null,
    });

    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', phoneNumber: '559899990002', content: 'Oi' });

    expect(res.status).toBe(201);
    expect(baileysManager.fetchContactAvatarForChannel).toHaveBeenCalledWith(BAILEYS_CHANNEL, 'contact-2', '559899990002');
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .send({ channelId: 'channel-1', phoneNumber: '5598999990000', content: 'Oi' });
    expect(res.status).toBe(401);
    expect(findChannelById).not.toHaveBeenCalled();
  });
});

describe('POST /start (meta_cloud)', () => {
  beforeEach(() => jest.clearAllMocks());

  const approvedTemplate = { id: 'tpl-1', wabaId: 'waba-1', name: 'fatura_vencida', language: 'pt_BR', bodyText: 'Olá {{1}}, sua fatura de {{2}} venceu.', variableCount: 2, status: 'APPROVED' };

  test('returns 400 when templateId is missing', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when the template does not exist', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'missing' });
    expect(res.status).toBe(404);
  });

  test('returns 400 when the template is not approved', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue({ ...approvedTemplate, status: 'PENDING' });
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150'] });
    expect(res.status).toBe(400);
  });

  test('returns 400 when the template belongs to a different WABA than the channel', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-OTHER' } });
    findTemplateById.mockResolvedValue(approvedTemplate);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150'] });
    expect(res.status).toBe(400);
  });

  test('returns 400 when the variable count does not match', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue(approvedTemplate);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João'] });
    expect(res.status).toBe(400);
  });

  test('returns 400 when a variable is not a non-empty string', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue(approvedTemplate);
    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', '  '] });
    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('starts the conversation, substitutes variables, and enqueues the template send', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue(approvedTemplate);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5511999990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-1' });
    claimConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });

    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150,00'] });

    expect(res.status).toBe(201);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1', channelId: 'ch-1',
      content: 'Olá João, sua fatura de R$150,00 venceu.',
      templateName: 'fatura_vencida', templateLanguage: 'pt_BR', templateVariables: ['João', 'R$150,00'],
    });
  });

  test('does not call baileysManager.resolveWhatsAppJid for a meta_cloud channel', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue(approvedTemplate);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5511999990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-1' });
    claimConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });

    await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150,00'] });

    expect(baileysManager.resolveWhatsAppJid).not.toHaveBeenCalled();
  });

  test('does not dispatch the assignment opening message for a meta_cloud channel', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue(approvedTemplate);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5511999990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-1' });
    claimConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });

    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150,00'] });

    expect(res.status).toBe(201);
    expect(sendOpeningMessageIfApplicable).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).toHaveBeenCalled();
  });

  test('accepts a 360dialog channel in the type gate, same as meta_cloud', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: '360dialog', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue(approvedTemplate);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5511999990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-1' });
    claimConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });

    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150,00'] });

    expect(res.status).toBe(201);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1', channelId: 'ch-1',
      content: 'Olá João, sua fatura de R$150,00 venceu.',
      templateName: 'fatura_vencida', templateLanguage: 'pt_BR', templateVariables: ['João', 'R$150,00'],
    });
  });

  test('does not dispatch the assignment opening message for a 360dialog channel', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: '360dialog', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue(approvedTemplate);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1', phoneNumber: '5511999990000' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-1' });
    claimConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });

    const res = await request(buildApp())
      .post('/api/conversations/start')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'ch-1', phoneNumber: '5511999990000', templateId: 'tpl-1', templateVariables: ['João', 'R$150,00'] });

    expect(res.status).toBe(201);
    expect(sendOpeningMessageIfApplicable).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).toHaveBeenCalled();
  });
});
