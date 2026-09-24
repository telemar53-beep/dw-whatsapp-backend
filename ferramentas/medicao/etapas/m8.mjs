// M8 — requisicoes repetidas. Roteiro: carregar "/", abrir A, abrir B, abrir A de
// novo, fechar e reabrir o painel do SGP de A, trocar de aba Espera/Atendimento.
// Cache do navegador LIGADO (uso normal), perfil novo (primeira visita).
import path from 'node:path';
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';

const CONV_A = G.CONVERSAS.A.nome;
const CONV_B = G.CONVERSAS.B.nome;

function padrao(path_) {
  if (/^\/api\/conversations\/[^/]+\/messages$/.test(path_)) return 'GET /conversations/:id/messages';
  if (/^\/api\/conversations\/[^/]+\/ai-suggestion$/.test(path_)) return 'GET /conversations/:id/ai-suggestion';
  if (path_ === '/api/sgp/clientes') return 'GET /sgp/clientes?cpf= (SGP)';
  if (path_ === '/api/agents') return 'GET /agents';
  if (path_ === '/api/public/company') return 'GET /public/company';
  if (path_ === '/api/conversations/queue') return 'GET /conversations/queue';
  if (path_ === '/api/conversations/mine') return 'GET /conversations/mine';
  if (path_ === '/api/auth/media-token') return 'POST /auth/media-token';
  if (path_ === '/api/quick-replies') return 'GET /quick-replies';
  if (/^\/api\/contacts\/[^/]+\/avatar$/.test(path_)) return 'GET /contacts/:id/avatar (img)';
  if (/^\/api\/agents\/[^/]+\/avatar$/.test(path_)) return 'GET /agents/:id/avatar (img)';
  if (/^\/api\/media\/[^/]+$/.test(path_)) return 'GET /media/:id (img)';
  return path_;
}

const srv = await H.subirServidores();
const ctx = await H.abrirSessao({ nome: 'm8', servidor: srv.h2, perfil: 'atendente', cacheDisabled: false });
const etapas = [];
let etapaAtual = null;
function etapa(nome) {
  etapaAtual = { nome, inicioLog: ctx.est.log.length };
  etapas.push(etapaAtual);
}
try {
  const { page } = ctx;
  etapa('1. carregar /');
  await H.navegar(page, ctx.origin + G.ROTAS.atendimento);
  await H.esperarLista(page);
  await H.esperarEstavel(page, 1500);

  etapa('2. abrir conversa A');
  await H.abrirConversa(page, G.CONVERSAS.A);
  await page.waitForExpr(H.exprSgpCarregado, { timeoutMs: 20000 });
  await H.esperarEstavel(page, 1000);

  etapa('3. abrir conversa B (aba Espera)');
  await H.clicar(page, H.elAba(G.NOMES.abas.espera));
  await H.sleep(300);
  await H.abrirConversa(page, G.CONVERSAS.B);
  await H.esperarEstavel(page, 1000);

  etapa('4. abrir conversa A de novo');
  await H.clicar(page, H.elAba(G.NOMES.abas.andamento));
  await H.sleep(300);
  await H.abrirConversa(page, G.CONVERSAS.A);
  await page.waitForExpr(H.exprSgpCarregado, { timeoutMs: 20000 });
  await H.esperarEstavel(page, 1000);

  etapa('5. fechar e reabrir o painel do SGP (conversa A)');
  await H.clicar(page, H.elBotao(G.NOMES.fecharSgp));
  await H.sleep(500);
  await H.clicar(page, H.elBotao(G.NOMES.consultarSgp));
  await page.waitForExpr(H.exprSgpCarregado, { timeoutMs: 20000 });
  await H.esperarEstavel(page, 1000);

  etapa('6. trocar de aba Espera/Atendimento (2x)');
  for (const aba of [G.NOMES.abas.espera, G.NOMES.abas.andamento, G.NOMES.abas.espera, G.NOMES.abas.andamento]) {
    await H.clicar(page, H.elAba(aba));
    await H.sleep(600);
  }
  await H.sleep(1000);
} finally {
  var log = ctx.est.log.slice();
  var naoAtendidos = ctx.est.naoAtendidos;
  var ids = await ctx.page.eval('0').catch(() => null);
  await ctx.close();
  await srv.close();
}

// Qual conversa e A/B nos pedidos de mensagens.
import { MockApi } from '../lib/mock-api.mjs';
const mock = new MockApi({ perfil: 'atendente', pageOrigin: 'x' });
const idA = mock.minhas.find((c) => c.contactDisplayName.startsWith(CONV_A)).id;
const idB = mock.fila.find((c) => (c.contactDisplayName || '').startsWith(CONV_B)).id;
const rotulo = (e) => {
  let p = padrao(e.path || '');
  if (p.includes('/messages') || p.includes('ai-suggestion')) p += e.path.includes(idA) ? ' [A]' : e.path.includes(idB) ? ' [B]' : ' [outra]';
  return p;
};

for (let i = 0; i < etapas.length; i++) etapas[i].fimLog = i + 1 < etapas.length ? etapas[i + 1].inicioLog : log.length;
const tabela = new Map();
for (const [i, et] of etapas.entries()) {
  for (const e of log.slice(et.inicioLog, et.fimLog)) {
    let chave;
    if (e.tipo === 'socket') chave = 'socket.io (polling; falha de transporte)';
    else if (e.tipo === 'api' || e.tipo === 'preflight') chave = rotulo(e);
    else continue;
    if (!tabela.has(chave)) tabela.set(chave, { padrao: chave, requisicoes: 0, preflights: 0, porEtapa: {} });
    const t = tabela.get(chave);
    const col = e.tipo === 'preflight' ? 'preflights' : 'requisicoes';
    t[col]++;
    t.porEtapa[et.nome] = t.porEtapa[et.nome] || { requisicoes: 0, preflights: 0 };
    t.porEtapa[et.nome][col]++;
  }
}
const linhas = [...tabela.values()].sort((a, b) => b.requisicoes + b.preflights - (a.requisicoes + a.preflights));
const totais = {
  requisicoesApi: log.filter((e) => e.tipo === 'api').length,
  preflights: log.filter((e) => e.tipo === 'preflight').length,
  socketIo: log.filter((e) => e.tipo === 'socket').length,
  porEtapa: etapas.map((et) => {
    const fatia = log.slice(et.inicioLog, et.fimLog);
    return { etapa: et.nome, api: fatia.filter((e) => e.tipo === 'api').length, preflights: fatia.filter((e) => e.tipo === 'preflight').length };
  }),
};
// URLs de API repetidas (mesma URL exata pedida mais de uma vez).
const porUrl = new Map();
for (const e of log.filter((x) => x.tipo === 'api')) porUrl.set(`${e.method} ${e.path}${e.query}`, (porUrl.get(`${e.method} ${e.path}${e.query}`) || 0) + 1);
const repetidas = [...porUrl.entries()].filter(([, n]) => n > 1).map(([u, n]) => ({ url: u.replace(/mediaToken=[^&]+/, 'mediaToken=…'), vezes: n }));
// Preflight repetido para a mesma URL (o cache de preflight de 7200 s deveria evitar).
const pfUrl = new Map();
for (const e of log.filter((x) => x.tipo === 'preflight')) pfUrl.set(e.url, (pfUrl.get(e.url) || 0) + 1);
const preflightsRepetidos = [...pfUrl.entries()].filter(([, n]) => n > 1).map(([u, n]) => ({ url: u, vezes: n }));

const saida = {
  data: new Date().toISOString(),
  cacheDoNavegador: 'ligado (perfil novo)',
  conversaA: { id: idA, nome: CONV_A, observacao: 'contato com CPF: o painel do SGP abre sozinho e consulta ao abrir a conversa' },
  conversaB: { id: idB, nome: CONV_B, observacao: 'na fila (Espera), sem CPF, não é minha: sem sugestão de IA e sem compositor' },
  totais,
  tabela: linhas,
  urlsRepetidas: repetidas,
  preflightsRepetidosMesmaUrl: preflightsRepetidos,
  naoAtendidos,
  logCompleto: log.map((e) => ({ t: e.t, tipo: e.tipo, method: e.method, url: (e.url || '').replace(/mediaToken=[^&]+/, 'mediaToken=…'), status: e.status })),
};
H.salvarJson('M8.json', saida);
console.log('TOTAIS', JSON.stringify(totais, null, 1));
console.log('\nPADRAO | requisicoes | preflights');
for (const l of linhas) console.log(`${l.padrao} | ${l.requisicoes} | ${l.preflights} | ${JSON.stringify(l.porEtapa)}`);
console.log('\nURLs repetidas', JSON.stringify(repetidas, null, 1));
console.log('preflights repetidos', JSON.stringify(preflightsRepetidos, null, 1));
console.log('naoAtendidos', naoAtendidos);
