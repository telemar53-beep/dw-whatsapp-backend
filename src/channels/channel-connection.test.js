jest.mock('../whatsapp-adapters/meta-cloud.adapter');
const { fetchNumberHealth } = require('../whatsapp-adapters/meta-cloud.adapter');
const { getChannelConnection, CONNECTION_TTL_MS } = require('./channel-connection');

// Cada teste usa um id de canal proprio: o cache vive no modulo e vazaria de um
// teste para o outro se todos usassem o mesmo.
function channel(id) {
  return { id, type: 'meta_cloud', config: { phoneNumberId: '530351070168344', accessToken: 'tok' } };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getChannelConnection', () => {
  test('reporta conectado com a qualidade quando a Meta diz que o numero esta de pe', async () => {
    fetchNumberHealth.mockResolvedValue({ ok: true, status: 'CONNECTED', qualityRating: 'GREEN' });

    expect(await getChannelConnection(channel('c-conectado'))).toEqual({ state: 'connected', quality: 'GREEN' });
  });

  test('reporta desconectado quando a Meta responde com outro status', async () => {
    fetchNumberHealth.mockResolvedValue({ ok: true, status: 'DISCONNECTED', qualityRating: 'UNKNOWN' });

    expect(await getChannelConnection(channel('c-desconectado'))).toEqual({ state: 'disconnected' });
  });

  test('reporta erro com o motivo da Meta quando o token caiu', async () => {
    fetchNumberHealth.mockResolvedValue({ ok: false, motivo: '(190) Session has expired' });

    expect(await getChannelConnection(channel('c-token'))).toEqual({
      state: 'error',
      motivo: '(190) Session has expired',
    });
  });

  test('fica em unknown quando a Meta nao respondeu, para a tela cair no selo antigo', async () => {
    fetchNumberHealth.mockResolvedValue({ ok: false, motivo: null });

    expect(await getChannelConnection(channel('c-sem-resposta'))).toEqual({ state: 'unknown' });
  });

  test('nao pergunta de novo para a Meta dentro da janela de cache', async () => {
    fetchNumberHealth.mockResolvedValue({ ok: true, status: 'CONNECTED', qualityRating: 'GREEN' });

    await getChannelConnection(channel('c-cache'));
    await getChannelConnection(channel('c-cache'));

    expect(fetchNumberHealth).toHaveBeenCalledTimes(1);
  });

  test('pergunta de novo depois que a janela de cache passa', async () => {
    jest.useFakeTimers();
    try {
      fetchNumberHealth.mockResolvedValue({ ok: true, status: 'CONNECTED', qualityRating: 'GREEN' });

      await getChannelConnection(channel('c-expira'));
      jest.advanceTimersByTime(CONNECTION_TTL_MS + 1);
      await getChannelConnection(channel('c-expira'));

      expect(fetchNumberHealth).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('guarda o cache por canal, nao um cache global unico', async () => {
    fetchNumberHealth
      .mockResolvedValueOnce({ ok: true, status: 'CONNECTED', qualityRating: 'GREEN' })
      .mockResolvedValueOnce({ ok: false, motivo: '(190) Session has expired' });

    const primeiro = await getChannelConnection(channel('c-um'));
    const segundo = await getChannelConnection(channel('c-dois'));

    expect(primeiro.state).toBe('connected');
    expect(segundo.state).toBe('error');
  });

  test('nao consulta a Meta para canal que nao e meta_cloud', async () => {
    const resultado = await getChannelConnection({ id: 'c-baileys', type: 'baileys', config: {} });

    expect(fetchNumberHealth).not.toHaveBeenCalled();
    expect(resultado).toBeNull();
  });
});
