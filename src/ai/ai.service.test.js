jest.mock('../channels/channel.repository');
jest.mock('./ai-config.repository');
jest.mock('../queue/ai-queue');
jest.mock('../queue/transcription-queue');
jest.mock('../conversations/message.repository');

const { findChannelById } = require('../channels/channel.repository');
const { getAiConfig } = require('./ai-config.repository');
const { enqueueAiReply } = require('../queue/ai-queue');
const { enqueueTranscription } = require('../queue/transcription-queue');
const { markTranscriptionPending } = require('../conversations/message.repository');
const {
  shouldRunAi, scheduleAiReply, shouldTranscribe, markTranscriptionScheduled, enqueueTranscriptionJob,
} = require('./ai.service');

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

  test('shouldTranscribe exige canal com IA, transcrição ligada e modelo', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true });
    getAiConfig.mockResolvedValue({ transcriptionEnabled: true, transcriptionModel: 'm' });
    expect(await shouldTranscribe('ch-1')).toBe(true);
  });

  test('shouldTranscribe é false sem IA no canal', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: false });
    getAiConfig.mockResolvedValue({ transcriptionEnabled: true, transcriptionModel: 'm' });
    expect(await shouldTranscribe('ch-1')).toBe(false);
  });

  test('shouldTranscribe é false com transcrição desligada', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true });
    getAiConfig.mockResolvedValue({ transcriptionEnabled: false, transcriptionModel: 'm' });
    expect(await shouldTranscribe('ch-1')).toBe(false);
  });

  test('shouldTranscribe é false sem modelo de transcrição', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true });
    getAiConfig.mockResolvedValue({ transcriptionEnabled: true, transcriptionModel: '' });
    expect(await shouldTranscribe('ch-1')).toBe(false);
  });

  test('markTranscriptionScheduled só marca pending para áudio, com a duração, e devolve a linha', async () => {
    markTranscriptionPending.mockResolvedValue({ id: 'm-1', transcriptionStatus: 'pending' });
    const result = await markTranscriptionScheduled({ id: 'm-1', messageType: 'audio' }, 12);
    expect(markTranscriptionPending).toHaveBeenCalledWith('m-1', 12);
    expect(result).toEqual({ id: 'm-1', transcriptionStatus: 'pending' });

    jest.clearAllMocks();
    const naoAudio = await markTranscriptionScheduled({ id: 'm-2', messageType: 'image' }, null);
    expect(markTranscriptionPending).not.toHaveBeenCalled();
    expect(naoAudio).toBeNull();
  });

  test('markTranscriptionScheduled sem duração no metadado marca pending mesmo assim', async () => {
    // O WhatsApp nem sempre manda `seconds`. O limite de tamanho em bytes continua
    // protegendo, então áudio sem duração não pode ser descartado.
    markTranscriptionPending.mockResolvedValue({ id: 'm-3', transcriptionStatus: 'pending' });
    await markTranscriptionScheduled({ id: 'm-3', messageType: 'audio' }, null);
    expect(markTranscriptionPending).toHaveBeenCalledWith('m-3', null);
  });

  test('enqueueTranscriptionJob só enfileira áudio', async () => {
    await enqueueTranscriptionJob({ id: 'c-1' }, { id: 'm-1', messageType: 'audio' });
    expect(enqueueTranscription).toHaveBeenCalledWith({ conversationId: 'c-1', messageId: 'm-1' });

    jest.clearAllMocks();
    await enqueueTranscriptionJob({ id: 'c-1' }, { id: 'm-2', messageType: 'image' });
    expect(enqueueTranscription).not.toHaveBeenCalled();
  });
});
