jest.mock('../channels/channel.repository');
jest.mock('./ai-config.repository');
jest.mock('../queue/ai-queue');

const { findChannelById } = require('../channels/channel.repository');
const { getAiConfig } = require('./ai-config.repository');
const { enqueueAiReply } = require('../queue/ai-queue');
const { shouldRunAi, scheduleAiReply } = require('./ai.service');

beforeEach(() => jest.clearAllMocks());

describe('ai.service', () => {
  test('shouldRunAi requires the channel flag, a mode and an api key', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true });
    getAiConfig.mockResolvedValue({ mode: 'assistant', apiKey: 'sk', model: 'gpt-x' });
    expect(await shouldRunAi('ch-1')).toBe(true);
  });

  test('shouldRunAi is false when the channel flag is off', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: false });
    getAiConfig.mockResolvedValue({ mode: 'assistant', apiKey: 'sk', model: 'gpt-x' });
    expect(await shouldRunAi('ch-1')).toBe(false);
  });

  test('shouldRunAi is false when the mode is disabled or there is no key', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true });
    getAiConfig.mockResolvedValue({ mode: 'disabled', apiKey: 'sk', model: 'gpt-x' });
    expect(await shouldRunAi('ch-1')).toBe(false);

    getAiConfig.mockResolvedValue({ mode: 'assistant', apiKey: null, model: 'gpt-x' });
    expect(await shouldRunAi('ch-1')).toBe(false);
  });

  test('shouldRunAi is false when there is no model configured, even with a valid key', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true });
    getAiConfig.mockResolvedValue({ mode: 'assistant', apiKey: 'sk', model: null });
    expect(await shouldRunAi('ch-1')).toBe(false);
  });

  test('scheduleAiReply only enqueues text messages, carrying the triggering message id', async () => {
    await scheduleAiReply({ id: 'c-1' }, { id: 'm-1', messageType: 'text', content: 'oi' });
    expect(enqueueAiReply).toHaveBeenCalledWith({ conversationId: 'c-1', messageId: 'm-1' });

    jest.clearAllMocks();
    await scheduleAiReply({ id: 'c-1' }, { id: 'm-2', messageType: 'audio', content: null });
    expect(enqueueAiReply).not.toHaveBeenCalled();
  });
});
