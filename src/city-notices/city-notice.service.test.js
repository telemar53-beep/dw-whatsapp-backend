jest.mock('./city-notice.repository');
jest.mock('../queue/outbound-queue');

const { findActiveCityNoticeByCityId, recordNoticeDelivery } = require('./city-notice.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { enviarAvisoDeCidadeSePreciso } = require('./city-notice.service');

const AVISO = { id: 'notice-1', cityId: 'city-1', message: 'Instabilidade na rede' };

describe('enviarAvisoDeCidadeSePreciso', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findActiveCityNoticeByCityId.mockResolvedValue(AVISO);
    recordNoticeDelivery.mockResolvedValue(true);
  });

  test('manda o aviso ativo da cidade do contato e devolve o aviso', async () => {
    const enviado = await enviarAvisoDeCidadeSePreciso({
      contact: { id: 'ct-1', cityId: 'city-1' }, conversationId: 'conv-1', channelId: 'ch-1',
    });

    expect(findActiveCityNoticeByCityId).toHaveBeenCalledWith('city-1');
    expect(recordNoticeDelivery).toHaveBeenCalledWith('notice-1', 'ct-1');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1', channelId: 'ch-1', content: 'Instabilidade na rede',
    });
    expect(enviado).toEqual(AVISO);
  });

  test('não repete o aviso para quem já recebeu', async () => {
    recordNoticeDelivery.mockResolvedValue(false);

    const enviado = await enviarAvisoDeCidadeSePreciso({
      contact: { id: 'ct-1', cityId: 'city-1' }, conversationId: 'conv-1', channelId: 'ch-1',
    });

    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(enviado).toBeNull();
  });

  test('sem aviso ativo na cidade, não manda nada', async () => {
    findActiveCityNoticeByCityId.mockResolvedValue(null);

    const enviado = await enviarAvisoDeCidadeSePreciso({
      contact: { id: 'ct-1', cityId: 'city-2' }, conversationId: 'conv-1', channelId: 'ch-1',
    });

    expect(recordNoticeDelivery).not.toHaveBeenCalled();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(enviado).toBeNull();
  });

  test('contato sem cidade não gera envio', async () => {
    findActiveCityNoticeByCityId.mockResolvedValue(null);

    const enviado = await enviarAvisoDeCidadeSePreciso({
      contact: { id: 'ct-1', cityId: null }, conversationId: 'conv-1', channelId: 'ch-1',
    });

    expect(findActiveCityNoticeByCityId).toHaveBeenCalledWith(null);
    expect(enviado).toBeNull();
  });

  test('deixa o erro subir: quem chama decide se derruba o fluxo', async () => {
    findActiveCityNoticeByCityId.mockRejectedValue(new Error('db unavailable'));

    await expect(enviarAvisoDeCidadeSePreciso({
      contact: { id: 'ct-1', cityId: 'city-1' }, conversationId: 'conv-1', channelId: 'ch-1',
    })).rejects.toThrow('db unavailable');
  });
});
