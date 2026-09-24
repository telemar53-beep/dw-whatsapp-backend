// OPCIONAL — M2, M3 e M5 em /supervisao, /relatorios e /configuracoes/canais
// (perfil admin, 1366x768), com fixtures minimas.
import fs from 'node:fs';
import path from 'node:path';
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';
import { coletarEstilos, comoExpressao } from '../lib/coleta-dom.mjs';
import { analisarSuperficies, analisarCores, analisarProfundidade, coresDasImagens } from '../lib/analise.mjs';

const ROTAS = [
  { id: 'supervisao', rota: G.ROTAS.supervisao, pronto: G.PRONTO_OPCIONAL.supervisao },
  { id: 'relatorios', rota: G.ROTAS.relatorios, pronto: G.PRONTO_OPCIONAL.relatorios },
  { id: 'configuracoes-canais', rota: G.ROTAS.canais, pronto: G.PRONTO_OPCIONAL.canais },
];
const PASTA = H.garantirPasta(path.join(H.RES, 'opcional'));
const BRUTOS = H.garantirPasta(path.join(H.RES, 'brutos'));

const srv = await H.subirServidores();
const resumo = {};
try {
  for (const r of ROTAS) {
    const ctx = await H.abrirSessao({ nome: 'opc-' + r.id, servidor: srv.h2, perfil: 'admin' });
    try {
      const { page } = ctx;
      await H.navegar(page, ctx.origin + r.rota);
      await page.waitForExpr(r.pronto, { timeoutMs: 30000 });
      await page.waitForExpr(`!(${G.exprCarregando})`, { timeoutMs: 15000 }).catch(() => {});
      await H.esperarFaixaDeConexaoSumir(page);
      await H.esperarEstavel(page, 1200);
      const arq = path.join(PASTA, `admin-1366-${r.id}.png`);
      const png = await page.screenshot(arq);
      const coleta = await page.eval(comoExpressao(coletarEstilos, { artefatos: G.ARTEFATOS }));
      fs.writeFileSync(path.join(BRUTOS, `opcional-${r.id}.json`), JSON.stringify(coleta));
      const res = {
        rota: r.rota,
        print: path.relative(H.RES, arq).replaceAll('\\', '/'),
        totalElementos: coleta.totalElementos,
        M2: analisarSuperficies(coleta, { semArtefatos: true }),
        M3: analisarCores(coleta, { semArtefatos: true }),
        M3estendido: analisarCores(coleta, { semArtefatos: true, estendido: true }),
        M3imagens: coresDasImagens(coleta, png),
        M5: analisarProfundidade(coleta, { semArtefatos: true }),
        naoAtendidos: ctx.est.naoAtendidos,
        requisicoesApi: ctx.est.log.filter((e) => e.tipo === 'api').map((e) => `${e.method} ${e.path} -> ${e.status}`),
      };
      H.salvarJson(`opcional/admin-1366-${r.id}.json`, res);
      resumo[r.id] = {
        elementos: res.totalElementos,
        bgDistintos: res.M2.backgroundColor.distintos,
        bgImageDistintos: res.M2.backgroundImage.distintos,
        backdrop: res.M2.backdropFilter.elementos,
        sombrasDistintas: res.M2.boxShadow.distintos,
        raiosDistintos: res.M2.borderRadius.distintos,
        bordasDistintas: res.M2.borderColor.distintos,
        familias: res.M3.familiasVisiveis,
        quais: res.M3.quais,
        camadasMax: res.M5.maximo,
        camadasMediana: res.M5.mediana,
        naoAtendidos: res.naoAtendidos,
      };
      console.log(r.id, JSON.stringify(resumo[r.id]));
    } finally {
      await ctx.close();
    }
  }
} finally {
  await srv.close();
}
H.salvarJson('OPCIONAL.json', resumo);
