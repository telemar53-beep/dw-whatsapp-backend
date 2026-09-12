jest.mock('bull');
const Queue = require('bull');

const removeMock = jest.fn();
const getJobMock = jest.fn();
const addMock = jest.fn();

Queue.mockImplementation(() => ({ add: addMock, getJob: getJobMock, process: jest.fn(), close: jest.fn() }));

const { enqueueAiReply, AI_DEBOUNCE_MS } = require('./ai-queue');

describe('ai-queue', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enqueues with the conversation id as the job id and a debounce delay', async () => {
    getJobMock.mockResolvedValue(null);
    await enqueueAiReply({ conversationId: 'c-1' });
    expect(addMock).toHaveBeenCalledWith(
      { conversationId: 'c-1' },
      expect.objectContaining({ jobId: 'c-1', delay: AI_DEBOUNCE_MS })
    );
  });

  test('removes the pending job before scheduling a new one', async () => {
    getJobMock.mockResolvedValue({ remove: removeMock });
    await enqueueAiReply({ conversationId: 'c-1' });
    expect(removeMock).toHaveBeenCalled();
    expect(addMock).toHaveBeenCalled();
  });

  test('still enqueues when the pending job can no longer be removed', async () => {
    // Job que já começou a rodar não pode ser removido — o ciclo novo é agendado
    // mesmo assim, senão a última mensagem do cliente ficaria sem resposta.
    getJobMock.mockResolvedValue({ remove: jest.fn().mockRejectedValue(new Error('locked')) });
    await enqueueAiReply({ conversationId: 'c-1' });
    expect(addMock).toHaveBeenCalled();
  });

  test('marks the job for removal on failure too, so a crash cannot strand the conversation id forever', async () => {
    // Bull ignora silenciosamente add() com um jobId que já existe em QUALQUER
    // estado, inclusive 'failed'. Como o jobId aqui é o id da conversa, um job
    // que falhasse e ficasse parado no failed set derrubaria todas as
    // mensagens futuras dessa conversa, sem erro nenhum em lugar nenhum.
    getJobMock.mockResolvedValue(null);
    await enqueueAiReply({ conversationId: 'c-1' });
    expect(addMock).toHaveBeenCalledWith(
      { conversationId: 'c-1' },
      expect.objectContaining({ removeOnFail: true })
    );
  });
});
