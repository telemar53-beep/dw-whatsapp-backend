jest.mock('./media-compression-queue');
jest.mock('../conversations/message.repository');
jest.mock('../media/media-storage');
jest.mock('../media/video-compressor');
jest.mock('fs', () => ({ promises: { readFile: jest.fn() } }));

const fs = require('fs');
const { findMessageById, updateMessageMedia } = require('../conversations/message.repository');
const { getMediaFilePath, saveMediaFile, deleteMediaFile } = require('../media/media-storage');
const { compressVideo } = require('../media/video-compressor');
const { handleMediaCompressionJob } = require('./media-compression-worker');

const VIDEO = { id: 'msg-1', messageType: 'video', mediaPath: 'original.mp4', mediaMimeType: 'video/mp4' };

beforeEach(() => {
  jest.clearAllMocks();
  findMessageById.mockResolvedValue(VIDEO);
  getMediaFilePath.mockReturnValue('/data/original.mp4');
  fs.promises.readFile.mockResolvedValue(Buffer.alloc(5 * 1024 * 1024, 1));
  compressVideo.mockReturnValue({ buffer: Buffer.alloc(1024 * 1024, 2), mimeType: 'video/mp4' });
  saveMediaFile.mockResolvedValue('menor.mp4');
  updateMessageMedia.mockResolvedValue({ ...VIDEO, mediaPath: 'menor.mp4' });
  deleteMediaFile.mockResolvedValue(undefined);
});

describe('handleMediaCompressionJob', () => {
  test('comprime o vídeo, troca o arquivo da mensagem e apaga o original', async () => {
    await handleMediaCompressionJob({ messageId: 'msg-1' });

    expect(compressVideo).toHaveBeenCalled();
    expect(saveMediaFile).toHaveBeenCalled();
    expect(updateMessageMedia).toHaveBeenCalledWith('msg-1', { mediaPath: 'menor.mp4', mediaMimeType: 'video/mp4' });
    expect(deleteMediaFile).toHaveBeenCalledWith('original.mp4');
  });

  // Se a compressão não valeu a pena, o original continua no lugar: gravar um
  // arquivo novo igual só desperdiçaria disco, que é o que estamos economizando.
  test('não troca nada quando a compressão não reduziu', async () => {
    const original = Buffer.alloc(5 * 1024 * 1024, 1);
    fs.promises.readFile.mockResolvedValue(original);
    compressVideo.mockReturnValue({ buffer: original, mimeType: 'video/mp4' });

    await handleMediaCompressionJob({ messageId: 'msg-1' });

    expect(saveMediaFile).not.toHaveBeenCalled();
    expect(updateMessageMedia).not.toHaveBeenCalled();
    expect(deleteMediaFile).not.toHaveBeenCalled();
  });

  test('ignora mensagem que não existe mais', async () => {
    findMessageById.mockResolvedValue(null);

    await handleMediaCompressionJob({ messageId: 'sumida' });

    expect(compressVideo).not.toHaveBeenCalled();
  });

  test('ignora mensagem que não é vídeo', async () => {
    findMessageById.mockResolvedValue({ ...VIDEO, messageType: 'image', mediaMimeType: 'image/jpeg' });

    await handleMediaCompressionJob({ messageId: 'msg-1' });

    expect(compressVideo).not.toHaveBeenCalled();
  });

  // O original só é apagado DEPOIS que a mensagem já aponta para o novo: na
  // ordem inversa, uma falha no meio deixaria a mensagem apontando para um
  // arquivo que não existe mais — o cliente perderia o vídeo.
  test('não apaga o original se a mensagem não pôde ser atualizada', async () => {
    updateMessageMedia.mockResolvedValue(null);

    await handleMediaCompressionJob({ messageId: 'msg-1' });

    expect(deleteMediaFile).not.toHaveBeenCalled();
  });

  test('arquivo indisponível não derruba o worker', async () => {
    fs.promises.readFile.mockRejectedValue(new Error('sumiu'));

    await expect(handleMediaCompressionJob({ messageId: 'msg-1' })).resolves.toBeUndefined();
    expect(updateMessageMedia).not.toHaveBeenCalled();
  });
});
