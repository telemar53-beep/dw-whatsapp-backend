jest.mock('./outbound-queue');
jest.mock('../channels/channel.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/message.repository');
jest.mock('../whatsapp-adapters/meta-cloud.adapter');

const { processOutboundQueue } = require('./outbound-queue');
const { findChannelById } = require('../channels/channel.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { createMessage, updateMessageStatus, recordMessageSent } = require('../conversations/message.repository');
const { sendTextMessage } = require('../whatsapp-adapters/meta-cloud.adapter');
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

  test('sends the message and records the whatsapp message id on success', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', config: { phoneNumberId: '123', accessToken: 'tok' } });
    createMessage.mockResolvedValue({ id: 'msg-1' });
    sendTextMessage.mockResolvedValue({ whatsappMessageId: 'wamid.OUT1' });

    await handler({ conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola cliente' });

    expect(sendTextMessage).toHaveBeenCalledWith(
      { id: 'channel-1', config: { phoneNumberId: '123', accessToken: 'tok' } },
      '5511999998888',
      'Ola cliente'
    );
    expect(recordMessageSent).toHaveBeenCalledWith('msg-1', 'wamid.OUT1');
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  test('marks the message failed and rethrows when sending fails', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', contactPhoneNumber: '5511999998888' });
    findChannelById.mockResolvedValue({ id: 'channel-1', config: {} });
    createMessage.mockResolvedValue({ id: 'msg-2' });
    sendTextMessage.mockRejectedValue(new Error('network error'));

    await expect(
      handler({ conversationId: 'conv-1', channelId: 'channel-1', content: 'Ola' })
    ).rejects.toThrow('network error');

    expect(updateMessageStatus).toHaveBeenCalledWith('msg-2', 'failed');
    expect(recordMessageSent).not.toHaveBeenCalled();
  });
});
