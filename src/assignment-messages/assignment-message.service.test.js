jest.mock('./assignment-message.repository');
jest.mock('../agents/agent.repository');
jest.mock('../queue/outbound-queue');

const { getAssignmentMessageConfig, claimProtocolNumber } = require('./assignment-message.repository');
const { findAgentById } = require('../agents/agent.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { sendOpeningMessageIfApplicable, sendClosingMessageIfApplicable } = require('./assignment-message.service');

const CONVERSATION = { id: 'conv-1', channelId: 'channel-1', protocolNumber: null };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendOpeningMessageIfApplicable', () => {
  test('does nothing when the feature is disabled', async () => {
    getAssignmentMessageConfig.mockResolvedValue({ enabled: false, agentIds: ['agent-1'], channelIds: ['channel-1'], openingMessage: 'x' });
    await sendOpeningMessageIfApplicable(CONVERSATION, 'agent-1');
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('does nothing when the agent is not in the allowed list', async () => {
    getAssignmentMessageConfig.mockResolvedValue({ enabled: true, agentIds: ['agent-other'], channelIds: ['channel-1'], openingMessage: 'x' });
    await sendOpeningMessageIfApplicable(CONVERSATION, 'agent-1');
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('does nothing when the channel is not in the allowed list', async () => {
    getAssignmentMessageConfig.mockResolvedValue({ enabled: true, agentIds: ['agent-1'], channelIds: ['channel-other'], openingMessage: 'x' });
    await sendOpeningMessageIfApplicable(CONVERSATION, 'agent-1');
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('claims a protocol number, builds the text and enqueues it when enabled and both lists match', async () => {
    getAssignmentMessageConfig.mockResolvedValue({
      enabled: true,
      agentIds: ['agent-1'],
      channelIds: ['channel-1'],
      openingMessage: 'Olá, meu nome é @chat_atendente, protocolo @chat_protocolo',
    });
    findAgentById.mockResolvedValue({ id: 'agent-1', name: 'Geovanna Silva' });
    claimProtocolNumber.mockResolvedValue(1042);
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-1' });

    await sendOpeningMessageIfApplicable(CONVERSATION, 'agent-1');

    expect(claimProtocolNumber).toHaveBeenCalledWith('conv-1');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Olá, meu nome é Geovanna, protocolo 1042',
    });
  });
});

describe('sendClosingMessageIfApplicable', () => {
  test('does nothing when the conversation has no protocol number', async () => {
    await sendClosingMessageIfApplicable({ ...CONVERSATION, protocolNumber: null }, 'agent-1');
    expect(getAssignmentMessageConfig).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('sends the closing message when a protocol number already exists, without re-checking agent/channel lists', async () => {
    getAssignmentMessageConfig.mockResolvedValue({
      enabled: false,
      agentIds: [],
      channelIds: [],
      closingMessage: 'Encerrando o atendimento @chat_protocolo, @chat_atendente',
    });
    findAgentById.mockResolvedValue({ id: 'agent-1', name: 'Geovanna Silva' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-2' });

    await sendClosingMessageIfApplicable({ ...CONVERSATION, protocolNumber: 1042 }, 'agent-1');

    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Encerrando o atendimento 1042, Geovanna',
    });
  });
});
