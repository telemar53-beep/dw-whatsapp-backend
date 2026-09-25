jest.mock('../integrations/sgp-integration.repository');
jest.mock('../channels/channel.repository');
jest.mock('../templates/template.repository');
jest.mock('../conversations/contact.repository');
jest.mock('../conversations/dispatch-contact');
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
const { resolverContatoDoDisparo } = require('../conversations/dispatch-contact');
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
// Fase 1B: todo disparo do SGP ganha metadata de origem. No texto livre o conteúdo segue cru
// para o cliente, então nada é extraído dele: tipo desconhecido.
const METADATA_FREETEXT = { origem: 'sgp', gatewayId: 'gw-baileys', modo: 'freetext', tipo: 'desconhecido' };

describe('GET /api/integrations/sgp/messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findSgpDispatchByReferenceId.mockResolvedValue(null);
    findChannelById.mockResolvedValue(CHANNEL);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    resolverContatoDoDisparo.mockResolvedValue({ id: 'contact-1' });
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
      verifySgpApiKey.mockResolvedValue({ status: 'ok', integrationId: 'gw-baileys', channelId: 'channel-1', mode: 'freetext' });
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
        metadata: METADATA_FREETEXT,
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
      // Fase 1A: o Baileys já pergunta ao WhatsApp pelas duas formas do nono dígito
      // (resolveWhatsAppJid); a escolha de contato do disparo da Meta não entra aqui.
      expect(resolverContatoDoDisparo).not.toHaveBeenCalled();
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
        metadata: METADATA_FREETEXT,
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
        metadata: METADATA_FREETEXT,
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
    // Production shape: `channels.status` defaults to 'disconnected' and only Baileys ever writes
    // 'connected', so a meta_cloud channel is permanently 'disconnected'. Mocking it that way is what
    // makes "without checking channel connectivity" an assertion instead of a coincidence.
    const TEMPLATE_CHANNEL = { id: 'channel-2', type: 'meta_cloud', status: 'disconnected', config: { phoneNumberId: '999', accessToken: 'tok', wabaId: 'waba-1' } };
    // status e purpose sao NOT NULL na tabela: uma fixture sem eles nao existe em
    // producao, e era so por isso que o caminho passava sem conferir aprovacao.
    const TEMPLATE = { id: 'tpl-1', name: 'aviso_cobranca', language: 'pt_BR', variableCount: 2, headerType: null, status: 'APPROVED', purpose: 'disparo', bodyText: 'Olá, {{1}}! Valor: {{2}}' };
    // Fase 1B: o que a Meta recebe continua IDÊNTICO; o que muda é só o registro da mensagem —
    // o texto montado para a atendente e a metadata de origem.
    const metadataTemplate = (extra = {}) => ({
      origem: 'sgp', gatewayId: 'gw-meta', modo: 'template', template: 'aviso_cobranca', textoModelo: 'Olá, {{1}}! Valor: {{2}}', tipo: 'desconhecido', ...extra,
    });

    beforeEach(() => {
      verifySgpApiKey.mockResolvedValue({ status: 'ok', integrationId: 'gw-meta', channelId: 'channel-2', mode: 'template', defaultTemplateId: null });
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
        conversationId: 'conv-1', channelId: 'channel-2', content: 'Olá, João! Valor: 150,00',
        templateName: 'aviso_cobranca', templateLanguage: 'pt_BR', templateVariables: ['João', '150,00'],
        headerType: null, headerLink: null,
        metadata: metadataTemplate(),
      });
      expect(res.status).toBe(200);
    });

    // Fase 1A (25/09/2026): o SGP manda o celular com o 9 e a Meta devolve a resposta com o
    // wa_id sem o 9 (DDD 98). O contato do disparo sai do resolvedor que considera as duas
    // formas e o histórico próprio — e o que vai para a Meta continua idêntico.
    test('Fase 1A: o contato do disparo sai do resolvedor do nono dígito, com o número do SGP', async () => {
      resolverContatoDoDisparo.mockResolvedValue({ id: 'contato-real-sem-9', phoneNumber: '559899990000' });

      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ phoneNumber: '5598999990000', content: 'variables=João|150,00||template=aviso_cobranca', token: 'the-key' });

      expect(res.status).toBe(200);
      expect(resolverContatoDoDisparo).toHaveBeenCalledWith('5598999990000', null, 'channel-2');
      expect(findOrCreateContactByPhoneNumber).not.toHaveBeenCalled();
      expect(findOpenConversation).toHaveBeenCalledWith('contato-real-sem-9', 'channel-2');
      expect(createConversation).toHaveBeenCalledWith('contato-real-sem-9', 'channel-2', null, 'silent');
      // O pacote enfileirado para a Meta é o mesmo de antes da Fase 1A, campo por campo.
      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-1', channelId: 'channel-2', content: 'Olá, João! Valor: 150,00',
        templateName: 'aviso_cobranca', templateLanguage: 'pt_BR', templateVariables: ['João', '150,00'],
        headerType: null, headerLink: null,
        metadata: metadataTemplate(),
      });
    });

    describe('Fase 1B — disparo automático como fato', () => {
      // O template real de hoje, com o texto aprovado na Meta.
      const DW_FATURA = {
        id: 'tpl-dw', name: 'dw_fatura_mensal', language: 'pt_BR', variableCount: 4, headerType: null, status: 'APPROVED', purpose: 'disparo',
        bodyText: 'Olá, {{1}}! Sua fatura da DW Telecom está disponível.\n\nValor: {{2}}\nVencimento: {{3}}\nBoleto: {{4}}\n\nQualquer dúvida sobre o pagamento, fale com a nossa central de atendimento pelo 0800 445 4546.',
      };
      const VARIAVEIS = ['Maria', 'R$ 100,00', '30/09/2026', 'https://boleto.exemplo/abc'];
      const ANTIGO = `variables=${VARIAVEIS.join('|')}||template=dw_fatura_mensal`;
      // O que a Meta recebe, campo a campo — o mesmo de antes da Fase 1B.
      const CAMPOS_DA_META = { templateName: 'dw_fatura_mensal', templateLanguage: 'pt_BR', templateVariables: VARIAVEIS, headerType: null, headerLink: null };

      beforeEach(() => findTemplateByNameAndWaba.mockResolvedValue(DW_FATURA));
      const disparar = (content, extra = {}) => request(buildApp()).get('/api/integrations/sgp/messages').query({ phoneNumber: '5598999990000', content, token: 'the-key', ...extra });
      const enfileirado = () => enqueueOutboundMessage.mock.calls[0][0];

      test('A. formato antigo: aceito; os campos da Meta idênticos; o texto montado vai para o registro', async () => {
        const res = await disparar(ANTIGO);
        expect(res.status).toBe(200);
        const job = enfileirado();
        expect(job).toMatchObject(CAMPOS_DA_META);
        expect(job.content).toBe('Olá, Maria! Sua fatura da DW Telecom está disponível.\n\nValor: R$ 100,00\nVencimento: 30/09/2026\nBoleto: https://boleto.exemplo/abc\n\nQualquer dúvida sobre o pagamento, fale com a nossa central de atendimento pelo 0800 445 4546.');
        expect(job.metadata).toEqual({ origem: 'sgp', gatewayId: 'gw-meta', modo: 'template', template: 'dw_fatura_mensal', textoModelo: DW_FATURA.bodyText, tipo: 'desconhecido' });
      });

      test('B. campos novos válidos entram na metadata; os campos da Meta continuam idênticos', async () => {
        const res = await disparar(`${ANTIGO}||tipo=fatura_disponivel||vencimento=30/09/2026||fatura=123||contrato=456`);
        expect(res.status).toBe(200);
        expect(enfileirado()).toMatchObject(CAMPOS_DA_META);
        expect(enfileirado().metadata).toMatchObject({ tipo: 'fatura_disponivel', vencimento: '30/09/2026', faturaId: '123', contratoId: '456' });
      });

      test('C. campos novos inválidos são descartados um a um e o disparo sai do mesmo jeito', async () => {
        const res = await disparar(`${ANTIGO}||tipo=cobranca_vencida||vencimento=31/02/2026||fatura=abc||contrato={contrato}||cor=azul`);
        expect(res.status).toBe(200);
        expect(enfileirado()).toMatchObject(CAMPOS_DA_META);
        const { metadata } = enfileirado();
        expect(metadata.tipo).toBe('desconhecido');
        for (const k of ['vencimento', 'faturaId', 'contratoId', 'cor']) expect(metadata).not.toHaveProperty(k);
      });

      test('a metadata nunca leva valor, link nem nome do cliente', async () => {
        await disparar(`${ANTIGO}||tipo=fatura_disponivel||vencimento=30/09/2026`);
        const texto = JSON.stringify(enfileirado().metadata);
        for (const proibido of ['Maria', 'R$ 100,00', 'https://boleto.exemplo']) expect(texto).not.toContain(proibido);
      });

      test('referenceId do SGP entra na metadata', async () => {
        await disparar(ANTIGO, { referenceId: 'ref-77' });
        expect(enfileirado().metadata.referenciaSgp).toBe('ref-77');
      });

      test('template sem corpo cadastrado: registro sem texto, como antes — o envio não depende disso', async () => {
        findTemplateByNameAndWaba.mockResolvedValue({ ...DW_FATURA, bodyText: null });
        const res = await disparar(ANTIGO);
        expect(res.status).toBe(200);
        expect(enfileirado()).toMatchObject({ ...CAMPOS_DA_META, content: null });
      });

      test('H. o disparo continua criando conversa silent, sem triagem (a 1B sozinha não liga nada)', async () => {
        await disparar(ANTIGO);
        expect(createConversation).toHaveBeenCalledWith('contact-1', 'channel-2', null, 'silent');
      });
    });

    test('sends a template message with a header when the payload includes one and it matches the template', async () => {
      findTemplateByNameAndWaba.mockResolvedValue({ ...TEMPLATE, name: 'aviso_com_anexo', variableCount: 1, headerType: 'document' });

      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ phoneNumber: '5598999990000', content: 'variables=João||header_link=https://boleto.link/x.pdf||header_type=document||template=aviso_com_anexo', token: 'the-key' });

      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-1', channelId: 'channel-2', content: 'Olá, João! Valor: {{2}}',
        templateName: 'aviso_com_anexo', templateLanguage: 'pt_BR', templateVariables: ['João'],
        headerType: 'document', headerLink: 'https://boleto.link/x.pdf',
        metadata: metadataTemplate({ template: 'aviso_com_anexo' }),
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

    test('returns 400 and does not enqueue when the template is not APPROVED', async () => {
      findTemplateByNameAndWaba.mockResolvedValue({ ...TEMPLATE, status: 'PAUSED' });
      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ phoneNumber: '5598999990000', content: 'variables=João|150,00||template=aviso_cobranca', token: 'the-key' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/approv/i);
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('returns 400 and does not enqueue when the template purpose is not "disparo"', async () => {
      findTemplateByNameAndWaba.mockResolvedValue({ ...TEMPLATE, purpose: 'atendimento' });
      const res = await request(buildApp())
        .get('/api/integrations/sgp/messages')
        .query({ phoneNumber: '5598999990000', content: 'variables=João|150,00||template=aviso_cobranca', token: 'the-key' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/dispatch/i);
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
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
