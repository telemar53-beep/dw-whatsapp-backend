jest.mock('./outbound-queue');
jest.mock('../channels/channel.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/message.repository');
jest.mock('../whatsapp-adapters/meta-cloud.adapter');
jest.mock('../whatsapp-adapters/baileys.manager');
jest.mock('../realtime/socket-server');

const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById, updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { emitToAgent } = require('../realtime/socket-server');
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
});
