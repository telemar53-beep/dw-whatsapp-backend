jest.mock('./ai-config.repository');
jest.mock('./openai-client');
jest.mock('../conversations/message.repository');
jest.mock('../media/media-storage');

const fs = require('fs');
const { getAiConfig } = require('./ai-config.repository');
const { transcribeAudio, OpenAiRequestError } = require('./openai-client');
const {
  findMessageById, markTranscriptionProcessing, saveTranscription, markTranscriptionFailed,
} = require('../conversations/message.repository');
const { getMediaFilePath } = require('../media/media-storage');
const { transcribeMessage } = require('./transcription.service');

const CONFIG = {
  transcriptionEnabled: true, transcriptionModel: 'modelo-x',
  transcriptionMaxSeconds: 300, transcriptionMaxBytes: 1000000,
  transcriptionPrompt: 'PPPoE, ONU', apiKey: 'sk-chave',
};

const AUDIO = {
  id: 'm-1', messageType: 'audio', mediaPath: 'a.ogg', mediaMimeType: 'audio/ogg',
  audioDurationSeconds: 30,
};

beforeEach(() => {
  jest.clearAllMocks();
  getAiConfig.mockResolvedValue(CONFIG);
  getMediaFilePath.mockReturnValue('/media/a.ogg');
  jest.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 500 });
});

afterEach(() => {
  if (fs.promises.stat.mockRestore) fs.promises.stat.mockRestore();
});

describe('transcribeMessage', () => {
  test('transcreve e grava o texto', async () => {
    findMessageById.mockResolvedValue(AUDIO);
    transcribeAudio.mockResolvedValue({ texto: 'minha internet caiu' });
    saveTranscription.mockResolvedValue({ ...AUDIO, transcription: 'minha internet caiu' });

    const result = await transcribeMessage('m-1');

    expect(markTranscriptionProcessing).toHaveBeenCalledWith('m-1');
    expect(transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'sk-chave', model: 'modelo-x', filePath: '/media/a.ogg', prompt: 'PPPoE, ONU',
    }));
    expect(saveTranscription).toHaveBeenCalledWith('m-1', expect.objectContaining({
      transcription: 'minha internet caiu', model: 'modelo-x',
    }));
    expect(result.ok).toBe(true);
  });

  test('aceita o MIME com parâmetro de codec que o WhatsApp manda', async () => {
    findMessageById.mockResolvedValue({ ...AUDIO, mediaMimeType: 'audio/ogg; codecs=opus' });
    transcribeAudio.mockResolvedValue({ texto: 'ok' });
    saveTranscription.mockResolvedValue({});
    const result = await transcribeMessage('m-1');
    expect(result.ok).toBe(true);
  });

  test('recusa formato não suportado antes de qualquer chamada à OpenAI', async () => {
    findMessageById.mockResolvedValue({ ...AUDIO, mediaMimeType: 'application/pdf' });
    const result = await transcribeMessage('m-1');
    expect(result).toEqual({ ok: false, motivo: 'unsupported_mime' });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'skipped' }));
  });

  test('recusa mensagem que não é áudio', async () => {
    findMessageById.mockResolvedValue({ id: 'm-2', messageType: 'text', content: 'oi' });
    const result = await transcribeMessage('m-2');
    expect(result).toEqual({ ok: false, motivo: 'not_audio' });
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  test('mensagem de áudio sem mediaPath vira failed, não deixa a mensagem pendurada', async () => {
    findMessageById.mockResolvedValue({ ...AUDIO, mediaPath: null });
    const result = await transcribeMessage('m-1');
    expect(result).toEqual({ ok: false, motivo: 'no_media' });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'failed' }));
  });

  test('transcrição desligada é skipped e nunca chama a OpenAI', async () => {
    getAiConfig.mockResolvedValue({ ...CONFIG, transcriptionEnabled: false });
    findMessageById.mockResolvedValue(AUDIO);
    const result = await transcribeMessage('m-1');
    expect(result).toEqual({ ok: false, motivo: 'disabled' });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'skipped' }));
  });

  test('áudio longo demais é skipped, não failed', async () => {
    findMessageById.mockResolvedValue({ ...AUDIO, audioDurationSeconds: 999 });
    const result = await transcribeMessage('m-1');
    expect(result).toEqual({ ok: false, motivo: 'too_long' });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'skipped' }));
  });

  test('caminho de mídia inválido vira failed, não deixa a mensagem pendurada', async () => {
    findMessageById.mockResolvedValue(AUDIO);
    getMediaFilePath.mockImplementation(() => { throw new Error('Invalid media path'); });
    const result = await transcribeMessage('m-1');
    expect(result).toEqual({ ok: false, motivo: 'no_media' });
    expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'failed' }));
  });

  test('arquivo grande demais é skipped', async () => {
    findMessageById.mockResolvedValue(AUDIO);
    fs.promises.stat.mockResolvedValue({ size: 99999999 });
    const result = await transcribeMessage('m-1');
    expect(result).toEqual({ ok: false, motivo: 'too_large' });
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'skipped' }));
  });

  test('falha da API marca failed e nunca inventa texto', async () => {
    findMessageById.mockResolvedValue(AUDIO);
    transcribeAudio.mockRejectedValue(new OpenAiRequestError('caiu'));
    const result = await transcribeMessage('m-1');
    expect(result).toEqual({ ok: false, motivo: 'transcription_failed' });
    expect(saveTranscription).not.toHaveBeenCalled();
    expect(markTranscriptionFailed).toHaveBeenCalledWith('m-1', expect.objectContaining({ status: 'failed' }));
  });

  test('texto vazio da API é tratado como falha, não como transcrição vazia', async () => {
    findMessageById.mockResolvedValue(AUDIO);
    transcribeAudio.mockResolvedValue({ texto: '   ' });
    const result = await transcribeMessage('m-1');
    expect(result.ok).toBe(false);
    expect(saveTranscription).not.toHaveBeenCalled();
  });

  test('duração ausente não bloqueia — o limite de tamanho ainda protege', async () => {
    findMessageById.mockResolvedValue({ ...AUDIO, audioDurationSeconds: null });
    transcribeAudio.mockResolvedValue({ texto: 'ok' });
    saveTranscription.mockResolvedValue({});
    const result = await transcribeMessage('m-1');
    expect(result.ok).toBe(true);
  });
});
