jest.mock('bull');
const Queue = require('bull');

const addMock = jest.fn();
Queue.mockImplementation(() => ({ add: addMock, process: jest.fn(), close: jest.fn() }));

const { enqueueTranscription } = require('./transcription-queue');

describe('transcription-queue', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enfileira com os dois ids e sem repetição automática', async () => {
    await enqueueTranscription({ conversationId: 'c-1', messageId: 'm-1' });
    expect(addMock).toHaveBeenCalledWith(
      { conversationId: 'c-1', messageId: 'm-1' },
      expect.objectContaining({ attempts: 1, removeOnComplete: true, removeOnFail: true })
    );
  });

  test('não usa jobId customizado', async () => {
    await enqueueTranscription({ conversationId: 'c-1', messageId: 'm-1' });
    expect(addMock.mock.calls[0][1].jobId).toBeUndefined();
  });
});
