// M9 — linha de base de desempenho para comparar no fim do redesenho.
//  a) document.querySelectorAll('*').length com a conversa A aberta (sem painel);
//  b) bytes de JS e CSS transferidos ate o primeiro item da lista (carga fria);
//  c) Performance.getMetrics (lista e conversa aberta);
//  d) tempo de boot ate a lista existir com CPU 4x (3 rodadas, mediana) e 1x de referencia.
import path from 'node:path';
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';
import { mediana } from '../lib/analise.mjs';
import { RODADAS as RODADAS_CFG } from '../lib/config.mjs';

const RODADAS = RODADAS_CFG;
const CAMPOS = ['JSHeapUsedSize', 'JSHeapTotalSize', 'Nodes', 'LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration', 'JSEventListeners', 'LayoutObjects', 'Documents', 'Frames'];
const escolher = (m) => Object.fromEntries(CAMPOS.map((k) => [k, m[k]]));

function bytesAte(ctx, dados, limiteMs) {
  const reqs = [...ctx.est.reqs.values()];
  const doc = reqs.find((r) => r.type === 'Document' && r.url.startsWith(ctx.origin));
  const toPage = (ts) => (ts - doc.ts) * 1000 + (doc.wall * 1000 - dados.timeOrigin);
  const soma = { js: 0, css: 0, jsArquivos: 0, cssArquivos: 0, jsDescomprimido: 0, cssDescomprimido: 0 };
  const rt = new Map(dados.recursos.map((r) => [r.name, r]));
  for (const r of reqs) {
    if (!r.url.startsWith(ctx.origin) || r.endTs === undefined) continue;
    if (toPage(r.endTs) > limiteMs) continue;
    const k = r.type === 'Script' ? 'js' : r.type === 'Stylesheet' ? 'css' : null;
    if (!k) continue;
    soma[k] += r.encodedDataLength || 0;
    soma[k + 'Arquivos']++;
    soma[k + 'Descomprimido'] += (rt.get(r.url) || {}).decodedBodySize || 0;
  }
  return soma;
}

async function boot({ cpu, servidor, cacheDisabled = true, abrirConversa = false }) {
  const ctx = await H.abrirSessao({ nome: `m9-cpu${cpu}`, servidor, perfil: 'atendente', cacheDisabled, cpu });
  try {
    const { page } = ctx;
    await page.send('Page.navigate', { url: ctx.origin + G.ROTAS.atendimento });
    await page.waitForExpr('window.__marcos && window.__marcos.primeiroItem !== undefined', { timeoutMs: 60000, intervalMs: 25 });
    const dados = await page.eval(`({ timeOrigin: performance.timeOrigin, marcos: window.__marcos,
      recursos: performance.getEntriesByType('resource').map(e => ({ name: e.name, decodedBodySize: e.decodedBodySize, transferSize: e.transferSize })) })`);
    const r = { marcos: Object.fromEntries(Object.entries(dados.marcos).map(([k, v]) => [k, Math.round(v)])), bytesAteLista: bytesAte(ctx, dados, dados.marcos.primeiroItem) };
    if (abrirConversa) {
      await H.esperarFaixaDeConexaoSumir(page);
      await H.esperarEstavel(page, 500);
      r.metricasNaLista = escolher(await H.metricasDePerformance(page));
      r.elementosNaLista = await page.eval("document.querySelectorAll('*').length");
      await H.abrirConversa(page, G.CONVERSAS.A);
      await page.waitForExpr(H.exprSgpCarregado, { timeoutMs: 20000 });
      await H.clicar(page, H.elBotao(G.NOMES.fecharSgp));
      await page.waitForExpr(H.exprSgpFechado);
      await H.esperarEstavel(page, 800);
      r.elementosComConversaAberta = await page.eval("document.querySelectorAll('*').length");
      r.metricasComConversaAberta = escolher(await H.metricasDePerformance(page));
    }
    return r;
  } finally {
    await ctx.close();
  }
}

const srv = await H.subirServidores();
try {
  // (a) (b) (c): uma carga fria sem estrangulamento, depois a conversa aberta.
  const base = await boot({ cpu: 1, servidor: srv.h2, abrirConversa: true });
  console.log('base', JSON.stringify({ elementos: base.elementosComConversaAberta, bytes: base.bytesAteLista, lista: base.marcos.primeiroItem }));

  // (d) CPU 4x e 1x, 3 rodadas cada, navegador novo e cache desligado em cada uma.
  const cpu4 = [];
  const cpu1 = [];
  for (let i = 0; i < RODADAS; i++) {
    cpu4.push(await boot({ cpu: 4, servidor: srv.h2 }));
    cpu1.push(await boot({ cpu: 1, servidor: srv.h2 }));
    console.log(`rodada ${i + 1}: cpu4 lista em ${cpu4[i].marcos.primeiroItem} ms | cpu1 ${cpu1[i].marcos.primeiroItem} ms`);
  }
  const resumo = (rs) => ({
    rodadasMs: rs.map((r) => r.marcos.primeiroItem),
    medianaMs: mediana(rs.map((r) => r.marcos.primeiroItem)),
    medianaMarcos: Object.fromEntries(['raiz', 'esqueleto', 'casca', 'mesa', 'primeiroItem'].map((k) => [k, mediana(rs.map((r) => r.marcos[k]).filter((x) => x !== undefined))])),
  });
  const saida = {
    data: new Date().toISOString(),
    condicoes: {
      build: H.dist(),
      servidor: srv.h2.protocolo + ', gzip nivel ' + srv.h2.gzipLevel,
      viewport: '1366x768',
      perfil: 'atendente',
      cache: 'desligado (carga fria) em todas as rodadas; navegador novo por rodada',
      rede: 'sem estrangulamento (loopback); API forjada instantanea',
      socket: 'bloqueado (falha de transporte)',
    },
    a_elementosNoDOM: { comConversaAberta: base.elementosComConversaAberta, soLista: base.elementosNaLista },
    b_bytesAtePrimeiroItem: base.bytesAteLista,
    c_performanceGetMetrics: { naLista: base.metricasNaLista, comConversaAberta: base.metricasComConversaAberta },
    d_bootAteLista: { cpu4x: resumo(cpu4), cpu1x: resumo(cpu1) },
  };
  H.salvarJson('M9.json', saida);
  console.log(JSON.stringify(saida, null, 1));
} finally {
  await srv.close();
}
