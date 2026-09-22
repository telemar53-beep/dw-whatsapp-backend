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

    // Antes a consulta era feita com null e o banco respondia vazio. Com a
    // seleção hierárquica, contato sem cidade nem localidade não chega a
    // consultar — mesmo resultado, sem ida inútil ao banco.
    expect(findActiveCityNoticeByCityId).not.toHaveBeenCalled();
    expect(enviado).toBeNull();
  });

  test('deixa o erro subir: quem chama decide se derruba o fluxo', async () => {
    findActiveCityNoticeByCityId.mockRejectedValue(new Error('db unavailable'));

    await expect(enviarAvisoDeCidadeSePreciso({
      contact: { id: 'ct-1', cityId: 'city-1' }, conversationId: 'conv-1', channelId: 'ch-1',
    })).rejects.toThrow('db unavailable');
  });
});

const { selecionarAvisoDoContato } = require('./city-notice.service');

const AVISO_LOCAL = { id: 'notice-loc', cityId: 'loc-1', message: 'Falha no povoado' };
const AVISO_MUNICIPAL = { id: 'notice-mun', cityId: 'city-1', message: 'Falha no municipio' };

// A escolha acontece ANTES da conferencia de entrega, de proposito: um aviso
// local ja entregue NAO significa "localidade sem aviso" e nao pode abrir
// caminho para o municipal.
describe('selecionarAvisoDoContato', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('contato sem localidade mantem a busca pelo municipio', async () => {
    findActiveCityNoticeByCityId.mockResolvedValue(AVISO_MUNICIPAL);

    const escolha = await selecionarAvisoDoContato({ id: 'ct-1', cityId: 'city-1', localityId: null });

    expect(findActiveCityNoticeByCityId).toHaveBeenCalledTimes(1);
    expect(findActiveCityNoticeByCityId).toHaveBeenCalledWith('city-1');
    expect(escolha).toEqual({ aviso: AVISO_MUNICIPAL, lugarId: 'city-1' });
  });

  test('aviso da localidade tem prioridade, e o municipio nem e consultado', async () => {
    findActiveCityNoticeByCityId.mockImplementation(async (id) => (id === 'loc-1' ? AVISO_LOCAL : AVISO_MUNICIPAL));

    const escolha = await selecionarAvisoDoContato({ id: 'ct-1', cityId: 'city-1', localityId: 'loc-1' });

    expect(escolha).toEqual({ aviso: AVISO_LOCAL, lugarId: 'loc-1' });
    expect(findActiveCityNoticeByCityId).toHaveBeenCalledTimes(1);
    expect(findActiveCityNoticeByCityId).toHaveBeenCalledWith('loc-1');
  });

  test('sem aviso na localidade, cai para o do municipio', async () => {
    findActiveCityNoticeByCityId.mockImplementation(async (id) => (id === 'loc-1' ? null : AVISO_MUNICIPAL));

    const escolha = await selecionarAvisoDoContato({ id: 'ct-1', cityId: 'city-1', localityId: 'loc-1' });

    expect(escolha).toEqual({ aviso: AVISO_MUNICIPAL, lugarId: 'city-1' });
    expect(findActiveCityNoticeByCityId).toHaveBeenCalledWith('loc-1');
    expect(findActiveCityNoticeByCityId).toHaveBeenCalledWith('city-1');
  });

  test('aviso local desligado conta como ausente e permite o municipal', async () => {
    // findActiveCityNoticeByCityId ja filtra enabled = true: um aviso local
    // desligado simplesmente nao volta, e o fallback acontece.
    findActiveCityNoticeByCityId.mockImplementation(async (id) => (id === 'loc-1' ? null : AVISO_MUNICIPAL));

    const escolha = await selecionarAvisoDoContato({ id: 'ct-1', cityId: 'city-1', localityId: 'loc-1' });

    expect(escolha.aviso).toEqual(AVISO_MUNICIPAL);
  });

  test('sem cidade e sem localidade nao ha o que escolher', async () => {
    const escolha = await selecionarAvisoDoContato({ id: 'ct-1', cityId: null, localityId: null });

    expect(escolha).toBeNull();
    expect(findActiveCityNoticeByCityId).not.toHaveBeenCalled();
  });

  test('contato ausente nao quebra', async () => {
    expect(await selecionarAvisoDoContato(null)).toBeNull();
  });
});

describe('enviarAvisoDeCidadeSePreciso — hierarquia', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recordNoticeDelivery.mockResolvedValue(true);
  });

  test('envia o aviso da localidade quando ela tem um', async () => {
    findActiveCityNoticeByCityId.mockImplementation(async (id) => (id === 'loc-1' ? AVISO_LOCAL : AVISO_MUNICIPAL));

    const enviado = await enviarAvisoDeCidadeSePreciso({
      contact: { id: 'ct-1', cityId: 'city-1', localityId: 'loc-1' },
      conversationId: 'conv-1',
      channelId: 'ch-1',
    });

    expect(recordNoticeDelivery).toHaveBeenCalledWith('notice-loc', 'ct-1');
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1', channelId: 'ch-1', content: 'Falha no povoado',
    });
    expect(enviado).toEqual(AVISO_LOCAL);
  });

  test('NUNCA manda os dois no mesmo atendimento', async () => {
    findActiveCityNoticeByCityId.mockImplementation(async (id) => (id === 'loc-1' ? AVISO_LOCAL : AVISO_MUNICIPAL));

    await enviarAvisoDeCidadeSePreciso({
      contact: { id: 'ct-1', cityId: 'city-1', localityId: 'loc-1' },
      conversationId: 'conv-1',
      channelId: 'ch-1',
    });

    expect(enqueueOutboundMessage).toHaveBeenCalledTimes(1);
  });

  // Esta e a regra que o desenho exige em letras maiusculas: a prioridade vem
  // ANTES da conferencia de entrega. Se a ordem se invertesse, o cliente que ja
  // recebeu o aviso do povoado receberia o do municipio como "alternativa".
  test('aviso local ja entregue nao provoca envio do municipal', async () => {
    findActiveCityNoticeByCityId.mockImplementation(async (id) => (id === 'loc-1' ? AVISO_LOCAL : AVISO_MUNICIPAL));
    recordNoticeDelivery.mockResolvedValue(false);

    const enviado = await enviarAvisoDeCidadeSePreciso({
      contact: { id: 'ct-1', cityId: 'city-1', localityId: 'loc-1' },
      conversationId: 'conv-1',
      channelId: 'ch-1',
    });

    expect(enviado).toBeNull();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    expect(recordNoticeDelivery).toHaveBeenCalledTimes(1);
    expect(recordNoticeDelivery).toHaveBeenCalledWith('notice-loc', 'ct-1');
    // O municipio nem chegou a ser consultado: a escolha ja tinha sido feita.
    expect(findActiveCityNoticeByCityId).not.toHaveBeenCalledWith('city-1');
  });

  test('o controle de repeticao continua valendo para o municipal', async () => {
    findActiveCityNoticeByCityId.mockResolvedValue(AVISO_MUNICIPAL);
    recordNoticeDelivery.mockResolvedValue(false);

    const enviado = await enviarAvisoDeCidadeSePreciso({
      contact: { id: 'ct-1', cityId: 'city-1', localityId: null },
      conversationId: 'conv-1',
      channelId: 'ch-1',
    });

    expect(enviado).toBeNull();
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });
});
