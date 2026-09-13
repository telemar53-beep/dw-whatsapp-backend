jest.mock('../queue/outbound-queue');
jest.mock('../media/media-storage');

const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { saveMediaFile } = require('../media/media-storage');
const { enviarPix, enviarPixQr, enviarBoleto } = require('./payment-sender');
const { cartaoPix, cartaoPixQr, cartaoBoleto } = require('./payment-card');

const FATURA = { value: 135, dueDate: '2026-09-15', pixCode: '000201-pix-emv', barCode: '836100000012' };

describe('enviarPix', () => {
  beforeEach(() => {
    // resetAllMocks (não clearAllMocks): as filas de mockResolvedValueOnce de
    // um describe não podem vazar pro próximo — clearAllMocks só limpa
    // chamadas/resultados, não a implementação enfileirada.
    jest.resetAllMocks();
    enqueueOutboundMessage.mockResolvedValueOnce({ id: 'm-cartao' }).mockResolvedValueOnce({ id: 'm-codigo' });
  });

  test('enfileira o cartão e depois o código, nesta ordem', async () => {
    const result = await enviarPix({ conversationId: 'c-1', channelId: 'ch-1', fatura: FATURA, sentBy: 'ai' });

    expect(enqueueOutboundMessage).toHaveBeenCalledTimes(2);
    expect(enqueueOutboundMessage.mock.calls[0][0]).toEqual({
      conversationId: 'c-1', channelId: 'ch-1',
      content: cartaoPix({ valor: FATURA.value, vencimento: FATURA.dueDate }),
      messageType: 'text', sentBy: 'ai',
    });
    expect(enqueueOutboundMessage.mock.calls[1][0]).toEqual({
      conversationId: 'c-1', channelId: 'ch-1',
      content: FATURA.pixCode,
      messageType: 'text', sentBy: 'ai',
    });
    expect(result).toEqual([{ id: 'm-cartao' }, { id: 'm-codigo' }]);
  });

  test('propaga sentBy undefined (humano)', async () => {
    await enviarPix({ conversationId: 'c-1', channelId: 'ch-1', fatura: FATURA, sentBy: undefined });
    expect(enqueueOutboundMessage.mock.calls[0][0].sentBy).toBeUndefined();
    expect(enqueueOutboundMessage.mock.calls[1][0].sentBy).toBeUndefined();
  });

  test('lança erro quando a fatura não tem código PIX', async () => {
    await expect(
      enviarPix({ conversationId: 'c-1', channelId: 'ch-1', fatura: { ...FATURA, pixCode: '' }, sentBy: 'ai' })
    ).rejects.toThrow('Fatura sem código PIX');
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });
});

describe('enviarPixQr', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    saveMediaFile.mockResolvedValue('gerado.png');
    enqueueOutboundMessage.mockResolvedValueOnce({ id: 'm-cartao-qr' }).mockResolvedValueOnce({ id: 'm-codigo' });
  });

  test('gera um PNG do código, salva e enfileira a imagem seguida do código puro', async () => {
    const result = await enviarPixQr({ conversationId: 'c-1', channelId: 'ch-1', fatura: FATURA, sentBy: 'ai' });

    expect(saveMediaFile).toHaveBeenCalledTimes(1);
    const [buffer, extension] = saveMediaFile.mock.calls[0];
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(extension).toBe('.png');

    expect(enqueueOutboundMessage).toHaveBeenCalledTimes(2);
    expect(enqueueOutboundMessage.mock.calls[0][0]).toEqual({
      conversationId: 'c-1', channelId: 'ch-1',
      content: cartaoPixQr({ valor: FATURA.value, vencimento: FATURA.dueDate }),
      messageType: 'image', mediaPath: 'gerado.png', mediaMimeType: 'image/png', mediaFilename: 'pix.png',
      sentBy: 'ai',
    });
    expect(enqueueOutboundMessage.mock.calls[1][0]).toEqual({
      conversationId: 'c-1', channelId: 'ch-1',
      content: FATURA.pixCode,
      messageType: 'text', sentBy: 'ai',
    });
    expect(result).toEqual([{ id: 'm-cartao-qr' }, { id: 'm-codigo' }]);
  });

  test('lança erro quando a fatura não tem código PIX', async () => {
    await expect(
      enviarPixQr({ conversationId: 'c-1', channelId: 'ch-1', fatura: { ...FATURA, pixCode: '' }, sentBy: 'ai' })
    ).rejects.toThrow('Fatura sem código PIX');
    expect(saveMediaFile).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });
});

describe('enviarBoleto', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    enqueueOutboundMessage.mockResolvedValueOnce({ id: 'm-cartao-boleto' }).mockResolvedValueOnce({ id: 'm-linha' });
  });

  test('enfileira o cartão e depois a linha digitável, nesta ordem', async () => {
    const result = await enviarBoleto({ conversationId: 'c-1', channelId: 'ch-1', fatura: FATURA, sentBy: undefined });

    expect(enqueueOutboundMessage).toHaveBeenCalledTimes(2);
    expect(enqueueOutboundMessage.mock.calls[0][0]).toEqual({
      conversationId: 'c-1', channelId: 'ch-1',
      content: cartaoBoleto({ valor: FATURA.value, vencimento: FATURA.dueDate }),
      messageType: 'text', sentBy: undefined,
    });
    expect(enqueueOutboundMessage.mock.calls[1][0]).toEqual({
      conversationId: 'c-1', channelId: 'ch-1',
      content: FATURA.barCode,
      messageType: 'text', sentBy: undefined,
    });
    expect(result).toEqual([{ id: 'm-cartao-boleto' }, { id: 'm-linha' }]);
  });

  test('lança erro quando a fatura não tem código de barras', async () => {
    await expect(
      enviarBoleto({ conversationId: 'c-1', channelId: 'ch-1', fatura: { ...FATURA, barCode: '' }, sentBy: 'ai' })
    ).rejects.toThrow();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });
});
