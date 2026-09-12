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
const { findMessageById, markTranscriptionFailed } = require('../conversations/message.repository');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
const { processTranscriptionQueue } = require('./transcription-queue');
const { handleTranscriptionJob, handleTranscriptionWorkerFailure, startTranscriptionWorker } = require('./transcription-worker');

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

  describe('Finding 5: rede de segurança para exceção fora do transcription.service', () => {
    test('marca failed e avisa a tela via emitToAgent quando a conversa tem atendente', async () => {
      markTranscriptionFailed.mockResolvedValue({
        transcription: null, transcriptionStatus: 'failed', transcriptionDetail: 'erro interno',
      });
      getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: 'a-1' });

      await handleTranscriptionWorkerFailure({ conversationId: 'c-1', messageId: 'm-1' }, new Error('TypeError: cannot read x of null'));

      expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'failed' }));
      expect(emitToAgent).toHaveBeenCalledWith('a-1', 'message:transcription', expect.objectContaining({
        conversationId: 'c-1', messageId: 'm-1', transcriptionStatus: 'failed',
      }));
      expect(broadcast).not.toHaveBeenCalled();
    });

    test('faz broadcast quando a conversa não tem atendente atribuído', async () => {
      markTranscriptionFailed.mockResolvedValue({
        transcription: null, transcriptionStatus: 'failed', transcriptionDetail: 'erro interno',
      });
      getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null });

      await handleTranscriptionWorkerFailure({ conversationId: 'c-1', messageId: 'm-1' }, new Error('db down'));

      expect(broadcast).toHaveBeenCalledWith('message:transcription', expect.objectContaining({ transcriptionStatus: 'failed' }));
      expect(emitToAgent).not.toHaveBeenCalled();
    });

    test('uma segunda falha (markTranscriptionFailed rejeitando) não escapa — ainda assim tenta avisar a tela', async () => {
      markTranscriptionFailed.mockRejectedValue(new Error('db também fora'));
      getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null });

      await expect(
        handleTranscriptionWorkerFailure({ conversationId: 'c-1', messageId: 'm-1' }, new Error('erro original'))
      ).resolves.toBeUndefined();

      expect(broadcast).toHaveBeenCalledWith('message:transcription', expect.objectContaining({ transcriptionStatus: 'failed' }));
    });

    test('uma terceira falha (getConversationWithContact rejeitando também) não escapa', async () => {
      markTranscriptionFailed.mockRejectedValue(new Error('db fora'));
      getConversationWithContact.mockRejectedValue(new Error('db fora de novo'));

      await expect(
        handleTranscriptionWorkerFailure({ conversationId: 'c-1', messageId: 'm-1' }, new Error('erro original'))
      ).resolves.toBeUndefined();

      expect(emitToAgent).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    });

    test('a chave da OpenAI nunca aparece no log de erro (mensagemSegura)', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      markTranscriptionFailed.mockResolvedValue({ transcriptionStatus: 'failed' });
      getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: null });
      const erroComChave = new Error('Request failed');
      erroComChave.cause = { status: 500, message: 'server error' };

      await handleTranscriptionWorkerFailure({ conversationId: 'c-1', messageId: 'm-1' }, erroComChave);

      const logs = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logs).not.toContain('sk-');
      consoleSpy.mockRestore();
    });

    test('transcribeMessage lançando (ex.: getAiConfig() null virando TypeError) aciona a rede de segurança fim a fim, sem propagar', async () => {
      transcribeMessage.mockRejectedValue(new TypeError("Cannot read properties of null (reading 'transcriptionEnabled')"));
      markTranscriptionFailed.mockResolvedValue({ transcriptionStatus: 'failed', transcriptionDetail: 'erro interno' });
      getConversationWithContact.mockResolvedValue({ id: 'c-1', assignedAgentId: 'a-1' });
      jest.spyOn(console, 'error').mockImplementation(() => {});

      startTranscriptionWorker();
      const handler = processTranscriptionQueue.mock.calls[0][0];

      await expect(handler({ conversationId: 'c-1', messageId: 'm-1' })).resolves.toBeUndefined();

      expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'failed' }));
      expect(emitToAgent).toHaveBeenCalledWith('a-1', 'message:transcription', expect.objectContaining({ transcriptionStatus: 'failed' }));

      console.error.mockRestore();
    });
  });
});
