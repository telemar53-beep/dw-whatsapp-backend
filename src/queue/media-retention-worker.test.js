jest.mock('./media-retention-queue');
jest.mock('../conversations/message.repository');
jest.mock('../media/media-storage');

const { listExpiredMedia, clearMessageMedia } = require('../conversations/message.repository');
const { deleteMediaFile } = require('../media/media-storage');
const { handleMediaRetentionJob, RETENTION_MONTHS } = require('./media-retention-worker');

const ANTIGA = { id: 'msg-1', mediaPath: 'velho.jpg', messageType: 'image' };
const OUTRA = { id: 'msg-2', mediaPath: 'velho2.mp4', messageType: 'video' };

beforeEach(() => {
  jest.clearAllMocks();
  listExpiredMedia.mockResolvedValueOnce([ANTIGA, OUTRA]).mockResolvedValue([]);
  clearMessageMedia.mockResolvedValue({ id: 'msg-1' });
  deleteMediaFile.mockResolvedValue(undefined);
});

describe('handleMediaRetentionJob', () => {
  test('apaga os arquivos vencidos e limpa a referência na mensagem', async () => {
    const resultado = await handleMediaRetentionJob();

    expect(listExpiredMedia).toHaveBeenCalledWith(expect.objectContaining({ olderThanMonths: RETENTION_MONTHS }));
    expect(deleteMediaFile).toHaveBeenCalledWith('velho.jpg');
    expect(deleteMediaFile).toHaveBeenCalledWith('velho2.mp4');
    expect(clearMessageMedia).toHaveBeenCalledWith('msg-1');
    expect(clearMessageMedia).toHaveBeenCalledWith('msg-2');
    expect(resultado.removidos).toBe(2);
  });

  // O arquivo sai primeiro, a referência depois: na ordem inversa, uma falha no
  // meio deixaria o arquivo órfão no disco, invisível e para sempre — que é
  // exatamente o problema que estamos resolvendo.
  test('limpa a referência só depois de o arquivo ter saído', async () => {
    await handleMediaRetentionJob();

    expect(deleteMediaFile.mock.invocationCallOrder[0]).toBeLessThan(clearMessageMedia.mock.invocationCallOrder[0]);
  });

  // Arquivo que já não existe no disco (removido à mão, restore de backup) não
  // pode impedir a limpeza da referência — senão ele volta em toda varredura.
  test('arquivo ausente no disco ainda limpa a mensagem', async () => {
    deleteMediaFile.mockRejectedValue(new Error('ENOENT'));

    const resultado = await handleMediaRetentionJob();

    expect(clearMessageMedia).toHaveBeenCalledWith('msg-1');
    expect(resultado.removidos).toBe(2);
  });

  test('nada vencido não faz nada', async () => {
    listExpiredMedia.mockReset();
    listExpiredMedia.mockResolvedValue([]);

    const resultado = await handleMediaRetentionJob();

    expect(deleteMediaFile).not.toHaveBeenCalled();
    expect(resultado.removidos).toBe(0);
  });

  test('uma falha no banco não derruba o worker', async () => {
    listExpiredMedia.mockReset();
    listExpiredMedia.mockRejectedValue(new Error('db fora'));

    await expect(handleMediaRetentionJob()).resolves.toEqual({ removidos: 0 });
  });

  test('guarda 12 meses', () => {
    expect(RETENTION_MONTHS).toBe(12);
  });
});
