jest.mock('bull');
const Queue = require('bull');

const addMock = jest.fn();

Queue.mockImplementation(() => ({ add: addMock, process: jest.fn(), close: jest.fn() }));

const { enqueueAiReply, AI_DEBOUNCE_MS } = require('./ai-queue');

describe('ai-queue', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enqueues the conversation and message id with a debounce delay', async () => {
    await enqueueAiReply({ conversationId: 'c-1', messageId: 'm-1' });
    expect(addMock).toHaveBeenCalledWith(
      { conversationId: 'c-1', messageId: 'm-1' },
      expect.objectContaining({ delay: AI_DEBOUNCE_MS })
    );
  });

  test('marks the job for removal on completion and on failure, to keep the queue from accumulating', async () => {
    // Sem jobId fixo, isto não é mais o que garante que uma conversa nunca
    // trave (essa garantia agora vem de "a mensagem mais nova ganha", checada
    // no worker) — mas ainda evita que jobs concluídos ou falhos se acumulem
    // na fila indefinidamente.
    await enqueueAiReply({ conversationId: 'c-1', messageId: 'm-1' });
    expect(addMock).toHaveBeenCalledWith(
      { conversationId: 'c-1', messageId: 'm-1' },
      expect.objectContaining({ removeOnComplete: true, removeOnFail: true })
    );
  });
});
