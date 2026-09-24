// Teste de fumaca (1 Chrome, ~10 s): sobe o servidor, abre a rota com sessao e
// mostra o que foi pedido, o que ficou sem resposta e se os ganchos acham a
// lista. Rode ANTES da medicao completa quando o redesenho mexer no DOM.
//   MEDICAO_DIST=<build> node medicao/diagnostico/smoke.mjs [atendente|admin|nenhum] [rota]
import path from 'node:path';
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';

const perfil = process.argv[2] === 'nenhum' ? null : process.argv[2] || 'atendente';
const rota = process.argv[3] || G.ROTAS.atendimento;
const srv = await H.subirServidores();
const ctx = await H.abrirSessao({ nome: 'smoke', servidor: srv.h2, perfil });
console.log('Chrome', ctx.b.version.product);
try {
  const { page, est } = ctx;
  await H.navegar(page, ctx.origin + rota);
  await page.waitForExpr(`${G.exprTemItem} || document.querySelector(${JSON.stringify(G.MARCOS.formLogin.sel)})`, { timeoutMs: 20000 }).catch((e) => console.log('nao apareceu item nem login:', e.message));
  await H.sleep(2500);
  await page.screenshot(path.join(H.garantirPasta(path.join(H.RES, '_smoke')), 'smoke.png'));
  console.log('marcos', await page.eval('window.__marcos'));
  console.log('itens na lista', await page.eval(`${G.exprItens}.length`));
  console.log('log:');
  for (const e of est.log) console.log(' ', e.t, e.tipo, e.method, e.url, e.status ?? '', e.atendido === false ? 'NAO-ATENDIDO' : '');
  console.log('naoAtendidos', est.naoAtendidos);
  console.log('externos', est.externos);
  console.log('socket tentativas', est.socket);
  console.log('TEXTO:', await page.eval('document.body.innerText.slice(0, 1500)'));
} finally {
  await ctx.close();
  await srv.close();
}
