jest.mock('../channels/channel.repository');
jest.mock('./triage.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../queue/outbound-queue');

const { findChannelById } = require('../channels/channel.repository');
const { getTriageConfig, listTriageOptions } = require('./triage.repository');
const { completeTriage, incrementTriageAttempts } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { shouldStartTriage, sendTriageQuestion, processTriageReply } = require('./triage.service');

const CONFIG = { questionText: 'Escolha uma opção:', confirmationText: 'Obrigado, já te encaminhamos.', maxAttempts: 2 };
const OPTIONS = [
  { id: 'opt-1', optionNumber: 1, sectorId: 'sector-1', sectorName: 'Financeiro', keywords: ['fatura', 'boleto'] },
  { id: 'opt-2', optionNumber: 2, sectorId: 'sector-2', sectorName: 'Suporte', keywords: ['internet', 'sem sinal'] },
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('shouldStartTriage', () => {
  test('returns false when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    expect(await shouldStartTriage('channel-1')).toBe(false);
    expect(listTriageOptions).not.toHaveBeenCalled();
  });

  test('returns false without checking options when triageEnabled is false', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', triageEnabled: false });
    expect(await shouldStartTriage('channel-1')).toBe(false);
    expect(listTriageOptions).not.toHaveBeenCalled();
  });

  test('returns false when triageEnabled is true but there are zero options configured', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', triageEnabled: true });
    listTriageOptions.mockResolvedValue([]);
    expect(await shouldStartTriage('channel-1')).toBe(false);
  });

  test('returns true when triageEnabled is true and at least one option is configured', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', triageEnabled: true });
    listTriageOptions.mockResolvedValue(OPTIONS);
    expect(await shouldStartTriage('channel-1')).toBe(true);
  });
});

describe('sendTriageQuestion', () => {
  test('enqueues the question composed with the numbered options', async () => {
    getTriageConfig.mockResolvedValue(CONFIG);
    listTriageOptions.mockResolvedValue(OPTIONS);

    await sendTriageQuestion('conv-1', 'channel-1');

    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Escolha uma opção:\n1 - Financeiro\n2 - Suporte',
    });
  });

  test('enqueues just the question text when there are no options', async () => {
    getTriageConfig.mockResolvedValue(CONFIG);
    listTriageOptions.mockResolvedValue([]);

    await sendTriageQuestion('conv-1', 'channel-1');

    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Escolha uma opção:',
    });
  });
});

describe('processTriageReply', () => {
  const conversation = { id: 'conv-1', triageState: 'pending', triageAttempts: 0 };

  beforeEach(() => {
    listTriageOptions.mockResolvedValue(OPTIONS);
    getTriageConfig.mockResolvedValue(CONFIG);
  });

  test('completes triage and sends the confirmation when the reply matches an option', async () => {
    const updated = { ...conversation, sectorId: 'sector-1', triageState: 'completed' };
    completeTriage.mockResolvedValue(updated);

    const result = await processTriageReply(conversation, 'channel-1', '1');

    expect(completeTriage).toHaveBeenCalledWith('conv-1', 'sector-1');
    expect(incrementTriageAttempts).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: CONFIG.confirmationText,
    });
    expect(result).toBe(updated);
  });

  test('matches a keyword substring case-insensitively', async () => {
    completeTriage.mockResolvedValue({ ...conversation, sectorId: 'sector-2', triageState: 'completed' });

    await processTriageReply(conversation, 'channel-1', 'estou SEM SINAL de internet');

    expect(completeTriage).toHaveBeenCalledWith('conv-1', 'sector-2');
  });

  test('does nothing when a match loses the race and completeTriage is guarded away', async () => {
    completeTriage.mockResolvedValue(null);

    const result = await processTriageReply(conversation, 'channel-1', '1');

    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(result).toBe(conversation);
  });

  test('increments attempts and repeats the question on a non-matching reply', async () => {
    incrementTriageAttempts.mockResolvedValue(1);

    const result = await processTriageReply(conversation, 'channel-1', 'blablabla');

    expect(incrementTriageAttempts).toHaveBeenCalledWith('conv-1');
    expect(completeTriage).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Escolha uma opção:\n1 - Financeiro\n2 - Suporte',
    });
    expect(result).toEqual({ ...conversation, triageAttempts: 1 });
  });

  test('does nothing when a non-match loses the race and incrementTriageAttempts is guarded away', async () => {
    incrementTriageAttempts.mockResolvedValue(0);

    const result = await processTriageReply(conversation, 'channel-1', 'blablabla');

    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(completeTriage).not.toHaveBeenCalled();
    expect(result).toBe(conversation);
  });

  test('falls through to the general queue once attempts reach maxAttempts', async () => {
    incrementTriageAttempts.mockResolvedValue(2);
    const updated = { ...conversation, sectorId: null, triageState: 'completed', triageAttempts: 2 };
    completeTriage.mockResolvedValue(updated);

    const result = await processTriageReply(conversation, 'channel-1', 'nao entendi nada');

    expect(completeTriage).toHaveBeenCalledWith('conv-1', null);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: CONFIG.confirmationText,
    });
    expect(result).toBe(updated);
  });

  test('falls through to the general queue when attempts exceed maxAttempts', async () => {
    incrementTriageAttempts.mockResolvedValue(3);
    const updated = { ...conversation, sectorId: null, triageState: 'completed', triageAttempts: 3 };
    completeTriage.mockResolvedValue(updated);

    await processTriageReply(conversation, 'channel-1', 'nao entendi nada');

    expect(completeTriage).toHaveBeenCalledWith('conv-1', null);
  });

  test('respects a maxAttempts of 1 (falls through on the very first miss)', async () => {
    getTriageConfig.mockResolvedValue({ ...CONFIG, maxAttempts: 1 });
    incrementTriageAttempts.mockResolvedValue(1);
    const updated = { ...conversation, sectorId: null, triageState: 'completed', triageAttempts: 1 };
    completeTriage.mockResolvedValue(updated);

    const result = await processTriageReply(conversation, 'channel-1', 'oi');

    expect(completeTriage).toHaveBeenCalledWith('conv-1', null);
    expect(result).toBe(updated);
  });

  test('does not crash on an empty or null reply and treats it as non-matching', async () => {
    incrementTriageAttempts.mockResolvedValue(1);

    const result = await processTriageReply(conversation, 'channel-1', null);

    expect(incrementTriageAttempts).toHaveBeenCalledWith('conv-1');
    expect(result).toEqual({ ...conversation, triageAttempts: 1 });
  });
});
