jest.mock('../whatsapp-adapters/meta-cloud.adapter');
jest.mock('./message.repository');
jest.mock('./conversation.repository');
jest.mock('../realtime/socket-server');
const { parseStatusUpdates } = require('../whatsapp-adapters/meta-cloud.adapter');
const { advanceMessageStatus } = require('./message.repository');
const { getConversationWithContact } = require('./conversation.repository');
const { emitToAgent } = require('../realtime/socket-server');
const { applyMessageStatusUpdates } = require('./message-status.service');

describe('applyMessageStatusUpdates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('advances the message status and emits message:updated to the assigned agent', async () => {
    parseStatusUpdates.mockReturnValue([{ whatsappMessageId: 'wamid.ABC', status: 'delivered' }]);
    advanceMessageStatus.mockResolvedValue({ id: 'msg-1', conversationId: 'conv-1', status: 'delivered' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-1' });

    await applyMessageStatusUpdates({ entry: [] });

    expect(advanceMessageStatus).toHaveBeenCalledWith('wamid.ABC', 'delivered');
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:updated', {
      conversationId: 'conv-1',
      message: { id: 'msg-1', conversationId: 'conv-1', status: 'delivered' },
    });
  });

  test('does not emit when the conversation has no assigned agent', async () => {
    parseStatusUpdates.mockReturnValue([{ whatsappMessageId: 'wamid.ABC', status: 'delivered' }]);
    advanceMessageStatus.mockResolvedValue({ id: 'msg-1', conversationId: 'conv-1', status: 'delivered' });
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', assignedAgentId: null });

    await applyMessageStatusUpdates({ entry: [] });

    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('skips silently when the status update does not match a known message (out of order or unknown id)', async () => {
    parseStatusUpdates.mockReturnValue([{ whatsappMessageId: 'wamid.UNKNOWN', status: 'delivered' }]);
    advanceMessageStatus.mockResolvedValue(null);

    await applyMessageStatusUpdates({ entry: [] });

    expect(getConversationWithContact).not.toHaveBeenCalled();
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('processes every status update in the batch', async () => {
    parseStatusUpdates.mockReturnValue([
      { whatsappMessageId: 'wamid.A', status: 'delivered' },
      { whatsappMessageId: 'wamid.B', status: 'read' },
    ]);
    advanceMessageStatus
      .mockResolvedValueOnce({ id: 'msg-a', conversationId: 'conv-a', status: 'delivered' })
      .mockResolvedValueOnce({ id: 'msg-b', conversationId: 'conv-b', status: 'read' });
    getConversationWithContact
      .mockResolvedValueOnce({ id: 'conv-a', assignedAgentId: 'agent-1' })
      .mockResolvedValueOnce({ id: 'conv-b', assignedAgentId: 'agent-2' });

    await applyMessageStatusUpdates({ entry: [] });

    expect(emitToAgent).toHaveBeenCalledTimes(2);
    expect(emitToAgent).toHaveBeenNthCalledWith(1, 'agent-1', 'message:updated', {
      conversationId: 'conv-a',
      message: { id: 'msg-a', conversationId: 'conv-a', status: 'delivered' },
    });
    expect(emitToAgent).toHaveBeenNthCalledWith(2, 'agent-2', 'message:updated', {
      conversationId: 'conv-b',
      message: { id: 'msg-b', conversationId: 'conv-b', status: 'read' },
    });
  });
});
