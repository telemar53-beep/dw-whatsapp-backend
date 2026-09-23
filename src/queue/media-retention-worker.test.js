jest.mock('./media-retention-queue');
jest.mock('../conversations/message.repository');
jest.mock('../media/media-storage');

const { listExpiredMedia, clearMessageMedia } = require('../conversations/message.repository');
const { deleteMediaFile } = require('../media/media-storage');
const { handleMediaRetentionJob, diasDeRetencao } = require('./media-retention-worker');

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

    expect(listExpiredMedia).toHaveBeenCalledWith(expect.objectContaining({ olderThanDays: diasDeRetencao() }));
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

  test('guarda 90 dias por padrão', () => {
    expect(diasDeRetencao()).toBe(90);
  });

  // A varredura APAGA arquivo: valor inválido tem de cair no padrão, nunca
  // virar `now() - 0 dias` (leva a mídia de hoje) nem uma data no futuro.
  test.each([['0'], ['-5'], ['abc'], ['']])('MEDIA_RETENTION_DAYS=%s cai no padrão', (valor) => {
    const anterior = process.env.MEDIA_RETENTION_DAYS;
    process.env.MEDIA_RETENTION_DAYS = valor;
    try {
      expect(diasDeRetencao()).toBe(90);
    } finally {
      if (anterior === undefined) delete process.env.MEDIA_RETENTION_DAYS;
      else process.env.MEDIA_RETENTION_DAYS = anterior;
    }
  });

  test('MEDIA_RETENTION_DAYS válido passa a valer', () => {
    const anterior = process.env.MEDIA_RETENTION_DAYS;
    process.env.MEDIA_RETENTION_DAYS = '30';
    try {
      expect(diasDeRetencao()).toBe(30);
    } finally {
      if (anterior === undefined) delete process.env.MEDIA_RETENTION_DAYS;
      else process.env.MEDIA_RETENTION_DAYS = anterior;
    }
  });
});
