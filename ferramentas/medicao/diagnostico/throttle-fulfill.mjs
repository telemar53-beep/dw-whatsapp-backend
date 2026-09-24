// Prova da limitacao 1 do README: Network.emulateNetworkConditions NAO atrasa
// respostas forjadas por Fetch.fulfillRequest (a API), so as que vao a rede
// (estaticos). Por isso o M7 simula a latencia da API no interceptador.
// Rode de novo se trocar a versao do Chrome.
//   MEDICAO_DIST=<build> node medicao/diagnostico/throttle-fulfill.mjs
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';
import { REDES } from '../lib/session.mjs';

const srv = await H.subirServidores();
const resultado = {};
try {
  for (const cenario of ['sem-rede', 'fast3g']) {
    const ctx = await H.abrirSessao({ nome: 'throttle-' + cenario, servidor: srv.h1, perfil: 'atendente', cacheDisabled: true, rede: cenario === 'fast3g' ? REDES.fast3g : null });
    try {
      await H.navegar(ctx.page, ctx.origin + G.ROTAS.atendimento, { timeoutMs: 120000 });
      await ctx.page.waitForExpr(G.exprTemItem, { timeoutMs: 120000 });
      await H.sleep(500);
      resultado[cenario] = await ctx.page.eval(`performance.getEntriesByType('resource').map(e => ({ n: e.name.replace(location.origin,'').slice(0,70), ini: Math.round(e.startTime), dur: Math.round(e.duration), ttfb: Math.round(e.responseStart - e.startTime) }))`);
    } finally {
      await ctx.close();
    }
  }
} finally {
  await srv.close();
}
for (const [k, v] of Object.entries(resultado)) {
  console.log('==', k);
  for (const e of v) console.log(`  ${String(e.ini).padStart(6)} dur=${String(e.dur).padStart(6)} ttfb=${String(e.ttfb).padStart(6)}  ${e.n}`);
}
