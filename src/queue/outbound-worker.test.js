// Rede-nenhuma como rede de segurança: os testes de Pix dinâmico já
// sobrescrevem resolverRecebedorPix caso a caso, mas se um teste futuro
// esquecer disso isso evita uma chamada HTTPS real saindo do CI.
jest.mock('axios');
jest.mock('./outbound-queue');
jest.mock('../channels/channel.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/message.repository');
jest.mock('../conversations/contact.repository');
jest.mock('../whatsapp-adapters/meta-cloud.adapter');
jest.mock('../whatsapp-adapters/baileys.manager');
jest.mock('../whatsapp-adapters/three-sixty-dialog.adapter');
jest.mock('../realtime/socket-server');
jest.mock('../company/company-config.repository');
// Recebedor real por padrão (as mesmas contas puras de sempre, sem rede) -
// só os testes de resolução dinâmica sobrescrevem resolverRecebedorPix por
// vez; assim o resto da suíte de Pix continua lendo os códigos EMV de
// verdade, sem precisar simular cada um deles.
jest.mock('../payments/pix-emv', () => {
  const real = jest.requireActual('../payments/pix-emv');
  return {
    lerRecebedorDoPix: jest.fn(real.lerRecebedorDoPix),
    resolverRecebedorPix: jest.fn(real.resolverRecebedorPix),
  };
});

const { processOutboundQueue, enqueueOutboundMessage } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById, recordMessageSent, markPixFallbackSent, markMessageFailed, recordMessageWaId } = require('../conversations/message.repository');
const { renameGhostContactToWaId } = require('../conversations/contact.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { lerRecebedorDoPix, resolverRecebedorPix } = require('../payments/pix-emv');
const { getCompanyConfig } = require('../company/company-config.repository');
const { cartaoPix } = require('../payments/payment-card');
const { startOutboundWorker } = require('./outbound-worker');

describe('startOutboundWorker', () => {
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
    findMessageById.mockResolvedValue(null);
    processOutboundQueue.mockImplementation((h) => {
      handler = h;
    });
    startOutboundWorker();
  });

  test('sends via the Meta Cloud adapter when the channel type is meta_cloud', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({
      id: 'channel-1',
      type: 'meta_cloud',
      config: { phoneNumberId: '123', accessToken: 'tok' },
    });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola cliente' });

    expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok' } },
      '5511999998888',
      'Ola cliente'
    );
    expect(baileysManager.sendTextMessage).not.toHaveBeenCalled();
    expect(recordMessageSent).toHaveBeenCalledWith('msg-1', 'wamid.OUT1');
    expect(markMessageFailed).not.toHaveBeenCalled();
  });

  test('sends via the Baileys manager when the channel type is baileys', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-2', contactPhoneNumber: '5511999997777' });
    findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
    baileysManager.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'BAILEYS_OUT_1' });

    await handler({ messageId: 'msg-2', conversationId: 'conv-2', channelId: 'channel-2', content: 'Ola cliente' });

    expect(baileysManager.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-2', type: 'baileys', config: {} },
      '5511999997777',
      'Ola cliente'
    );
    expect(metaCloudAdapter.sendTextMessage).not.toHaveBeenCalled();
    expect(recordMessageSent).toHaveBeenCalledWith('msg-2', 'BAILEYS_OUT_1');
  });

  test('sends via the 360dialog adapter when the channel type is 360dialog', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-3', type: '360dialog', config: { apiKey: 'key-1', wabaId: 'waba-1' } });
    threeSixtyDialogAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'D360_OUT_1' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888', assignedAgentId: null });
    recordMessageSent.mockResolvedValue({ id: 'msg-1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-3', content: 'Ola' });

    expect(threeSixtyDialogAdapter.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-3', type: '360dialog', config: { apiKey: 'key-1', wabaId: 'waba-1' } },
      '5511999998888',
      'Ola'
    );
    expect(metaCloudAdapter.sendTextMessage).not.toHaveBeenCalled();
    expect(baileysManager.sendTextMessage).not.toHaveBeenCalled();
  });

  test('marks the message failed with the error message as motivo and rethrows when sending fails', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockRejectedValue(new Error('network error'));
    const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handler({ messageId: 'msg-3', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(markMessageFailed).toHaveBeenCalledWith('msg-3', 'network error');
    expect(recordMessageSent).not.toHaveBeenCalled();
    const logado = erro.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logado).toContain('Outbound message msg-3 failed on channel channel-1');
    expect(logado).toContain('network error');
    erro.mockRestore();
  });

  test('marks the message failed with the Meta error motivo when the API returns a structured error', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    const err = new Error('Request failed with status code 400');
    err.response = {
      data: {
        error: { code: 131049, error_user_msg: 'A Meta limitou mensagens de marketing.', title: 'Message limit' },
      },
    };
    metaCloudAdapter.sendTextMessage.mockRejectedValue(err);
    const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handler({ messageId: 'msg-3', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('Request failed with status code 400');

    expect(markMessageFailed).toHaveBeenCalledWith('msg-3', '(131049) A Meta limitou mensagens de marketing.');
    erro.mockRestore();
  });

  test('marks the message failed with the 360dialog motivo and logs status/body when the API returns its own error shape', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: '360dialog', config: {} });
    const err = new Error('Request failed with status code 403');
    err.response = {
      status: 403,
      data: { meta: { success: false, http_code: 403, developer_message: 'x' } },
    };
    threeSixtyDialogAdapter.sendTextMessage.mockRejectedValue(err);
    const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handler({ messageId: 'msg-3', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('Request failed with status code 403');

    expect(markMessageFailed).toHaveBeenCalledWith('msg-3', '(403) x');
    const logado = erro.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logado).toContain('status=403');
    erro.mockRestore();
  });

  test('marks the message failed with the 360dialog plain-string motivo when error is a string, not an object', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: '360dialog', config: {} });
    const err = new Error('Request failed with status code 403');
    err.response = {
      status: 403,
      data: { error: 'This number is blocked due to lack of payment on client side.' },
    };
    threeSixtyDialogAdapter.sendTextMessage.mockRejectedValue(err);
    const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handler({ messageId: 'msg-3', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('Request failed with status code 403');

    expect(markMessageFailed).toHaveBeenCalledWith(
      'msg-3',
      'This number is blocked due to lack of payment on client side.'
    );
    erro.mockRestore();
  });

  test('emits message:updated to the assigned agent on success', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      contactPhoneNumber: '5511999998888',
      assignedAgentId: 'agent-1',
    });
    findChannelById.mockResolvedValue({
      id: 'channel-1',
      type: 'meta_cloud',
      config: { phoneNumberId: '123', accessToken: 'tok' },
    });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });
    recordMessageSent.mockResolvedValue({ id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola cliente' });

    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:updated', {
      conversationId: 'conv-1',
      message: { id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' },
    });
  });

  test('emits message:updated to the assigned agent on failure', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      contactPhoneNumber: '5511999998888',
      assignedAgentId: 'agent-1',
    });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockRejectedValue(new Error('network error'));
    markMessageFailed.mockResolvedValue({ id: 'msg-2', status: 'failed' });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handler({ messageId: 'msg-2', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:updated', {
      conversationId: 'conv-1',
      message: { id: 'msg-2', status: 'failed' },
    });
  });

  // Teste real 2026-09-15: em Automação/Espera (sem atendente) a resposta da
  // IA, o boleto e a linha digitável só apareciam no F5 — o worker só avisava
  // o atendente atribuído, e ali não há nenhum. Sem dono, a mensagem vai a
  // todos os conectados como message:new (a tela filtra pela conversa aberta).
  test('sem atendente atribuído, emite message:new para todos no sucesso', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      contactPhoneNumber: '5511999998888',
      assignedAgentId: null,
    });
    findChannelById.mockResolvedValue({
      id: 'channel-1',
      type: 'meta_cloud',
      config: { phoneNumberId: '123', accessToken: 'tok' },
    });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });
    recordMessageSent.mockResolvedValue({ id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola cliente' });

    expect(broadcast).toHaveBeenCalledWith('message:new', {
      conversation: { id: 'conv-1', contactPhoneNumber: '5511999998888', assignedAgentId: null },
      message: { id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' },
    });
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('sem atendente atribuído, emite message:new para todos na falha', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      contactPhoneNumber: '5511999998888',
      assignedAgentId: null,
    });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockRejectedValue(new Error('network error'));
    markMessageFailed.mockResolvedValue({ id: 'msg-2', status: 'failed' });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handler({ messageId: 'msg-2', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(broadcast).toHaveBeenCalledWith('message:new', {
      conversation: { id: 'conv-1', contactPhoneNumber: '5511999998888', assignedAgentId: null },
      message: { id: 'msg-2', status: 'failed' },
    });
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('com atendente atribuído, não faz broadcast', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      contactPhoneNumber: '5511999998888',
      assignedAgentId: 'agent-1',
    });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok' } });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });
    recordMessageSent.mockResolvedValue({ id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola cliente' });

    expect(broadcast).not.toHaveBeenCalled();
  });

  // Conversa silenciada e um disparo (campanha ou SGP) que o cliente ainda
  // nao respondeu: nao esta em fila nenhuma, ninguem pode atende-la, e o
  // payload carrega telefone, documento do SGP, nota interna e o texto todo.
  // Nenhum consumidor da tela faz nada com ele, entao nao sai do servidor.
  test('conversa silenciada: nenhum message:new sai, nem global nem direcionado', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-silent',
      status: 'silent',
      assignedAgentId: null,
      contactPhoneNumber: '5511999998888',
      contactSgpDocument: '12345678900',
      contactInternalNote: 'cliente reclamou na semana passada',
    });
    findChannelById.mockResolvedValue({
      id: 'channel-1',
      type: 'meta_cloud',
      config: { phoneNumberId: '123', accessToken: 'tok' },
    });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });
    recordMessageSent.mockResolvedValue({ id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-silent', channelId: 'channel-1', content: 'Seu boleto vence em 10/09' });

    expect(broadcast).not.toHaveBeenCalled();
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('conversa silenciada: tambem nao emite nada no caminho de falha', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-silent',
      status: 'silent',
      assignedAgentId: null,
      contactPhoneNumber: '5511999998888',
    });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockRejectedValue(new Error('network error'));
    markMessageFailed.mockResolvedValue({ id: 'msg-2', status: 'failed' });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handler({ messageId: 'msg-2', conversationId: 'conv-silent', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(broadcast).not.toHaveBeenCalled();
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  // O caso que a guarda NAO pode alcancar: conversa em triagem pela IA esta
  // em waiting e tambem nao tem dono. E a correcao de 2026-09-15.
  test('waiting sem dono continua com o broadcast global, no sucesso', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      status: 'waiting',
      assignedAgentId: null,
      contactPhoneNumber: '5511999998888',
    });
    findChannelById.mockResolvedValue({
      id: 'channel-1',
      type: 'meta_cloud',
      config: { phoneNumberId: '123', accessToken: 'tok' },
    });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });
    recordMessageSent.mockResolvedValue({ id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Segue seu boleto' });

    expect(broadcast).toHaveBeenCalledWith('message:new', {
      conversation: { id: 'conv-1', status: 'waiting', assignedAgentId: null, contactPhoneNumber: '5511999998888' },
      message: { id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' },
    });
  });

  test('waiting sem dono continua com o broadcast global, na falha', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      status: 'waiting',
      assignedAgentId: null,
      contactPhoneNumber: '5511999998888',
    });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockRejectedValue(new Error('network error'));
    markMessageFailed.mockResolvedValue({ id: 'msg-2', status: 'failed' });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handler({ messageId: 'msg-2', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(broadcast).toHaveBeenCalledWith('message:new', expect.objectContaining({
      message: { id: 'msg-2', status: 'failed' },
    }));
  });

  test('conversa com dono continua recebendo message:updated direcionado, e nada global', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
      contactPhoneNumber: '5511999998888',
    });
    findChannelById.mockResolvedValue({
      id: 'channel-1',
      type: 'meta_cloud',
      config: { phoneNumberId: '123', accessToken: 'tok' },
    });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });
    recordMessageSent.mockResolvedValue({ id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola cliente' });

    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:updated', {
      conversationId: 'conv-1',
      message: { id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' },
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  // Se um dia alguem atribuir uma conversa silenciada, o dono ganha
  // precedencia: a guarda nao pode roubar o aviso de quem esta atendendo.
  test('silent COM dono continua avisando o dono', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      status: 'silent',
      assignedAgentId: 'agent-1',
      contactPhoneNumber: '5511999998888',
    });
    findChannelById.mockResolvedValue({
      id: 'channel-1',
      type: 'meta_cloud',
      config: { phoneNumberId: '123', accessToken: 'tok' },
    });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });
    recordMessageSent.mockResolvedValue({ id: 'msg-1', status: 'sent', whatsappMessageId: 'wamid.OUT1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' });

    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:updated', expect.any(Object));
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('falls back to findMessageById for the emit when markMessageFailed returns null (status webhook already recorded the real motivo)', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      contactPhoneNumber: '5511999998888',
      assignedAgentId: 'agent-1',
    });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockRejectedValue(new Error('network error'));
    markMessageFailed.mockResolvedValue(null);
    findMessageById
      .mockResolvedValueOnce(null) // idempotency check at the top of the handler
      .mockResolvedValueOnce({
        id: 'msg-2',
        status: 'failed',
        metadata: { motivoFalha: '(131026) Número não recebe mensagens.' },
      });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handler({ messageId: 'msg-2', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(findMessageById).toHaveBeenCalledWith('msg-2');
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:updated', {
      conversationId: 'conv-1',
      message: {
        id: 'msg-2',
        status: 'failed',
        metadata: { motivoFalha: '(131026) Número não recebe mensagens.' },
      },
    });
  });

  test('does not emit when markMessageFailed and findMessageById both find nothing', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      contactPhoneNumber: '5511999998888',
      assignedAgentId: 'agent-1',
    });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockRejectedValue(new Error('network error'));
    markMessageFailed.mockResolvedValue(null);
    findMessageById.mockResolvedValue(null);
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      handler({ messageId: 'msg-2', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('sends via sendMediaMessage when the message has a non-text messageType', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({
      id: 'channel-1',
      type: 'meta_cloud',
      config: { phoneNumberId: '123', accessToken: 'tok' },
    });
    metaCloudAdapter.sendMediaMessage.mockResolvedValue({ whatsappMessageId: 'wamid.MEDIA1' });

    await handler({
      messageId: 'msg-4',
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Aqui está',
      messageType: 'image',
      mediaPath: 'file.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
    });

    expect(metaCloudAdapter.sendMediaMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: { phoneNumberId: '123', accessToken: 'tok' } },
      '5511999998888',
      { messageType: 'image', mediaPath: 'file.jpg', mediaMimeType: 'image/jpeg', mediaFilename: null, caption: 'Aqui está' }
    );
    expect(metaCloudAdapter.sendTextMessage).not.toHaveBeenCalled();
    expect(recordMessageSent).toHaveBeenCalledWith('msg-4', 'wamid.MEDIA1');
  });

  test('sends via sendTextMessage when messageType is text or absent', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.TXT1' });

    await handler({ messageId: 'msg-5', conversationId: 'conv-1', channelId: 'channel-1', content: 'Oi', messageType: 'text' });

    expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: {} },
      '5511999998888',
      'Oi'
    );
    expect(metaCloudAdapter.sendMediaMessage).not.toHaveBeenCalled();
  });

  test('skips sending when the message already has a recorded whatsappMessageId', async () => {
    findMessageById.mockResolvedValue({ id: 'msg-1', whatsappMessageId: 'wamid.ALREADY_SENT' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola cliente' });

    expect(getConversationWithContact).not.toHaveBeenCalled();
    expect(findChannelById).not.toHaveBeenCalled();
    expect(metaCloudAdapter.sendTextMessage).not.toHaveBeenCalled();
    expect(baileysManager.sendTextMessage).not.toHaveBeenCalled();
  });

  test('sends normally when the message exists but has no whatsappMessageId yet', async () => {
    findMessageById.mockResolvedValue({ id: 'msg-1', whatsappMessageId: null });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.NEW1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola cliente' });

    expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalled();
    expect(recordMessageSent).toHaveBeenCalledWith('msg-1', 'wamid.NEW1');
  });

  test('sends via sendTemplateMessage when the job carries a templateName', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTemplateMessage.mockResolvedValue({ whatsappMessageId: 'wamid.TPL1' });

    await handler({
      messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Olá João, sua fatura venceu.',
      templateName: 'fatura_vencida', templateLanguage: 'pt_BR', templateVariables: ['João'],
    });

    expect(metaCloudAdapter.sendTemplateMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: {} },
      '5511999998888',
      { name: 'fatura_vencida', language: 'pt_BR', variables: ['João'] }
    );
    expect(metaCloudAdapter.sendTextMessage).not.toHaveBeenCalled();
    expect(recordMessageSent).toHaveBeenCalledWith('msg-1', 'wamid.TPL1');
  });

  // Fase 1A (25/09/2026): a Meta devolve o wa_id do cliente no envio de template. No DDD 98 ele
  // vem sem o 9 mesmo quando o disparo manda com o 9 — e é com ele que a resposta chega.
  describe('Fase 1A — wa_id devolvido pela Meta', () => {
    const CANAL_META = { id: 'channel-1', type: 'meta_cloud', config: {} };
    const JOB_TEMPLATE = {
      messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: null,
      templateName: 'dw_fatura_mensal', templateLanguage: 'pt_BR', templateVariables: ['Ana'],
    };

    beforeEach(() => {
      getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactId: 'contact-1', contactPhoneNumber: '5598985120338' });
      findChannelById.mockResolvedValue(CANAL_META);
      recordMessageSent.mockResolvedValue({ id: 'msg-1' });
    });

    test('wa_id diferente do número do contato: grava o wa_id na mensagem e tenta a troca segura do número (regra revista: fantasma sem histórico próprio)', async () => {
      metaCloudAdapter.sendTemplateMessage.mockResolvedValue({ whatsappMessageId: 'wamid.T1', waId: '559885120338' });
      renameGhostContactToWaId.mockResolvedValue(true);

      await handler(JOB_TEMPLATE);

      // O pedido à Meta é o de sempre, com o número que o SGP mandou.
      expect(metaCloudAdapter.sendTemplateMessage).toHaveBeenCalledWith(CANAL_META, '5598985120338', { name: 'dw_fatura_mensal', language: 'pt_BR', variables: ['Ana'] });
      expect(recordMessageSent).toHaveBeenCalledWith('msg-1', 'wamid.T1');
      expect(recordMessageWaId).toHaveBeenCalledWith('msg-1', '559885120338');
      // O número atual vai junto: a troca só vale se o banco ainda tiver exatamente esse número.
      expect(renameGhostContactToWaId).toHaveBeenCalledWith('contact-1', '5598985120338', '559885120338', 'msg-1');
      expect(markMessageFailed).not.toHaveBeenCalled();
    });

    test('wa_id igual ao número do contato: nada a registrar nem a trocar', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactId: 'contact-1', contactPhoneNumber: '559885120338' });
      metaCloudAdapter.sendTemplateMessage.mockResolvedValue({ whatsappMessageId: 'wamid.T2', waId: '559885120338' });

      await handler(JOB_TEMPLATE);

      expect(recordMessageWaId).not.toHaveBeenCalled();
      expect(renameGhostContactToWaId).not.toHaveBeenCalled();
    });

    test('sem wa_id na resposta: comportamento de antes', async () => {
      metaCloudAdapter.sendTemplateMessage.mockResolvedValue({ whatsappMessageId: 'wamid.T3' });

      await handler(JOB_TEMPLATE);

      expect(recordMessageSent).toHaveBeenCalledWith('msg-1', 'wamid.T3');
      expect(recordMessageWaId).not.toHaveBeenCalled();
      expect(renameGhostContactToWaId).not.toHaveBeenCalled();
    });

    test('falha ao registrar ou trocar o número nunca vira falha de envio: a mensagem já saiu', async () => {
      metaCloudAdapter.sendTemplateMessage.mockResolvedValue({ whatsappMessageId: 'wamid.T4', waId: '559885120338' });
      recordMessageWaId.mockRejectedValueOnce(new Error('banco fora'));
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(handler(JOB_TEMPLATE)).resolves.toBeUndefined();

      expect(recordMessageSent).toHaveBeenCalledWith('msg-1', 'wamid.T4');
      expect(markMessageFailed).not.toHaveBeenCalled();
      expect(spy.mock.calls.flat().join(' ')).not.toContain('559885120338');
      spy.mockRestore();
    });
  });

  test('passes headerType/headerLink through to sendTemplateMessage when present', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTemplateMessage.mockResolvedValue({ whatsappMessageId: 'wamid.TPL2' });

    await handler({
      messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Olá João',
      templateName: 'aviso_cobranca', templateLanguage: 'pt_BR', templateVariables: ['João'],
      headerType: 'document', headerLink: 'https://boleto.link/xyz.pdf',
    });

    expect(metaCloudAdapter.sendTemplateMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: {} },
      '5511999998888',
      { name: 'aviso_cobranca', language: 'pt_BR', variables: ['João'], headerType: 'document', headerLink: 'https://boleto.link/xyz.pdf' }
    );
  });

  test('passes reply context to sendTextMessage when repliedToMessageId is present and the original message is found', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    findMessageById.mockImplementation((id) => {
      if (id === 'msg-1') return Promise.resolve(null); // idempotency check at the top of the handler
      if (id === 'msg-original') {
        return Promise.resolve({ id: 'msg-original', whatsappMessageId: 'wamid.ORIG1', direction: 'inbound', content: 'Qual o valor?' });
      }
      return Promise.resolve(null);
    });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.REPLY1' });

    await handler({
      messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'R$150,00',
      repliedToMessageId: 'msg-original',
    });

    expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: {} },
      '5511999998888',
      'R$150,00',
      { repliedToWhatsappMessageId: 'wamid.ORIG1', repliedToDirection: 'inbound', repliedToContent: 'Qual o valor?' }
    );
  });

  test('sends without a 4th argument when repliedToMessageId is absent (unchanged behavior)', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.PLAIN1' });

    await handler({ messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Oi' });

    expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: {} },
      '5511999998888',
      'Oi'
    );
  });

  test('sends without reply context when the original message is not found (defensive fallback)', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    findMessageById.mockResolvedValue(null);
    metaCloudAdapter.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.FALLBACK1' });

    await handler({
      messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'R$150,00',
      repliedToMessageId: 'msg-gone',
    });

    expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: {} },
      '5511999998888',
      'R$150,00'
    );
  });

  test('passes reply context to sendMediaMessage when repliedToMessageId is present', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    findMessageById.mockImplementation((id) => {
      if (id === 'msg-1') return Promise.resolve(null);
      return Promise.resolve({ id: 'msg-original', whatsappMessageId: 'wamid.ORIG1', direction: 'outbound', content: 'Segue o boleto' });
    });
    metaCloudAdapter.sendMediaMessage.mockResolvedValue({ whatsappMessageId: 'wamid.REPLYMEDIA1' });

    await handler({
      messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Aqui está',
      messageType: 'image', mediaPath: 'file.jpg', mediaMimeType: 'image/jpeg', mediaFilename: null,
      repliedToMessageId: 'msg-original',
    });

    expect(metaCloudAdapter.sendMediaMessage).toHaveBeenCalledWith(
      { id: 'channel-1', type: 'meta_cloud', config: {} },
      '5511999998888',
      {
        messageType: 'image', mediaPath: 'file.jpg', mediaMimeType: 'image/jpeg', mediaFilename: null, caption: 'Aqui está',
        repliedToWhatsappMessageId: 'wamid.ORIG1', repliedToDirection: 'outbound', repliedToContent: 'Segue o boleto',
      }
    );
  });

  describe('mensagem de Pix: cart\u00e3o nativo, com queda para texto', () => {
    const METADATA = { value: 135, dueDate: '2026-09-15', faturaId: 4321 };
    // Codigos EMV de teste: o recebedor do cartao sai de dentro do proprio codigo.
    const PIX_CODE = '00020126360014BR.GOV.BCB.PIX011412345678000199520400005303986540513.505802BR5915DW TELECOM LTDA6008SAO LUIS62070503***6304ABCD';
    const PIX_SEM_CHAVE = '00020126500014BR.GOV.BCB.PIX2528pix.example.com/qr/v2/abc123520400005303986540513.505802BR5910DW TELECOM6008SAO LUIS62070503***6304ABCD';
    const MERCHANT = { name: 'DW TELECOM LTDA', key: '12345678000199', keyType: 'CNPJ' };

    function jobPix(channelId, codigo = PIX_CODE) {
      return {
        messageId: 'msg-pix', conversationId: 'conv-1', channelId,
        content: codigo, messageType: 'pix', metadata: METADATA,
      };
    }

    beforeEach(() => {
      // O cartao no Baileys agenda a conferencia de entrega; sem relogio falso
      // esses testes deixariam um setTimeout de 60s solto para tras.
      jest.useFakeTimers();
      getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
      getCompanyConfig.mockResolvedValue({ id: 'empresa-1', name: 'EMPRESA TESTE', acceptedPayeeNames: [] });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('no Baileys manda o cart\u00e3o mesmo com c\u00f3digo sem chave, com o nome lido do c\u00f3digo', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
      baileysManager.sendPixCardMessage.mockResolvedValue({ whatsappMessageId: 'BAILEYS_PIX_1' });

      await handler(jobPix('channel-2', PIX_SEM_CHAVE));

      expect(baileysManager.sendPixCardMessage).toHaveBeenCalledWith(
        { id: 'channel-2', type: 'baileys', config: {} },
        '5511999998888',
        {
          pixCode: PIX_SEM_CHAVE, value: 135, dueDate: '2026-09-15', faturaId: 4321,
          merchant: { name: 'DW TELECOM', key: null, keyType: null },
        }
      );
      expect(baileysManager.sendTextMessage).not.toHaveBeenCalled();
      expect(recordMessageSent).toHaveBeenCalledWith('msg-pix', 'BAILEYS_PIX_1');
      // Baileys lê a chave só do próprio código, sem nenhuma chamada de rede -
      // mesmo para um código dinâmico como este.
      expect(lerRecebedorDoPix).toHaveBeenCalledWith(PIX_SEM_CHAVE);
      expect(resolverRecebedorPix).not.toHaveBeenCalled();
    });

    test('no meta_cloud manda o cart\u00e3o com o recebedor lido do c\u00f3digo', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendPixCardMessage.mockResolvedValue({ whatsappMessageId: 'wamid.PIX1' });

      await handler(jobPix('channel-1'));

      expect(metaCloudAdapter.sendPixCardMessage).toHaveBeenCalledWith(
        { id: 'channel-1', type: 'meta_cloud', config: {} },
        '5511999998888',
        { pixCode: PIX_CODE, value: 135, dueDate: '2026-09-15', faturaId: 4321, merchant: MERCHANT }
      );
      expect(metaCloudAdapter.sendTextMessage).not.toHaveBeenCalled();
      expect(recordMessageSent).toHaveBeenCalledWith('msg-pix', 'wamid.PIX1');
    });

    test('no meta_cloud, c\u00f3digo din\u00e2mico resolvido pela cobran\u00e7a manda o cart\u00e3o com a chave achada', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendPixCardMessage.mockResolvedValue({ whatsappMessageId: 'wamid.PIX_RESOLVIDO' });
      const resolvido = { name: 'DW TELECOM', key: '12345678000199', keyType: 'CNPJ' };
      resolverRecebedorPix.mockResolvedValueOnce(resolvido);

      await handler(jobPix('channel-1', PIX_SEM_CHAVE));

      expect(resolverRecebedorPix).toHaveBeenCalledWith(PIX_SEM_CHAVE);
      expect(metaCloudAdapter.sendPixCardMessage).toHaveBeenCalledWith(
        { id: 'channel-1', type: 'meta_cloud', config: {} },
        '5511999998888',
        { pixCode: PIX_SEM_CHAVE, value: 135, dueDate: '2026-09-15', faturaId: 4321, merchant: resolvido }
      );
      expect(metaCloudAdapter.sendTextMessage).not.toHaveBeenCalled();
      expect(recordMessageSent).toHaveBeenCalledWith('msg-pix', 'wamid.PIX_RESOLVIDO');
      // Canal oficial: a chave veio da resolu\u00e7\u00e3o ass\u00edncrona, n\u00e3o da leitura s\u00edncrona.
      expect(lerRecebedorDoPix).not.toHaveBeenCalled();
    });

    test('no meta_cloud, c\u00f3digo sem chave cai no texto: cart\u00e3o e depois o c\u00f3digo', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendTextMessage
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CARTAO' })
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CODIGO' });
      // A resolu\u00e7\u00e3o din\u00e2mica n\u00e3o achou chave (c\u00f3digo sem localiza\u00e7\u00e3o v\u00e1lida,
      // rede fora do ar, etc.) - simulada aqui em vez de bater numa URL de
      // verdade, que este c\u00f3digo de teste nem tem.
      resolverRecebedorPix.mockResolvedValueOnce({ name: 'DW TELECOM', key: null, keyType: null });
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await handler(jobPix('channel-1', PIX_SEM_CHAVE));

      expect(metaCloudAdapter.sendPixCardMessage).not.toHaveBeenCalled();
      expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledTimes(2);
      expect(metaCloudAdapter.sendTextMessage.mock.calls[0][2]).toBe(cartaoPix({ valor: 135, vencimento: '2026-09-15' }));
      expect(metaCloudAdapter.sendTextMessage.mock.calls[1][2]).toBe(PIX_SEM_CHAVE);
      // Nem o aviso de que faltou a chave pode carregar o codigo Pix.
      const logado = erro.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logado).toContain('Pix code carries no merchant key');
      expect(logado).not.toContain(PIX_SEM_CHAVE);
      erro.mockRestore();
      // O id gravado \u00e9 o da mensagem do c\u00f3digo, n\u00e3o o do cart\u00e3o de texto.
      expect(recordMessageSent).toHaveBeenCalledWith('msg-pix', 'wamid.TXT_CODIGO');
    });

    test('cart\u00e3o recusado pela API cai no texto, sem derrubar o envio', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendPixCardMessage.mockRejectedValue(new Error('400 order_details not supported'));
      metaCloudAdapter.sendTextMessage
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CARTAO' })
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CODIGO' });
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await handler(jobPix('channel-1'));

      expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledTimes(2);
      expect(recordMessageSent).toHaveBeenCalledWith('msg-pix', 'wamid.TXT_CODIGO');
      expect(markMessageFailed).not.toHaveBeenCalled();
      // O c\u00f3digo Pix nunca pode aparecer no log.
      const logado = erro.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logado).toContain('falling back to text');
      expect(logado).not.toContain(PIX_CODE);
      erro.mockRestore();
    });

    test('um adaptador sem sendPixCardMessage simplesmente usa o texto', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-3', type: '360dialog', config: {} });
      // Restaurado no fim: apagar a função do módulo mockado vazaria para os
      // testes seguintes, que nunca mais veriam o adaptador saber mandar cartão.
      const original = threeSixtyDialogAdapter.sendPixCardMessage;
      threeSixtyDialogAdapter.sendPixCardMessage = undefined;
      threeSixtyDialogAdapter.sendTextMessage
        .mockResolvedValueOnce({ whatsappMessageId: 'D360_TXT_CARTAO' })
        .mockResolvedValueOnce({ whatsappMessageId: 'D360_TXT_CODIGO' });

      try {
        await handler(jobPix('channel-3'));
      } finally {
        threeSixtyDialogAdapter.sendPixCardMessage = original;
      }

      expect(threeSixtyDialogAdapter.sendTextMessage).toHaveBeenCalledTimes(2);
      expect(recordMessageSent).toHaveBeenCalledWith('msg-pix', 'D360_TXT_CODIGO');
      // Nao faltou recebedor: o adaptador e que nao sabe mandar cartao, entao
      // a queda fica sem motivo e o chat diz so que o cliente recebeu o texto.
      expect(markPixFallbackSent).toHaveBeenCalledWith('msg-pix', undefined);
    });

    test('a queda por c\u00f3digo sem chave fica gravada na mensagem, antes de ela ser emitida', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendTextMessage
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CARTAO' })
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CODIGO' });
      resolverRecebedorPix.mockResolvedValueOnce({ name: 'DW TELECOM', key: null, keyType: null });
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await handler(jobPix('channel-1', PIX_SEM_CHAVE));
      erro.mockRestore();

      expect(markPixFallbackSent).toHaveBeenCalledWith('msg-pix', 'codigo_sem_chave');
      // Antes de recordMessageSent: a mensagem que sai no message:updated já
      // precisa carregar a metadata, senão o chat desenha o cartão.
      expect(markPixFallbackSent.mock.invocationCallOrder[0])
        .toBeLessThan(recordMessageSent.mock.invocationCallOrder[0]);
    });

    test('a queda por cartão recusado grava o motivo do recusado', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendPixCardMessage.mockRejectedValue(new Error('400 order_details not supported'));
      metaCloudAdapter.sendTextMessage
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CARTAO' })
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CODIGO' });
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await handler(jobPix('channel-1'));

      expect(markPixFallbackSent).toHaveBeenCalledWith('msg-pix', 'cartao_recusado');
      erro.mockRestore();
    });

    test('c\u00f3digo sem nome do recebedor usa o nome da empresa no cart\u00e3o oficial', async () => {
      const PIX_SEM_NOME = '00020126360014BR.GOV.BCB.PIX0114+5598999990000520400005303986540513.505802BR6008SAO LUIS62070503***6304ABCD';
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', name: 'Canal Oficial', config: {} });
      metaCloudAdapter.sendPixCardMessage.mockResolvedValue({ whatsappMessageId: 'wamid.PIX1' });

      await handler(jobPix('channel-1', PIX_SEM_NOME));

      expect(metaCloudAdapter.sendPixCardMessage.mock.calls[0][2].merchant).toEqual({
        name: 'EMPRESA TESTE', key: '+5598999990000', keyType: 'PHONE',
      });
    });

    test('o cartão entregue não marca queda nenhuma', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendPixCardMessage.mockResolvedValue({ whatsappMessageId: 'wamid.PIX1' });

      await handler(jobPix('channel-1'));

      expect(markPixFallbackSent).not.toHaveBeenCalled();
    });

    test('o erro estruturado da API entra no log, sem o corpo da requisição nem o código Pix', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      const err = new Error('Request failed with status code 400');
      err.config = { data: `{"pix":"${PIX_CODE}"}` };
      err.response = {
        data: {
          error: {
            message: 'Unsupported message type order_details',
            type: 'OAuthException',
            code: 100,
            error_data: { details: 'order_details is not enabled for this WABA' },
            fbtrace_id: 'AbC123',
          },
        },
      };
      metaCloudAdapter.sendPixCardMessage.mockRejectedValue(err);
      metaCloudAdapter.sendTextMessage
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CARTAO' })
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CODIGO' });
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await handler(jobPix('channel-1'));

      const logado = erro.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logado).toContain('Unsupported message type order_details');
      expect(logado).toContain('OAuthException');
      expect(logado).toContain('order_details is not enabled for this WABA');
      expect(logado).not.toContain(PIX_CODE);
      expect(logado).not.toContain('fbtrace_id');
      erro.mockRestore();
    });

    test('a mensagem de Pix n\u00e3o passa pelo caminho de m\u00eddia', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
      baileysManager.sendPixCardMessage.mockResolvedValue({ whatsappMessageId: 'BAILEYS_PIX_1' });

      await handler(jobPix('channel-2'));

      expect(baileysManager.sendMediaMessage).not.toHaveBeenCalled();
    });
  });

  describe('queda para texto quando o cartão de Pix não recebe recibo', () => {
    const METADATA = { value: 135, dueDate: '2026-09-15', faturaId: 4321 };
    // Codigos EMV de teste: o recebedor do cartao sai de dentro do proprio codigo.
    const PIX_CODE = '00020126360014BR.GOV.BCB.PIX011412345678000199520400005303986540513.505802BR5915DW TELECOM LTDA6008SAO LUIS62070503***6304ABCD';
    const PIX_SEM_CHAVE = '00020126500014BR.GOV.BCB.PIX2528pix.example.com/qr/v2/abc123520400005303986540513.505802BR5910DW TELECOM6008SAO LUIS62070503***6304ABCD';
    const MERCHANT = { name: 'DW TELECOM LTDA', key: '12345678000199', keyType: 'CNPJ' };
    const CONVERSA = { id: 'conv-1', contactPhoneNumber: '5511999998888', assignedAgentId: 'agent-1' };

    function jobPix(channelId, codigo = PIX_CODE) {
      return {
        messageId: 'msg-pix', conversationId: 'conv-1', channelId,
        content: codigo, messageType: 'pix', metadata: METADATA,
      };
    }

    // O primeiro findMessageById é o do worker (checa reenvio); o segundo é o da
    // conferência de entrega, um minuto depois.
    function mensagemGravadaCom(status) {
      findMessageById
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ id: 'msg-pix', status, whatsappMessageId: 'BAILEYS_PIX_1', sentBy: 'ai' });
    }

    beforeEach(() => {
      jest.useFakeTimers();
      getConversationWithContact.mockResolvedValue(CONVERSA);
      getCompanyConfig.mockResolvedValue({ id: 'empresa-1', name: 'EMPRESA TESTE', acceptedPayeeNames: [] });
      markPixFallbackSent.mockResolvedValue(true);
      enqueueOutboundMessage.mockResolvedValue({ id: 'msg-texto' });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('cartão com recibo de entrega não gera nenhum texto', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
      baileysManager.sendPixCardMessage.mockResolvedValue({ whatsappMessageId: 'BAILEYS_PIX_1' });
      mensagemGravadaCom('delivered');

      await handler(jobPix('channel-2'));
      await jest.advanceTimersByTimeAsync(60000);

      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
      expect(markPixFallbackSent).not.toHaveBeenCalled();
    });

    test('cartão ainda em sent depois de 60s cai para o texto: cartão e depois o código', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
      baileysManager.sendPixCardMessage.mockResolvedValue({ whatsappMessageId: 'BAILEYS_PIX_1' });
      mensagemGravadaCom('sent');
      const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await handler(jobPix('channel-2'));
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(60000);

      expect(markPixFallbackSent).toHaveBeenCalledWith('msg-pix', 'cartao_nao_entregue');
      expect(enqueueOutboundMessage).toHaveBeenCalledTimes(2);
      expect(enqueueOutboundMessage).toHaveBeenNthCalledWith(1, {
        conversationId: 'conv-1',
        channelId: 'channel-2',
        content: cartaoPix({ valor: 135, vencimento: '2026-09-15' }),
        messageType: 'text',
        sentBy: 'ai',
      });
      expect(enqueueOutboundMessage).toHaveBeenNthCalledWith(2, {
        conversationId: 'conv-1',
        channelId: 'channel-2',
        content: PIX_CODE,
        messageType: 'text',
        sentBy: 'ai',
      });
      expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:new', {
        conversation: CONVERSA,
        message: { id: 'msg-texto' },
      });
      // O código Pix nunca pode aparecer no log.
      const avisado = aviso.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(avisado).toContain('no delivery receipt');
      expect(avisado).not.toContain(PIX_CODE);
      aviso.mockRestore();
    });

    test('não repete a queda quando outro processo já marcou a mensagem', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
      baileysManager.sendPixCardMessage.mockResolvedValue({ whatsappMessageId: 'BAILEYS_PIX_1' });
      mensagemGravadaCom('sent');
      markPixFallbackSent.mockResolvedValue(false);

      await handler(jobPix('channel-2'));
      await jest.advanceTimersByTimeAsync(60000);

      expect(markPixFallbackSent).toHaveBeenCalledWith('msg-pix', 'cartao_nao_entregue');
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('canal oficial não agenda conferência nenhuma', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendPixCardMessage.mockResolvedValue({ whatsappMessageId: 'wamid.PIX1' });
      mensagemGravadaCom('sent');

      await handler(jobPix('channel-1'));
      await jest.advanceTimersByTimeAsync(60000);

      expect(markPixFallbackSent).not.toHaveBeenCalled();
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('envio que já saiu como texto não agenda conferência', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
      baileysManager.sendPixCardMessage.mockRejectedValue(new Error('400 interactive not supported'));
      baileysManager.sendTextMessage
        .mockResolvedValueOnce({ whatsappMessageId: 'BAILEYS_TXT_CARTAO' })
        .mockResolvedValueOnce({ whatsappMessageId: 'BAILEYS_TXT_CODIGO' });
      mensagemGravadaCom('sent');
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await handler(jobPix('channel-2'));
      await jest.advanceTimersByTimeAsync(60000);

      // A queda já foi marcada pelo envio; a conferência de 60s nem chegou a
      // ser agendada, então ninguém sobrescreve com 'cartao_nao_entregue'.
      expect(markPixFallbackSent).toHaveBeenCalledTimes(1);
      expect(markPixFallbackSent).toHaveBeenCalledWith('msg-pix', 'cartao_recusado');
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
      erro.mockRestore();
    });
  });

  // A fila é { attempts: 3, backoff: exponential }, e o Bull só retenta quando o
  // handler lança. Num erro permanente as tentativas 2 e 3 dão o mesmo
  // resultado: duas chamadas extras à Meta e a falha demorando a chegar à tela.
  describe('erro permanente da Meta não vira retentativa', () => {
    function erroDaMeta(code, texto) {
      const err = new Error('Request failed with status code 400');
      err.response = { status: 400, data: { error: { code, error_user_msg: texto } } };
      return err;
    }

    test('131047: marca a mensagem como falha uma vez e NÃO relança', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendTextMessage.mockRejectedValue(erroDaMeta(131047, 'Fora da janela de 24 horas.'));
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        handler({ messageId: 'msg-p1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
      ).resolves.toBeUndefined();

      expect(markMessageFailed).toHaveBeenCalledTimes(1);
      expect(markMessageFailed).toHaveBeenCalledWith('msg-p1', '(131047) Fora da janela de 24 horas.');
      expect(recordMessageSent).not.toHaveBeenCalled();
      erro.mockRestore();
    });

    // O atendente precisa ver a falha na tela nos DOIS casos - não relançar não
    // pode significar sumir com o aviso.
    test('131047: o atendente continua sendo avisado na tela', async () => {
      getConversationWithContact.mockResolvedValue({
        id: 'conv-1', contactPhoneNumber: '5511999998888', assignedAgentId: 'agent-1',
      });
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendTextMessage.mockRejectedValue(erroDaMeta(131047, 'Fora da janela de 24 horas.'));
      markMessageFailed.mockResolvedValue({
        id: 'msg-p2', status: 'failed', metadata: { motivoFalha: '(131047) Fora da janela de 24 horas.' },
      });
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await handler({ messageId: 'msg-p2', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' });

      expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:updated', {
        conversationId: 'conv-1',
        message: { id: 'msg-p2', status: 'failed', metadata: { motivoFalha: '(131047) Fora da janela de 24 horas.' } },
      });
      erro.mockRestore();
    });

    test('erro de rede continua lançando: a retentativa da fila fica intacta', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendTextMessage.mockRejectedValue(new Error('socket hang up'));
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        handler({ messageId: 'msg-t1', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
      ).rejects.toThrow('socket hang up');

      expect(markMessageFailed).toHaveBeenCalledWith('msg-t1', 'socket hang up');
      erro.mockRestore();
    });

    test('erro transitório da Meta (limite de marketing) continua lançando', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendTextMessage.mockRejectedValue(erroDaMeta(131049, 'A Meta limitou marketing.'));
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        handler({ messageId: 'msg-t2', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
      ).rejects.toThrow('Request failed with status code 400');

      expect(markMessageFailed).toHaveBeenCalledWith('msg-t2', '(131049) A Meta limitou marketing.');
      erro.mockRestore();
    });

    // Um 403 do 360dialog não é o código 131047 da Meta; se alguém comparar
    // http_code com a lista de permanentes, a mensagem para de ser retentada.
    test('o formato do 360dialog não é confundido com código da Meta', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
      findChannelById.mockResolvedValue({ id: 'channel-1', type: '360dialog', config: {} });
      const err = new Error('Request failed with status code 403');
      err.response = { status: 403, data: { meta: { success: false, http_code: 131047, developer_message: 'x' } } };
      threeSixtyDialogAdapter.sendTextMessage.mockRejectedValue(err);
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        handler({ messageId: 'msg-t3', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
      ).rejects.toThrow('Request failed with status code 403');
      erro.mockRestore();
    });
  });

  describe('automatic audio delivery check (Baileys only)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('checks delivery a few seconds after sending audio via Baileys, and does nothing when verified', async () => {
      const conversation = { id: 'conv-2', contactPhoneNumber: '5511999997777', assignedAgentId: 'agent-1' };
      getConversationWithContact.mockResolvedValue(conversation);
      findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
      baileysManager.sendMediaMessage.mockResolvedValue({ whatsappMessageId: 'BAILEYS_AUDIO_1' });
      baileysManager.verifyMediaDelivery.mockResolvedValue({ verified: true });

      await handler({
        messageId: 'msg-2', conversationId: 'conv-2', channelId: 'channel-2',
        messageType: 'audio', mediaPath: 'audio.ogg', mediaMimeType: 'audio/ogg', isVoiceNote: true,
      });
      expect(baileysManager.verifyMediaDelivery).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(5000);

      expect(baileysManager.verifyMediaDelivery).toHaveBeenCalledWith(
        { id: 'channel-2', type: 'baileys', config: {} },
        'BAILEYS_AUDIO_1',
        '5511999997777'
      );
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('resends the same audio automatically when delivery verification fails', async () => {
      const conversation = { id: 'conv-2', contactPhoneNumber: '5511999997777', assignedAgentId: 'agent-1' };
      getConversationWithContact.mockResolvedValue(conversation);
      findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
      baileysManager.sendMediaMessage.mockResolvedValue({ whatsappMessageId: 'BAILEYS_AUDIO_2' });
      baileysManager.verifyMediaDelivery.mockResolvedValue({ verified: false, reason: 'timed out' });
      enqueueOutboundMessage.mockResolvedValue({ id: 'msg-resent', messageType: 'audio' });

      await handler({
        messageId: 'msg-2', conversationId: 'conv-2', channelId: 'channel-2',
        messageType: 'audio', mediaPath: 'audio.ogg', mediaMimeType: 'audio/ogg', mediaFilename: 'audio.ogg', isVoiceNote: true,
      });
      await jest.advanceTimersByTimeAsync(5000);

      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-2',
        channelId: 'channel-2',
        messageType: 'audio',
        mediaPath: 'audio.ogg',
        mediaMimeType: 'audio/ogg',
        mediaFilename: 'audio.ogg',
        isVoiceNote: true,
      });
      expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:new', {
        conversation,
        message: { id: 'msg-resent', messageType: 'audio' },
      });
    });

    test('does not schedule a delivery check for non-audio Baileys messages', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'conv-2', contactPhoneNumber: '5511999997777' });
      findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
      baileysManager.sendTextMessage.mockResolvedValue({ whatsappMessageId: 'BAILEYS_TXT_1' });

      await handler({ messageId: 'msg-2', conversationId: 'conv-2', channelId: 'channel-2', content: 'Oi' });
      await jest.advanceTimersByTimeAsync(5000);

      expect(baileysManager.verifyMediaDelivery).not.toHaveBeenCalled();
    });

    test('does not schedule a delivery check for audio sent via the Meta Cloud adapter', async () => {
      getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendMediaMessage.mockResolvedValue({ whatsappMessageId: 'wamid.AUDIO1' });

      await handler({
        messageId: 'msg-1', conversationId: 'conv-1', channelId: 'channel-1',
        messageType: 'audio', mediaPath: 'audio.ogg', mediaMimeType: 'audio/ogg',
      });
      await jest.advanceTimersByTimeAsync(5000);

      expect(baileysManager.verifyMediaDelivery).not.toHaveBeenCalled();
    });
  });
});
