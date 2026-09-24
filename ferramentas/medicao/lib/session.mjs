// Prepara uma pagina: emulacao, sessao semeada, relogio fixo, marcos de tempo,
// e a interceptacao CDP que responde TODA a API e derruba o socket.io.
import { MockApi } from './mock-api.mjs';
import { AGORA_FIXO, EU_ATENDENTE, EU_ADMIN } from './fixtures.mjs';
import { MARCOS } from './ganchos.mjs';

export const API_ORIGIN = 'http://localhost:3000';

// Perfis de rede. Bytes/s explicitos para nao haver ambiguidade de unidade.
export const REDES = {
  // Mesmos numeros do throttling "devtools" do Lighthouse (mobileSlow4G, antigo
  // "Fast 3G"): 562,5 ms, 1474,56 kbit/s (x1024) = 188743,68 B/s, 675 kbit/s = 86400 B/s.
  fast3g: { nome: 'Fast 3G', latency: 562.5, downloadThroughput: 188743.68, uploadThroughput: 86400 },
  // Preset "Slow 3G" do DevTools: 2000 ms, 400 kbit/s = 50000 B/s nos dois sentidos.
  slow3g: { nome: 'Slow 3G', latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 },
};

// Marcos gravados por MutationObserver (performance.now(), relativo ao
// timeOrigin). Definidos em lib/ganchos.mjs.
export { MARCOS };

function scriptDeSemente({ origin, perfil }) {
  const agente = perfil === 'admin' ? EU_ADMIN : perfil === 'atendente' ? EU_ATENDENTE : null;
  const cfg = {
    origin,
    agora: AGORA_FIXO,
    token: agente ? 'jwt.simulado.' + perfil : null,
    agente: agente ? JSON.stringify(agente) : null,
    marcos: MARCOS,
  };
  return `(() => {
  const CFG = ${JSON.stringify(cfg)};
  if (location.origin !== CFG.origin) return;
  // Relogio fixo: Date anda a partir de ${new Date(AGORA_FIXO).toISOString()}.
  const REAL = Date;
  const OFFSET = CFG.agora - REAL.now();
  function FakeDate(...a) {
    if (!new.target) return new REAL(REAL.now() + OFFSET).toString();
    return a.length === 0 ? new REAL(REAL.now() + OFFSET) : new REAL(...a);
  }
  FakeDate.prototype = REAL.prototype;
  FakeDate.now = () => REAL.now() + OFFSET;
  FakeDate.parse = REAL.parse;
  FakeDate.UTC = REAL.UTC;
  window.Date = FakeDate;
  try {
    if (CFG.token) {
      localStorage.setItem('dw_token', CFG.token);
      localStorage.setItem('dw_agent', CFG.agente);
    } else {
      localStorage.removeItem('dw_token');
      localStorage.removeItem('dw_agent');
    }
  } catch (e) {}
  try { performance.setResourceTimingBufferSize(2000); } catch (e) {}
  const marcos = (window.__marcos = {});
  const checar = () => {
    const t = performance.now();
    for (const k in CFG.marcos) {
      if (k in marcos) continue;
      const m = CFG.marcos[k];
      const ok = m.texto
        ? [...document.querySelectorAll(m.sel)].some((e) => e.textContent.includes(m.texto))
        : document.querySelector(m.sel);
      if (ok) marcos[k] = t;
    }
  };
  new MutationObserver(checar).observe(document, { childList: true, subtree: true });
})();`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function prepararPagina(page, opts) {
  const {
    origin,
    perfil = 'atendente', // 'atendente' | 'admin' | null (sem sessao)
    width = 1366,
    height = 768,
    cacheDisabled = false,
    rede = null, // um item de REDES
    cpu = 1,
    segurar = [], // [{ padrao: RegExp, ms }]
    latenciaApi = null, // { rttMs, bytesPorSeg } simula a rede na API forjada
  } = opts;

  const api = new MockApi({ perfil: perfil || 'atendente', pageOrigin: origin });
  const log = []; // tudo que passou pela interceptacao
  const t0 = Date.now();
  const estado = { api, log, t0, naoAtendidos: [], externos: [], socket: 0, segurados: [] };

  if (origin.startsWith('https:')) {
    // Certificado autoassinado do servidor local HTTP/2 (gerado em lib/cert.mjs).
    await page.send('Security.enable');
    await page.send('Security.setIgnoreCertificateErrors', { ignore: true });
  }
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable', { maxTotalBufferSize: 50_000_000, maxResourceBufferSize: 10_000_000 });
  await page.send('Performance.enable', { timeDomain: 'timeTicks' });
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Sao_Paulo' });
  await page.send('Emulation.setLocaleOverride', { locale: 'pt-BR' }).catch(() => {});
  await page.send('Network.setCacheDisabled', { cacheDisabled });
  if (rede) {
    await page.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: rede.latency,
      downloadThroughput: rede.downloadThroughput,
      uploadThroughput: rede.uploadThroughput,
    });
  }
  if (cpu > 1) await page.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  // Rede de seguranca para WebSocket (a Fetch nao intercepta ws://).
  await page.send('Network.setBlockedURLs', { urls: ['ws://*', 'wss://*'] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: scriptDeSemente({ origin, perfil }) });

  page.on('Fetch.requestPaused', async (ev) => {
    const { requestId, request, resourceType } = ev;
    const url = request.url;
    const wallIni = Date.now();
    const quando = wallIni - t0;
    try {
      if (url.startsWith(origin + '/') || url === origin) {
        const regra = segurar.find((s) => s.padrao.test(url));
        if (regra) {
          estado.segurados.push({ url, ms: regra.ms, em: quando });
          await sleep(regra.ms);
        }
        await page.send('Fetch.continueRequest', { requestId });
        return;
      }
      if (url.startsWith(API_ORIGIN + '/socket.io')) {
        estado.socket++;
        log.push({ t: quando, wallIni, tipo: 'socket', method: request.method, url });
        if (opts.socketEmulado) {
          // SUPLEMENTAR: so na medicao do estado "nao lida" (ver lib/socket-emulado.mjs).
          await opts.socketEmulado.tratar(page, requestId, request);
          return;
        }
        // Falha de TRANSPORTE (servidor fora do ar), nunca recusa do servidor.
        await page.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' });
        return;
      }
      if (url.startsWith(API_ORIGIN + '/')) {
        let r = api.handle({ method: request.method, url, headers: request.headers });
        const atendido = Boolean(r);
        if (!r) {
          r = api.json(404, { error: 'Not found (simulado)' }, request.headers.Origin || origin);
          estado.naoAtendidos.push({ method: request.method, url });
        }
        const u = new URL(url);
        const entrada = {
          t: quando,
          wallIni,
          tipo: request.method === 'OPTIONS' ? 'preflight' : 'api',
          method: request.method,
          url,
          path: u.pathname,
          query: u.search,
          status: r.status,
          bytes: r.body.length,
          atendido,
          resourceType,
        };
        log.push(entrada);
        if (latenciaApi) {
          const espera = latenciaApi.rttMs + (request.method === 'OPTIONS' ? 0 : (r.body.length / latenciaApi.bytesPorSeg) * 1000);
          await sleep(espera);
        }
        await page.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: r.status,
          responseHeaders: r.headers,
          body: r.body.toString('base64'),
        });
        entrada.wallFim = Date.now();
        return;
      }
      estado.externos.push({ url, method: request.method });
      log.push({ t: quando, tipo: 'externo-bloqueado', method: request.method, url });
      await page.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    } catch (err) {
      // A aba pode ter navegado/fechado no meio; nao derruba a medicao.
      log.push({ t: quando, tipo: 'erro-interceptacao', url, erro: String(err.message || err) });
    }
  });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });

  // Registro de rede (tempos e bytes) por CDP.
  const reqs = new Map();
  page.on('Network.requestWillBeSent', (p) => {
    const r = reqs.get(p.requestId) || {};
    reqs.set(p.requestId, {
      ...r,
      requestId: p.requestId,
      url: p.request.url,
      method: p.request.method,
      type: p.type,
      initiator: p.initiator,
      ts: p.timestamp,
      wall: p.wallTime,
      redirect: Boolean(p.redirectResponse),
    });
  });
  page.on('Network.responseReceived', (p) => {
    const r = reqs.get(p.requestId);
    if (!r) return;
    r.status = p.response.status;
    r.mime = p.response.mimeType;
    r.encoding = (p.response.headers && (p.response.headers['Content-Encoding'] || p.response.headers['content-encoding'])) || null;
    r.fromCache = p.response.fromDiskCache || p.response.fromPrefetchCache || false;
    r.protocol = p.response.protocol || null;
    r.respTs = p.timestamp;
    r.timing = p.response.timing || null;
  });
  page.on('Network.loadingFinished', (p) => {
    const r = reqs.get(p.requestId);
    if (!r) return;
    r.endTs = p.timestamp;
    r.encodedDataLength = p.encodedDataLength;
  });
  page.on('Network.loadingFailed', (p) => {
    const r = reqs.get(p.requestId);
    if (!r) return;
    r.endTs = p.timestamp;
    r.failed = p.errorText;
    r.blocked = p.blockedReason || null;
  });
  estado.reqs = reqs;
  return estado;
}

export async function navegar(page, url, { esperarLoad = true, timeoutMs = 60000 } = {}) {
  const load = esperarLoad ? page.waitFor('Page.loadEventFired', () => true, timeoutMs) : null;
  const r = await page.send('Page.navigate', { url });
  if (r.errorText) throw new Error('navegacao falhou: ' + r.errorText);
  if (load) await load;
  return r;
}

export { sleep };
