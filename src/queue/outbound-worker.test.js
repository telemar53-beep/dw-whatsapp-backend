jest.mock('./outbound-queue');
jest.mock('../channels/channel.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/message.repository');
jest.mock('../whatsapp-adapters/meta-cloud.adapter');
jest.mock('../whatsapp-adapters/baileys.manager');
jest.mock('../whatsapp-adapters/three-sixty-dialog.adapter');
jest.mock('../realtime/socket-server');
jest.mock('../integrations/sgp-client');

const { processOutboundQueue, enqueueOutboundMessage } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById, updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
const { emitToAgent } = require('../realtime/socket-server');
const { getPixMerchant } = require('../integrations/sgp-client');
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
    expect(updateMessageStatus).not.toHaveBeenCalled();
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

  test('marks the message failed and rethrows when sending fails', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
    metaCloudAdapter.sendTextMessage.mockRejectedValue(new Error('network error'));

    await expect(
      handler({ messageId: 'msg-3', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(updateMessageStatus).toHaveBeenCalledWith('msg-3', 'failed');
    expect(recordMessageSent).not.toHaveBeenCalled();
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
    updateMessageStatus.mockResolvedValue({ id: 'msg-2', status: 'failed' });

    await expect(
      handler({ messageId: 'msg-2', conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:updated', {
      conversationId: 'conv-1',
      message: { id: 'msg-2', status: 'failed' },
    });
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
    const PIX_CODE = '00020126580014BR.GOV.BCB.PIX0136chave-pix';
    const MERCHANT = { name: 'DW TELECOM LTDA', key: '12345678000199', keyType: 'CNPJ' };

    function jobPix(channelId) {
      return {
        messageId: 'msg-pix', conversationId: 'conv-1', channelId,
        content: PIX_CODE, messageType: 'pix', metadata: METADATA,
      };
    }

    beforeEach(() => {
      getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
      getPixMerchant.mockResolvedValue(null);
    });

    test('no Baileys manda o cart\u00e3o sem precisar de recebedor cadastrado', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
      baileysManager.sendPixCardMessage.mockResolvedValue({ whatsappMessageId: 'BAILEYS_PIX_1' });

      await handler(jobPix('channel-2'));

      expect(baileysManager.sendPixCardMessage).toHaveBeenCalledWith(
        { id: 'channel-2', type: 'baileys', config: {} },
        '5511999998888',
        { pixCode: PIX_CODE, value: 135, dueDate: '2026-09-15', faturaId: 4321, merchant: null }
      );
      expect(baileysManager.sendTextMessage).not.toHaveBeenCalled();
      expect(recordMessageSent).toHaveBeenCalledWith('msg-pix', 'BAILEYS_PIX_1');
    });

    test('no meta_cloud com recebedor cadastrado manda o cart\u00e3o', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      getPixMerchant.mockResolvedValue(MERCHANT);
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

    test('no meta_cloud SEM recebedor cadastrado cai no texto: cart\u00e3o e depois o c\u00f3digo', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      metaCloudAdapter.sendTextMessage
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CARTAO' })
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CODIGO' });

      await handler(jobPix('channel-1'));

      expect(metaCloudAdapter.sendPixCardMessage).not.toHaveBeenCalled();
      expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledTimes(2);
      expect(metaCloudAdapter.sendTextMessage.mock.calls[0][2]).toBe(cartaoPix({ valor: 135, vencimento: '2026-09-15' }));
      expect(metaCloudAdapter.sendTextMessage.mock.calls[1][2]).toBe(PIX_CODE);
      // O id gravado \u00e9 o da mensagem do c\u00f3digo, n\u00e3o o do cart\u00e3o de texto.
      expect(recordMessageSent).toHaveBeenCalledWith('msg-pix', 'wamid.TXT_CODIGO');
    });

    test('cart\u00e3o recusado pela API cai no texto, sem derrubar o envio', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud', config: {} });
      getPixMerchant.mockResolvedValue(MERCHANT);
      metaCloudAdapter.sendPixCardMessage.mockRejectedValue(new Error('400 order_details not supported'));
      metaCloudAdapter.sendTextMessage
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CARTAO' })
        .mockResolvedValueOnce({ whatsappMessageId: 'wamid.TXT_CODIGO' });
      const erro = jest.spyOn(console, 'error').mockImplementation(() => {});

      await handler(jobPix('channel-1'));

      expect(metaCloudAdapter.sendTextMessage).toHaveBeenCalledTimes(2);
      expect(recordMessageSent).toHaveBeenCalledWith('msg-pix', 'wamid.TXT_CODIGO');
      expect(updateMessageStatus).not.toHaveBeenCalled();
      // O c\u00f3digo Pix nunca pode aparecer no log.
      const logado = erro.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logado).toContain('falling back to text');
      expect(logado).not.toContain(PIX_CODE);
      erro.mockRestore();
    });

    test('um adaptador sem sendPixCardMessage simplesmente usa o texto', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-3', type: '360dialog', config: {} });
      getPixMerchant.mockResolvedValue(MERCHANT);
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
    });

    test('a mensagem de Pix n\u00e3o passa pelo caminho de m\u00eddia', async () => {
      findChannelById.mockResolvedValue({ id: 'channel-2', type: 'baileys', config: {} });
      baileysManager.sendPixCardMessage.mockResolvedValue({ whatsappMessageId: 'BAILEYS_PIX_1' });

      await handler(jobPix('channel-2'));

      expect(baileysManager.sendMediaMessage).not.toHaveBeenCalled();
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
