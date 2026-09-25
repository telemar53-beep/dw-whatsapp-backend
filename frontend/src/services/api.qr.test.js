import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchChannelQrImage } from './api';

// Desde 83a208a a tela pede JSON (Accept: application/json) e lê o campo
// `image`. Este arquivo trava o contrato da leitura: o que a tela aceita, o
// que ela recusa, e como ela recusa.
const RESPOSTA_REAL = JSON.stringify({
  image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  channelId: 'ch1',
  channelName: 'Berg',
});

function responde({ status = 200, corpo = '' } = {}) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(corpo),
    // Como o Response de verdade: corpo que não é JSON rejeita.
    json: () => Promise.resolve().then(() => JSON.parse(corpo)),
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchChannelQrImage', () => {
  test('extrai a imagem do campo image da resposta JSON', async () => {
    global.fetch.mockReturnValue(responde({ corpo: RESPOSTA_REAL }));
    const src = await fetchChannelQrImage('ch1', 'tok');
    expect(src.startsWith('data:image/png;base64,')).toBe(true);
  });

  // O token vai no header. A URL não pode carregar credencial nenhuma.
  test('autentica pelo header e não põe token na URL', async () => {
    global.fetch.mockReturnValue(responde({ corpo: RESPOSTA_REAL }));
    await fetchChannelQrImage('ch1', 'tok');

    const [url, opcoes] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/admin/channels/ch1/qr');
    expect(url).not.toContain('token=');
    expect(opcoes.headers.Authorization).toBe('Bearer tok');
  });

  test('404 vira motivo "indisponivel"', async () => {
    global.fetch.mockReturnValue(responde({ status: 404, corpo: '{"error":"No QR code available for this channel"}' }));
    await expect(fetchChannelQrImage('ch1', 'tok')).rejects.toMatchObject({ motivo: 'indisponivel' });
  });

  test('401 e 403 viram motivo "semPermissao"', async () => {
    global.fetch.mockReturnValue(responde({ status: 403, corpo: '{}' }));
    await expect(fetchChannelQrImage('ch1', 'tok')).rejects.toMatchObject({ motivo: 'semPermissao' });
    global.fetch.mockReturnValue(responde({ status: 401, corpo: '{}' }));
    await expect(fetchChannelQrImage('ch1', 'tok')).rejects.toMatchObject({ motivo: 'semPermissao' });
  });

  test('500 vira motivo "erro"', async () => {
    global.fetch.mockReturnValue(responde({ status: 500, corpo: 'boom' }));
    await expect(fetchChannelQrImage('ch1', 'tok')).rejects.toMatchObject({ motivo: 'erro' });
  });

  test('rede caída vira motivo "erro"', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchChannelQrImage('ch1', 'tok')).rejects.toMatchObject({ motivo: 'erro' });
  });

  // Se o backend mudar o formato, a leitura precisa falhar ALTO — é essa
  // falha que impede a tela de voltar ao iframe com token na URL.
  test('resposta sem o campo image vira motivo "formatoInesperado"', async () => {
    global.fetch.mockReturnValue(responde({ corpo: JSON.stringify({ channelId: 'ch1' }) }));
    await expect(fetchChannelQrImage('ch1', 'tok')).rejects.toMatchObject({ motivo: 'formatoInesperado' });
  });

  test('src que não é data:image é recusado', async () => {
    for (const src of ['https://exemplo.com/qr.png', 'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=']) {
      global.fetch.mockReturnValue(responde({ corpo: JSON.stringify({ image: src }) }));
      await expect(fetchChannelQrImage('ch1', 'tok')).rejects.toMatchObject({ motivo: 'formatoInesperado' });
    }
  });

  // A resposta é lida como JSON: um <script> dentro dela é só texto.
  test('script dentro da resposta não é executado ao ler a resposta', async () => {
    const espiao = vi.fn();
    vi.stubGlobal('__qrEspiao', espiao);
    global.fetch.mockReturnValue(responde({
      corpo: JSON.stringify({
        image: 'data:image/png;base64,iVBORw0KGgo=',
        channelName: '<script>window.__qrEspiao && window.__qrEspiao()</script>',
      }),
    }));

    await fetchChannelQrImage('ch1', 'tok');
    expect(espiao).not.toHaveBeenCalled();
  });
});
