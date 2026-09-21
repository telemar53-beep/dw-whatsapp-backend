import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchChannelQrImage } from './api';

// O endpoint devolve um documento HTML. Este arquivo trava o contrato da
// leitura: o que a tela aceita, o que ela recusa, e como ela recusa.
const HTML_REAL = `<!DOCTYPE html>
<html>
<head>
<title>QR - Berg</title>
<style>
  html, body { margin: 0; height: 100%; }
  body { display: flex; align-items: center; justify-content: center; }
  img { max-width: 100%; max-height: 100%; }
</style>
</head>
<body>
<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" alt="QR code - Berg" />
</body>
</html>`;

function responde({ status = 200, corpo = '' } = {}) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(corpo) });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchChannelQrImage', () => {
  test('extrai a imagem do HTML que o endpoint devolve hoje', async () => {
    global.fetch.mockReturnValue(responde({ corpo: HTML_REAL }));
    const src = await fetchChannelQrImage('ch1', 'tok');
    expect(src.startsWith('data:image/png;base64,')).toBe(true);
  });

  // O token vai no header. A URL não pode carregar credencial nenhuma.
  test('autentica pelo header e não põe token na URL', async () => {
    global.fetch.mockReturnValue(responde({ corpo: HTML_REAL }));
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

  // Se o backend mudar o template, a leitura precisa falhar ALTO — é essa
  // falha que impede a tela de voltar ao iframe com token na URL.
  test('HTML sem imagem vira motivo "formatoInesperado"', async () => {
    global.fetch.mockReturnValue(responde({ corpo: '<html><body><p>sem imagem</p></body></html>' }));
    await expect(fetchChannelQrImage('ch1', 'tok')).rejects.toMatchObject({ motivo: 'formatoInesperado' });
  });

  test('src que não é data:image é recusado', async () => {
    for (const src of ['https://exemplo.com/qr.png', 'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=']) {
      global.fetch.mockReturnValue(responde({ corpo: `<html><body><img src="${src}" /></body></html>` }));
      await expect(fetchChannelQrImage('ch1', 'tok')).rejects.toMatchObject({ motivo: 'formatoInesperado' });
    }
  });

  // O HTML é lido com DOMParser, que não executa script nem carrega recurso.
  test('script no HTML não é executado ao ler a resposta', async () => {
    const espiao = vi.fn();
    vi.stubGlobal('__qrEspiao', espiao);
    global.fetch.mockReturnValue(responde({
      corpo: '<html><body><script>window.__qrEspiao && window.__qrEspiao()</script><img src="data:image/png;base64,iVBORw0KGgo=" /></body></html>',
    }));

    await fetchChannelQrImage('ch1', 'tok');
    expect(espiao).not.toHaveBeenCalled();
  });
});
