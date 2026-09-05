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
const { updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const metaCloudAdapter = require('../whatsapp-adapters/meta-cloud.adapter');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const { emitToAgent } = require('../realtime/socket-server');
const { startOutboundWorker } = require('./outbound-worker');

describe('startOutboundWorker', () => {
  let handler;

  beforeEach(() => {
    jest.clearAllMocks();
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
});
