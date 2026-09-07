jest.mock('../integrations/sgp-integration.repository');
jest.mock('../channels/channel.repository');
jest.mock('../templates/template.repository');
jest.mock('../conversations/contact.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../queue/outbound-queue');
jest.mock('../whatsapp-adapters/baileys.manager');
jest.mock('../realtime/socket-server');
const request = require('supertest');
const express = require('express');
const {
  verifySgpApiKey,
  findSgpDispatchByReferenceId,
  createSgpDispatch,
} = require('../integrations/sgp-integration.repository');
const { findChannelById } = require('../channels/channel.repository');
const { findTemplateByNameAndWaba } = require('../templates/template.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findOpenConversation, createConversation, getConversationWithContact } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { emitToAgent } = require('../realtime/socket-server');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const integrationsSgpRoutes = require('./integrations-sgp.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations/sgp', integrationsSgpRoutes);
  return app;
}

const CHANNEL = { id: 'channel-1', type: 'baileys', status: 'connected' };
const VALID_QUERY = { phoneNumber: '5598999990000', content: 'Seu boleto vence em 10/09', token: 'the-key' };

describe('GET /api/integrations/sgp/messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findSgpDispatchByReferenceId.mockResolvedValue(null);
    findChannelById.mockResolvedValue(CHANNEL);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-1', status: 'silent' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-1' });
    createSgpDispatch.mockResolvedValue({ id: 'dispatch-1', referenceId: 'boleto-1', conversationId: 'conv-1', messageId: 'msg-1' });
    baileysManager.resolveWhatsAppJid.mockResolvedValue('5598999990000');
  });

  test('returns 401 when the token query param is missing', async () => {
    const res = await request(buildApp())
      .get('/api/integrations/sgp/messages')
      .query({ phoneNumber: VALID_QUERY.phoneNumber, content: VALID_QUERY.content });
    expect(res.status).toBe(401);
    expect(verifySgpApiKey).not.toHaveBeenCalled();
  });

  test('returns 401 when the token is invalid', async () => {
    verifySgpApiKey.mockResolvedValue({ status: 'invalid' });
    const res = await request(buildApp()).get('/api/integrations/sgp/messages').query({ ...VALID_QUERY, token: 'wrong-key' });
    expect(res.status).toBe(401);
    expect(verifySgpApiKey).toHaveBeenCalledWith('wrong-key');
  });

  test('returns 400 when the integration is not configured', async () => {
    verifySgpApiKey.mockResolvedValue({ status: 'not_configured' });
    const res = await request(buildApp()).get('/api/integrations/sgp/messages').query(VALID_QUERY);
    expect(res.status).toBe(400);
  });

  test('returns 400 when the integration is disabled', async () => {
    verifySgpApiKey.mockResolvedValue({ status: 'disabled' });
    const res = await request(buildApp()).get('/api/integrations/sgp/messages').query(VALID_QUERY);
    expect(res.status).toBe(400);
  });

  describe('with a valid token', () => {
    beforeEach(() => {
      verifySgpApiKey.mockResolvedValue({ status: 'ok', channelId: 'channel-1' });
    });

    test('returns 400 when phoneNumber is missing', async () => {
      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ content: 'Oi', token: 'the-key' });
      expect(res.status).toBe(400);
      expect(findChannelById).not.toHaveBeenCalled();
    });

    test('returns 400 when content is missing', async () => {
      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ phoneNumber: '5598999990000', token: 'the-key' });
      expect(res.status).toBe(400);
    });

    test('sends successfully with no referenceId at all (the real SGP shape)', async () => {
      const res = await request(buildApp()).get('/api/integrations/sgp/messages').query(VALID_QUERY);

      expect(findSgpDispatchByReferenceId).not.toHaveBeenCalled();
      expect(createSgpDispatch).not.toHaveBeenCalled();
      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        channelId: 'channel-1',
        content: 'Seu boleto vence em 10/09',
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ conversationId: 'conv-1', messageId: 'msg-1' });
    });

    test('returns 200 without resending when an explicit referenceId was already processed', async () => {
      findSgpDispatchByReferenceId.mockResolvedValue({
        id: 'dispatch-1',
        referenceId: 'boleto-1',
        conversationId: 'conv-existing',
        messageId: 'msg-existing',
      });

      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ ...VALID_QUERY, referenceId: 'boleto-1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ conversationId: 'conv-existing', messageId: 'msg-existing', duplicate: true });
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('records the dispatch when an explicit referenceId is provided', async () => {
      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ ...VALID_QUERY, referenceId: 'boleto-1' });

      expect(createSgpDispatch).toHaveBeenCalledWith({ referenceId: 'boleto-1', conversationId: 'conv-1', messageId: 'msg-1' });
      expect(res.status).toBe(200);
    });

    test('returns 400 when the configured channel is not connected', async () => {
      findChannelById.mockResolvedValue({ ...CHANNEL, status: 'awaiting_qr' });
      const res = await request(buildApp()).get('/api/integrations/sgp/messages').query(VALID_QUERY);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not connected/i);
    });

    test('returns 400 when the phone number is not registered on WhatsApp', async () => {
      baileysManager.resolveWhatsAppJid.mockResolvedValue(null);
      const res = await request(buildApp()).get('/api/integrations/sgp/messages').query(VALID_QUERY);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not.*whatsapp/i);
      expect(findOrCreateContactByPhoneNumber).not.toHaveBeenCalled();
    });

    test('creates a new silent conversation when none is open and sends the message', async () => {
      const res = await request(buildApp()).get('/api/integrations/sgp/messages').query(VALID_QUERY);

      expect(baileysManager.resolveWhatsAppJid).toHaveBeenCalledWith(CHANNEL, '5598999990000');
      expect(findOrCreateContactByPhoneNumber).toHaveBeenCalledWith('5598999990000', null);
      expect(createConversation).toHaveBeenCalledWith('contact-1', 'channel-1', null, 'silent');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ conversationId: 'conv-1', messageId: 'msg-1' });
    });

    test('reuses an existing open conversation instead of creating a new one', async () => {
      findOpenConversation.mockResolvedValue({ id: 'conv-existing', status: 'waiting' });

      const res = await request(buildApp()).get('/api/integrations/sgp/messages').query(VALID_QUERY);

      expect(createConversation).not.toHaveBeenCalled();
      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-existing',
        channelId: 'channel-1',
        content: 'Seu boleto vence em 10/09',
      });
      expect(res.status).toBe(200);
    });

    test('falls back to the existing conversation when createConversation races on a unique violation', async () => {
      const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
      createConversation.mockRejectedValue(uniqueViolation);
      findOpenConversation.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'conv-race', status: 'silent' });

      const res = await request(buildApp()).get('/api/integrations/sgp/messages').query(VALID_QUERY);

      expect(findOpenConversation).toHaveBeenCalledTimes(2);
      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-race',
        channelId: 'channel-1',
        content: 'Seu boleto vence em 10/09',
      });
      expect(res.status).toBe(200);
    });

    test('falls back to sending anyway when createSgpDispatch races on a unique violation for the same referenceId', async () => {
      const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
      createSgpDispatch.mockRejectedValue(uniqueViolation);

      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ ...VALID_QUERY, referenceId: 'boleto-1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ conversationId: 'conv-1', messageId: 'msg-1' });
    });

    test('emits message:new to the assigned agent when reusing an already-assigned conversation', async () => {
      findOpenConversation.mockResolvedValue({ id: 'conv-assigned', status: 'assigned', assignedAgentId: 'agent-9' });
      getConversationWithContact.mockResolvedValue({ id: 'conv-assigned', assignedAgentId: 'agent-9' });

      await request(buildApp()).get('/api/integrations/sgp/messages').query(VALID_QUERY);

      expect(emitToAgent).toHaveBeenCalledWith('agent-9', 'message:new', {
        conversation: { id: 'conv-assigned', assignedAgentId: 'agent-9' },
        message: { id: 'msg-1' },
      });
    });

    test('does not emit anything when the reused conversation has no assigned agent', async () => {
      findOpenConversation.mockResolvedValue({ id: 'conv-silent', status: 'silent', assignedAgentId: null });

      await request(buildApp()).get('/api/integrations/sgp/messages').query(VALID_QUERY);

      expect(emitToAgent).not.toHaveBeenCalled();
      expect(getConversationWithContact).not.toHaveBeenCalled();
    });
  });

  describe('with a valid token for a template-mode integration', () => {
    const TEMPLATE_CHANNEL = { id: 'channel-2', type: 'meta_cloud', status: 'connected', config: { phoneNumberId: '999', accessToken: 'tok', wabaId: 'waba-1' } };
    const TEMPLATE = { id: 'tpl-1', name: 'aviso_cobranca', language: 'pt_BR', variableCount: 2, headerType: null };

    beforeEach(() => {
      verifySgpApiKey.mockResolvedValue({ status: 'ok', channelId: 'channel-2', mode: 'template', defaultTemplateId: null });
      findChannelById.mockResolvedValue(TEMPLATE_CHANNEL);
      findTemplateByNameAndWaba.mockResolvedValue(TEMPLATE);
    });

    test('sends a template message with parsed variables, without checking channel connectivity or resolveWhatsAppJid', async () => {
      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ phoneNumber: '5598999990000', content: 'variables=João|150,00||template=aviso_cobranca', token: 'the-key' });

      expect(baileysManager.resolveWhatsAppJid).not.toHaveBeenCalled();
      expect(findTemplateByNameAndWaba).toHaveBeenCalledWith('aviso_cobranca', 'waba-1');
      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-1', channelId: 'channel-2', content: null,
        templateName: 'aviso_cobranca', templateLanguage: 'pt_BR', templateVariables: ['João', '150,00'],
        headerType: null, headerLink: null,
      });
      expect(res.status).toBe(200);
    });

    test('sends a template message with a header when the payload includes one and it matches the template', async () => {
      findTemplateByNameAndWaba.mockResolvedValue({ ...TEMPLATE, name: 'aviso_com_anexo', variableCount: 1, headerType: 'document' });

      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ phoneNumber: '5598999990000', content: 'variables=João||header_link=https://boleto.link/x.pdf||header_type=document||template=aviso_com_anexo', token: 'the-key' });

      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-1', channelId: 'channel-2', content: null,
        templateName: 'aviso_com_anexo', templateLanguage: 'pt_BR', templateVariables: ['João'],
        headerType: 'document', headerLink: 'https://boleto.link/x.pdf',
      });
      expect(res.status).toBe(200);
    });

    test('returns 400 when the content is not a valid template payload', async () => {
      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ phoneNumber: '5598999990000', content: 'isso não é o formato certo', token: 'the-key' });
      expect(res.status).toBe(400);
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('returns 400 when the template name is not found', async () => {
      findTemplateByNameAndWaba.mockResolvedValue(null);
      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ phoneNumber: '5598999990000', content: 'variables=João|150,00||template=nao_existe', token: 'the-key' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not found/i);
    });

    test('returns 400 when the variable count does not match', async () => {
      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ phoneNumber: '5598999990000', content: 'variables=SóUmaVariavel||template=aviso_cobranca', token: 'the-key' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/variable/i);
    });

    test('returns 400 when the header_type in the payload does not match the registered template', async () => {
      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ phoneNumber: '5598999990000', content: 'variables=João|150,00||header_link=https://x.pdf||header_type=image||template=aviso_cobranca', token: 'the-key' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/header/i);
    });
  });
});
