// M1 (prints), M2 (superficies), M3 (cores de destaque), M4 (item da lista),
// M5 (profundidade) — tela de Atendimento "/", atendente em 1366x768 e 1920x1080
// e admin em 1366x768.
//   node etapas/m1-m5.mjs                -> todas as configuracoes
//   node etapas/m1-m5.mjs atendente-1366 -> so uma
import fs from 'node:fs';
import path from 'node:path';
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';
import { coletarEstilos, coletarItens, comoExpressao } from '../lib/coleta-dom.mjs';
import { analisarSuperficies, analisarCores, analisarProfundidade, analisarItens, coresDasImagens } from '../lib/analise.mjs';

const CONFIGS = [
  { id: 'atendente-1366', perfil: 'atendente', w: 1366, h: 768 },
  { id: 'atendente-1920', perfil: 'atendente', w: 1920, h: 1080 },
  { id: 'admin-1366', perfil: 'admin', w: 1366, h: 768 },
];

const filtro = process.argv.slice(2);
const escolhidas = filtro.length ? CONFIGS.filter((c) => filtro.includes(c.id)) : CONFIGS;
const PASTA = H.garantirPasta(path.join(H.RES, 'm1-m5'));
const BRUTOS = H.garantirPasta(path.join(H.RES, 'brutos'));

async function registrar(ctx, cfg, estado, { itens = false, extra = {} } = {}) {
  const arqPng = path.join(PASTA, `${cfg.id}-${estado}.png`);
  const png = await ctx.page.screenshot(arqPng);
  // Indicador "Reconectando…" e faixa de 3 s: existem so porque o socket esta bloqueado.
  const coleta = await ctx.page.eval(comoExpressao(coletarEstilos, { artefatos: G.ARTEFATOS }));
  fs.writeFileSync(path.join(BRUTOS, `m1-m5-${cfg.id}-${estado}.json`), JSON.stringify(coleta));
  const r = {
    config: cfg,
    estado,
    print: path.relative(H.RES, arqPng).replaceAll('\\', '/'),
    totalElementos: coleta.totalElementos,
    totalNos: coleta.totalNos,
    artefatosDoSocketBloqueado: coleta.elementos.filter((e) => e.artefato && !e.pseudo).map((e) => e.sel),
    M2: { semArtefato: analisarSuperficies(coleta, { semArtefatos: true }), comArtefato: analisarSuperficies(coleta) },
    M3: {
      // principal = color, background-color, border-*-color, fill/stroke (inclui ::before/::after)
      semArtefato: analisarCores(coleta, { semArtefatos: true }),
      comArtefato: analisarCores(coleta),
      // estendido = + paradas de gradiente e cores de box-shadow
      estendidoSemArtefato: analisarCores(coleta, { semArtefatos: true, estendido: true }),
      imagens: coresDasImagens(coleta, png),
    },
    M5: { semArtefato: analisarProfundidade(coleta, { semArtefatos: true }), comArtefato: analisarProfundidade(coleta) },
    ...extra,
  };
  if (itens) {
    const brutoItens = await ctx.page.eval(comoExpressao(coletarItens));
    r.M4 = analisarItens(brutoItens);
  }
  H.salvarJson(`m1-m5/${cfg.id}-${estado}.json`, r);
  const m3 = r.M3.semArtefato;
  console.log(
    `  [${cfg.id}] ${estado}: ${r.totalElementos} elementos | bg distintos ${r.M2.semArtefato.backgroundColor.distintos} | backdrop ${r.M2.semArtefato.backdropFilter.elementos} | familias ${m3.familiasVisiveis} (${m3.quais.join(', ')}) | camadas max ${r.M5.semArtefato.maximo}` +
      (r.M4 ? ` | itens ${r.M4.itens}` : '')
  );
  return r;
}

const itensNaLista = (n, op = '>=') => `${G.exprItens}.length ${op} ${n}`;

async function rodar(cfg, servidor) {
  console.log(`== ${cfg.id}`);
  const ctx = await H.abrirSessao({ nome: `m1-${cfg.id}`, servidor, width: cfg.w, height: cfg.h, perfil: cfg.perfil });
  const saida = { config: cfg, estados: {} };
  try {
    const { page } = ctx;
    await H.navegar(page, ctx.origin + G.ROTAS.atendimento);
    await H.esperarLista(page);
    await H.esperarFaixaDeConexaoSumir(page);
    await H.esperarEstavel(page);
    saida.estados['0-lista'] = await registrar(ctx, cfg, '0-lista', { itens: true });

    // Conversa A: tem CPF no contato, entao o painel do SGP abre sozinho e consulta.
    await H.abrirConversa(page, G.CONVERSAS.A);
    await page.waitForExpr(H.exprSgpCarregado, { timeoutMs: 20000 });
    await H.esperarEstavel(page);
    await H.fixarFimDaConversa(page, G.CONVERSAS.A);
    saida.estados['2-conversa-sgp-automatico'] = await registrar(ctx, cfg, '2-conversa-sgp-automatico');

    await H.clicar(page, H.elBotao(G.NOMES.fecharSgp));
    await page.waitForExpr(H.exprSgpFechado);
    await H.esperarEstavel(page);
    await H.fixarFimDaConversa(page, G.CONVERSAS.A);
    const perf = await H.metricasDePerformance(page);
    saida.estados['1-conversa'] = await registrar(ctx, cfg, '1-conversa', { itens: true, extra: { performanceGetMetrics: perf } });

    // Mesma conversa rolada ate a transferencia (IA de ontem + mensagem de abertura).
    await page.eval(`(() => { const b = ${G.exprBolhaCom(G.TEXTOS.transferencia)}; b.scrollIntoView({ block: 'center' }); })()`);
    await H.sleep(500);
    saida.estados['3-conversa-transferencia'] = await registrar(ctx, cfg, '3-conversa-transferencia');
    const ultimaDeA = G.CONVERSAS.A.textos[1];
    await page.eval(`(() => { const t = ${G.exprRolagemDe(ultimaDeA)}; t.scrollTop = t.scrollHeight; })()`);
    await H.sleep(300);

    await H.clicar(page, H.elBotao(G.NOMES.dadosDoCliente));
    await page.waitForExpr(G.exprDadosDoClienteAbertos);
    await H.esperarEstavel(page);
    await H.fixarFimDaConversa(page, G.CONVERSAS.A);
    saida.estados['4-dados-do-cliente'] = await registrar(ctx, cfg, '4-dados-do-cliente');

    await H.clicar(page, H.elBotao(G.NOMES.fecharDadosDoCliente));
    await H.clicar(page, H.elBotao(G.NOMES.consultarSgp));
    await page.waitForExpr(H.exprSgpCarregado, { timeoutMs: 20000 });
    await H.esperarEstavel(page);
    await H.fixarFimDaConversa(page, G.CONVERSAS.A);
    saida.estados['5-sgp'] = await registrar(ctx, cfg, '5-sgp');

    await H.clicar(page, H.elBotao(G.NOMES.fecharSgp));
    await H.clicar(page, H.elAba(G.NOMES.abas.espera));
    await page.waitForExpr(itensNaLista(14));
    await H.esperarEstavel(page);
    saida.estados['6-aba-espera'] = await registrar(ctx, cfg, '6-aba-espera', { itens: true });

    await H.clicar(page, H.elAba(G.NOMES.abas.automacao));
    await page.waitForExpr(itensNaLista(2, '==='));
    await H.esperarEstavel(page);
    saida.estados['7-aba-automacao'] = await registrar(ctx, cfg, '7-aba-automacao', { itens: true });

    saida.requisicoesNaoAtendidas = ctx.est.naoAtendidos;
    saida.requisicoesExternasBloqueadas = ctx.est.externos;
  } finally {
    await ctx.close();
  }
  return saida;
}

const srv = await H.subirServidores();
try {
  for (const cfg of escolhidas) {
    const s = await rodar(cfg, srv.h2);
    H.salvarJson(`m1-m5/${cfg.id}-indice.json`, {
      config: s.config,
      estados: Object.keys(s.estados),
      prints: Object.values(s.estados).map((e) => e.print),
      requisicoesNaoAtendidas: s.requisicoesNaoAtendidas,
      requisicoesExternasBloqueadas: s.requisicoesExternasBloqueadas,
    });
  }
} finally {
  await srv.close();
}
