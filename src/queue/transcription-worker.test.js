jest.mock('./transcription-queue');
jest.mock('../ai/transcription.service');
jest.mock('../ai/ai-config.repository');
jest.mock('../ai/ai.service');
jest.mock('../queue/ai-queue');
jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/message.repository');
jest.mock('../realtime/socket-server');

const { transcribeMessage } = require('../ai/transcription.service');
const { getAiConfig } = require('../ai/ai-config.repository');
const { shouldRunAi } = require('../ai/ai.service');
const { enqueueAiReply } = require('./ai-queue');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findMessageById } = require('../conversations/message.repository');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { handleTranscriptionJob } = require('./transcription-worker');

beforeEach(() => {
  jest.clearAllMocks();
  getConversationWithContact.mockResolvedValue({ id: 'c-1', channelId: 'ch-1', assignedAgentId: 'a-1' });
  findMessageById.mockResolvedValue({ id: 'm-1', transcription: 'texto', transcriptionStatus: 'completed' });
  getAiConfig.mockResolvedValue({ transcriptionFeedAi: true });
  shouldRunAi.mockResolvedValue(true);
});

describe('transcription-worker', () => {
  test('transcreve, avisa a tela e enfileira o turno de IA', async () => {
    transcribeMessage.mockResolvedValue({ ok: true, transcription: 'texto' });

    await handleTranscriptionJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(emitToAgent).toHaveBeenCalledWith('a-1', 'message:transcription', expect.objectContaining({
      conversationId: 'c-1', messageId: 'm-1',
    }));
    expect(enqueueAiReply).toHaveBeenCalledWith({ conversationId: 'c-1', messageId: 'm-1' });
  });

  test('avisa a fila quando a conversa não tem atendente', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'c-1', channelId: 'ch-1', assignedAgentId: null });
    transcribeMessage.mockResolvedValue({ ok: true, transcription: 'texto' });

    await handleTranscriptionJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(broadcast).toHaveBeenCalledWith('message:transcription', expect.any(Object));
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('transcrição falha: avisa a tela mas NÃO enfileira a IA', async () => {
    transcribeMessage.mockResolvedValue({ ok: false, motivo: 'transcription_failed' });

    await handleTranscriptionJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(emitToAgent).toHaveBeenCalled();
    expect(enqueueAiReply).not.toHaveBeenCalled();
  });

  test('com transcriptionFeedAi desligado, transcreve mas não aciona a IA', async () => {
    transcribeMessage.mockResolvedValue({ ok: true, transcription: 'texto' });
    getAiConfig.mockResolvedValue({ transcriptionFeedAi: false });

    await handleTranscriptionJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(emitToAgent).toHaveBeenCalled();
    expect(enqueueAiReply).not.toHaveBeenCalled();
  });

  test('não aciona a IA quando o canal não a tem ligada', async () => {
    transcribeMessage.mockResolvedValue({ ok: true, transcription: 'texto' });
    shouldRunAi.mockResolvedValue(false);

    await handleTranscriptionJob({ conversationId: 'c-1', messageId: 'm-1' });

    expect(enqueueAiReply).not.toHaveBeenCalled();
  });
});
