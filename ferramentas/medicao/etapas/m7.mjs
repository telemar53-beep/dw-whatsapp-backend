// M7 — cascata de carregamento com cache desligado e rede estrangulada.
// Perfis Fast 3G e Slow 3G; tela de Atendimento (com sessao) x Login (sem sessao);
// servidor HTTP/2+TLS (principal) e HTTP/1.1 (comparacao).
//
// A emulacao de rede do Chrome NAO atrasa respostas forjadas por
// Fetch.fulfillRequest (medido em diagnostico/throttle-fulfill.mjs), entao a latencia da
// API e simulada no interceptador: preflight = 1 RTT; resposta = 1 RTT + bytes/banda.
//
// REGRA DO PACOTE: cada cenario roda MEDICAO_RODADAS vezes (minimo 3) e o que
// vai para o resumo e a MEDIANA do tempo; os detalhes (camadas, cadeia) vem da
// rodada mediana. Uma rodada so ja deu numeros que nao se repetiam.
import fs from 'node:fs';
import path from 'node:path';
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';
import { REDES } from '../lib/session.mjs';
import { RODADAS as REPETICOES } from '../lib/config.mjs';
import { mediana } from '../lib/analise.mjs';

const PASTA = H.garantirPasta(path.join(H.RES, 'm7'));
const arg = process.argv.slice(2);

const RODADAS = [];
for (const rede of ['fast3g', 'slow3g'])
  for (const pagina of ['atendimento', 'login'])
    for (const proto of ['h2', 'h1']) RODADAS.push({ rede, pagina, proto, id: `${rede}-${pagina}-${proto}` });
const escolhidas = arg.length ? RODADAS.filter((r) => arg.some((a) => r.id.includes(a))) : RODADAS;

// Roda o cenario REPETICOES vezes; devolve a rodada mediana, com o tempo mediano
// e a lista de tempos de todas as rodadas.
async function rodarComMediana(r, srv) {
  const execucoes = [];
  for (let i = 0; i < REPETICOES; i++) {
    const res = await rodar(r, srv);
    console.log(`   ${r.id} rodada ${i + 1}/${REPETICOES}: ${res.tempoAteAlvoMs} ms`);
    execucoes.push(res);
  }
  const ordenadas = [...execucoes].sort((x, y) => x.tempoAteAlvoMs - y.tempoAteAlvoMs);
  const meio = ordenadas[Math.floor((ordenadas.length - 1) / 2)];
  return { ...meio, tempoAteAlvoMs: mediana(execucoes.map((e) => e.tempoAteAlvoMs)), tempoRodadasMs: execucoes.map((e) => e.tempoAteAlvoMs) };
}

const curto = (u, origin) => u.replace(origin, '').replace('http://localhost:3000', 'API').replace(/\?mediaToken=[^&]+/, '?mediaToken=…').slice(0, 90);

function analisar({ reqs, log, timeOrigin, origin, marcos, alvo }) {
  const lista = [...reqs.values()];
  const doc = lista.find((r) => r.type === 'Document' && r.url.startsWith(origin));
  const toPage = (ts) => (ts - doc.ts) * 1000 + (doc.wall * 1000 - timeOrigin);
  const estaticos = lista
    .filter((r) => r.url.startsWith(origin) && r.ts !== undefined)
    .map((r) => ({
      tipo: r.type,
      recurso: curto(r.url, origin),
      ini: +toPage(r.ts).toFixed(1),
      fim: r.endTs !== undefined ? +toPage(r.endTs).toFixed(1) : null,
      bytes: r.encodedDataLength ?? null,
      gzip: r.encoding === 'gzip',
      protocolo: r.protocol,
      iniciador: r.initiator ? r.initiator.type + (r.initiator.url ? ' ' + curto(r.initiator.url, origin) : r.initiator.stack && r.initiator.stack.callFrames[0] ? ' ' + curto(r.initiator.stack.callFrames[0].url, origin) : '') : null,
    }));
  const api = log
    .filter((e) => (e.tipo === 'api' || e.tipo === 'preflight') && e.wallFim)
    .map((e) => ({
      tipo: e.tipo === 'preflight' ? 'Preflight' : 'API',
      recurso: `${e.method} ${curto(e.url, origin)}`,
      chave: e.method === 'OPTIONS' ? null : `${e.url}`,
      url: e.url,
      ini: +(e.wallIni - timeOrigin).toFixed(1),
      fim: +(e.wallFim - timeOrigin).toFixed(1),
      bytes: e.bytes,
      imagem: /\/avatar|\/api\/media\//.test(e.url),
    }));
  const socket = log.filter((e) => e.tipo === 'socket').map((e) => ({ tipo: 'socket.io (falha de transporte)', ini: +(e.wallIni - timeOrigin).toFixed(1) }));

  // Profundidade serial (causal):
  //  - documento = 0;
  //  - JS/CSS: 1 + a maior camada entre os JS/CSS/documento que JA TINHAM TERMINADO quando ele comecou;
  //  - preflight / API sem preflight: 1 + a maior camada entre JS ja terminados (o codigo que a disparou);
  //  - API com preflight: 1 + camada do seu preflight.
  const cadeiaEst = estaticos.filter((r) => r.tipo === 'Document' || r.tipo === 'Script' || r.tipo === 'Stylesheet').sort((a, b) => a.ini - b.ini);
  for (const r of cadeiaEst) {
    if (r.tipo === 'Document') {
      r.camada = 0;
      continue;
    }
    const antes = cadeiaEst.filter((q) => q !== r && q.camada !== undefined && q.fim !== null && q.fim <= r.ini);
    r.camada = 1 + Math.max(0, ...antes.map((q) => q.camada));
  }
  const jsFeitos = cadeiaEst.filter((q) => q.tipo === 'Script' || q.tipo === 'Document');
  const apiOrd = api.filter((a) => !a.imagem).sort((a, b) => a.ini - b.ini);
  for (const a of apiOrd) {
    if (a.tipo === 'API') {
      const pf = apiOrd.filter((p) => p.tipo === 'Preflight' && p.url === a.url && p.fim <= a.ini + 1 && p.camada !== undefined).pop();
      if (pf) {
        a.camada = pf.camada + 1;
        a.preflight = true;
        continue;
      }
    }
    const antes = jsFeitos.filter((q) => q.fim !== null && q.fim <= a.ini);
    a.camada = 1 + Math.max(0, ...antes.map((q) => q.camada));
  }
  const camadas = {};
  for (const r of [...cadeiaEst, ...apiOrd]) {
    const c = (camadas[r.camada] = camadas[r.camada] || { camada: r.camada, requisicoes: 0, bytes: 0, ini: Infinity, fim: -Infinity, itens: [] });
    c.requisicoes++;
    c.bytes += r.bytes || 0;
    c.ini = Math.min(c.ini, r.ini);
    c.fim = Math.max(c.fim, r.fim ?? r.ini);
    c.itens.push(`${r.tipo} ${r.recurso}`);
  }
  for (const c of Object.values(camadas)) {
    c.ini = +c.ini.toFixed(0);
    c.fim = +c.fim.toFixed(0);
  }

  // Cadeia critica ate o alvo: de tras para a frente, sempre o recurso que
  // terminou por ultimo antes de o seguinte comecar.
  const universo = [...cadeiaEst, ...apiOrd].filter((r) => r.fim !== null);
  let alvoReq = null;
  if (alvo === 'primeiroItem') alvoReq = apiOrd.filter((a) => a.tipo === 'API' && a.recurso.includes('/api/conversations/mine')).pop();
  const cadeia = [];
  // Sem API como alvo (login): o JS/CSS que terminou por ultimo antes do marco.
  const alvoMsCadeia = marcos[alvo];
  const ultimoEstatico = cadeiaEst.filter((q) => q.fim !== null && q.fim <= alvoMsCadeia).sort((a, b) => b.fim - a.fim)[0];
  let atual = alvoReq || ultimoEstatico;
  const vistos = new Set();
  while (atual && !vistos.has(atual)) {
    vistos.add(atual);
    cadeia.unshift({ tipo: atual.tipo, recurso: atual.recurso, camada: atual.camada, ini: Math.round(atual.ini), fim: Math.round(atual.fim), dur: Math.round(atual.fim - atual.ini), bytes: atual.bytes });
    if (atual.tipo === 'Document') break;
    const ini = atual.ini;
    const cand = universo.filter((q) => q !== atual && q.fim <= ini + 1 && (atual.tipo === 'API' && atual.preflight ? q.tipo === 'Preflight' && q.url === atual.url : q.tipo !== 'Preflight' && q.tipo !== 'API'));
    atual = cand.sort((a, b) => b.fim - a.fim)[0];
  }

  const cv = estaticos.find((r) => /ConversationView-.*\.js/.test(r.recurso));
  const alvoMs = marcos[alvo];
  const bytesAteAlvo = (filtro) => estaticos.filter((r) => filtro(r) && r.fim !== null && r.fim <= alvoMs).reduce((s, r) => s + (r.bytes || 0), 0);
  return {
    marcos: Object.fromEntries(Object.entries(marcos).map(([k, v]) => [k, Math.round(v)])),
    alvo,
    tempoAteAlvoMs: alvoMs !== undefined ? Math.round(alvoMs) : null,
    bytesAteAlvo: { js: bytesAteAlvo((r) => r.tipo === 'Script'), css: bytesAteAlvo((r) => r.tipo === 'Stylesheet') },
    profundidadeSerialAteAlvo: cadeia.length ? Math.max(...cadeia.map((c) => c.camada)) : null,
    cadeiaCritica: cadeia,
    camadas: Object.values(camadas).sort((a, b) => a.camada - b.camada),
    conversationView: cv
      ? {
          ...cv,
          duracaoMs: cv.fim !== null ? Math.round(cv.fim - cv.ini) : null,
          camada: (cadeiaEst.find((r) => r.recurso === cv.recurso) || {}).camada,
          naCadeiaCritica: cadeia.some((c) => c.recurso === cv.recurso),
          terminouAntesDoAlvo: cv.fim !== null && alvoMs !== undefined ? cv.fim <= alvoMs : null,
        }
      : 'não foi pedido',
    cascata: [...estaticos, ...api, ...socket].sort((a, b) => a.ini - b.ini),
  };
}

async function rodar(r, srv) {
  const rede = REDES[r.rede];
  const servidor = r.proto === 'h2' ? srv.h2 : srv.h1;
  const ctx = await H.abrirSessao({
    nome: 'm7-' + r.id,
    servidor,
    perfil: r.pagina === 'atendimento' ? 'atendente' : null,
    cacheDisabled: true,
    rede,
    latenciaApi: { rttMs: rede.latency, bytesPorSeg: rede.downloadThroughput },
  });
  try {
    const { page } = ctx;
    const alvo = r.pagina === 'atendimento' ? 'primeiroItem' : 'formLogin';
    await page.send('Page.navigate', { url: ctx.origin + (r.pagina === 'atendimento' ? G.ROTAS.atendimento : G.ROTAS.login) });
    await page.waitForExpr(`window.__marcos && window.__marcos.${alvo} !== undefined`, { timeoutMs: 180000, intervalMs: 100 });
    // Folga para o que vem depois do alvo (avatares, fontes, equipe) aparecer na cascata.
    await H.sleep(r.rede === 'slow3g' ? 9000 : 4000);
    const dados = await page.eval(`({ timeOrigin: performance.timeOrigin, marcos: window.__marcos,
      modulepreloadEmTempoDeExecucao: [...document.querySelectorAll('link[rel=modulepreload]')].map(l => l.getAttribute('href')),
      stylesheetsInjetadas: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href')) })`);
    const a = analisar({ reqs: ctx.est.reqs, log: ctx.est.log, timeOrigin: dados.timeOrigin, origin: ctx.origin, marcos: dados.marcos, alvo });
    return {
      id: r.id,
      rede: { ...rede },
      pagina: r.pagina,
      protocoloServidor: servidor.protocolo,
      gzip: servidor.gzip,
      cacheDesligado: true,
      latenciaApiSimulada: { rttMs: rede.latency, bytesPorSeg: rede.downloadThroughput },
      modulepreloadEmTempoDeExecucao: dados.modulepreloadEmTempoDeExecucao,
      stylesheetsInjetadas: dados.stylesheetsInjetadas,
      naoAtendidos: ctx.est.naoAtendidos,
      ...a,
    };
  } finally {
    await ctx.close();
  }
}

const DIST = H.dist();
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const htmlCheck = {
  arquivo: path.join(DIST, 'index.html'),
  linkModulepreloadNoHtml: (html.match(/<link[^>]+rel=["']?modulepreload/gi) || []).length,
  scriptsModulo: (html.match(/<script[^>]+type=["']module["'][^>]*>/gi) || []).map((s) => s.match(/src=["']([^"']+)/)[1]),
  stylesheets: (html.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || []).map((s) => s.match(/href=["']([^"']+)/)[1]),
};
console.log('HTML:', JSON.stringify(htmlCheck));

const srv = await H.subirServidores();
const saida = { data: new Date().toISOString(), html: htmlCheck, rodadas: {} };
try {
  for (const r of escolhidas) {
    const res = await rodarComMediana(r, srv);
    H.salvarJson(`m7/${r.id}.json`, res);
    saida.rodadas[r.id] = {
      tempoAteAlvoMs: res.tempoAteAlvoMs,
      tempoRodadasMs: res.tempoRodadasMs,
      alvo: res.alvo,
      bytesAteAlvo: res.bytesAteAlvo,
      profundidadeSerialAteAlvo: res.profundidadeSerialAteAlvo,
      camadas: res.camadas.map((c) => ({ camada: c.camada, requisicoes: c.requisicoes, bytes: c.bytes, ini: c.ini, fim: c.fim })),
      cadeiaCritica: res.cadeiaCritica.map((c) => `${c.camada}: ${c.tipo} ${c.recurso} [${c.ini}→${c.fim} ms, ${c.bytes ?? '-'} B]`),
      conversationView: typeof res.conversationView === 'object' ? { ini: Math.round(res.conversationView.ini), fim: Math.round(res.conversationView.fim), duracaoMs: res.conversationView.duracaoMs, bytes: res.conversationView.bytes, camada: res.conversationView.camada, naCadeiaCritica: res.conversationView.naCadeiaCritica, iniciador: res.conversationView.iniciador } : res.conversationView,
      modulepreloadEmTempoDeExecucao: res.modulepreloadEmTempoDeExecucao.length,
    };
    console.log(`\n== ${r.id}: alvo ${res.alvo} em ${res.tempoAteAlvoMs} ms | JS ${res.bytesAteAlvo.js} B, CSS ${res.bytesAteAlvo.css} B | profundidade ${res.profundidadeSerialAteAlvo}`);
    for (const c of saida.rodadas[r.id].cadeiaCritica) console.log('   ', c);
    console.log('   ConversationView:', JSON.stringify(saida.rodadas[r.id].conversationView));
  }
} finally {
  await srv.close();
}
const anterior = fs.existsSync(path.join(H.RES, 'M7.json')) ? JSON.parse(fs.readFileSync(path.join(H.RES, 'M7.json'), 'utf8')) : null;
if (anterior && arg.length) saida.rodadas = { ...anterior.rodadas, ...saida.rodadas };
H.salvarJson('M7.json', saida);
