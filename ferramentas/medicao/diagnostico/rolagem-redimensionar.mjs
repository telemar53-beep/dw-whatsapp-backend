// A âncora do "Carregar mensagens anteriores" sobrevive a redimensionar a janela?
//   MEDICAO_DIST=<build> node ferramentas/medicao/diagnostico/rolagem-redimensionar.mjs
// Achado da 2ª revisão da E1.1 (24/09/2026): com o painel SGP aberto, estreitar a
// janela de 1366 para 1100 troca o layout da mesa para "alternado" por um quadro;
// a linha do tempo fica sem caixa, o navegador dispara `scroll` com scrollTop 0 e
// o hook tomava isso pelo usuário, soltando a âncora (−18 px medidos).
// Roteiro: abre a conversa A (60 antigas, 1 foto a cada 4), rola ao topo, clica
// em "Carregar mensagens anteriores", espera as fotos; redimensiona 1100 → 1800 →
// 1366; clica num canto da linha do tempo sem botão.
// Passa se: a âncora não se mexe no clique nem em nenhum tamanho (±4 px), a
// ancoragem nativa fica desligada enquanto a âncora está segura, e o clique no
// canto (o usuário assumindo) a devolve. Sai 0 se passou, 1 se não.
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';

process.env.MEDICAO_HISTORICO_LONGO = '60';

const BOTAO = 'Carregar mensagens anteriores';
const rolagem = G.exprRolagemDe(G.CONVERSAS.A.textos[1]);
const ANCORA = G.CONVERSAS.A.textos[0];
const TOLERANCIA = 4;
const medir = `(() => {
  const t = ${rolagem};
  const b = ${G.exprBolhaCom(ANCORA)};
  const rt = t.getBoundingClientRect();
  return { scrollTop: Math.round(t.scrollTop), topoDaAncora: Math.round(b.getBoundingClientRect().top - rt.top), overflowAnchor: t.style.overflowAnchor, largura: Math.round(rt.width) };
})()`;
const fotosProntas = `(() => { const t = ${rolagem}; return [...t.querySelectorAll('img')].every((i) => i.complete); })()`;

async function tamanho(page, width, height = 768) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await H.sleep(900);
}

const srv = await H.subirServidores();
const ctx = await H.abrirSessao({ nome: 'rolagem-redimensionar', servidor: srv.h2, perfil: 'atendente', width: 1366, height: 768 });
const log = {};
try {
  const { page } = ctx;
  await H.navegar(page, ctx.origin + G.ROTAS.atendimento);
  await H.esperarLista(page);
  await H.esperarFaixaDeConexaoSumir(page);
  await H.abrirConversa(page, G.CONVERSAS.A);
  await page.waitForExpr(`Boolean(${H.elBotao(BOTAO)})`, { timeoutMs: 20000 });
  await H.esperarEstavel(page);

  await page.eval(`(() => { const t = ${rolagem}; t.scrollTop = 0; })()`);
  await H.sleep(400);
  log.antesDoClique = await page.eval(medir);
  await H.clicar(page, H.elBotao(BOTAO), { descricao: BOTAO });
  await page.waitForExpr(`document.body.innerText.includes('Mensagem antiga 60')`, { timeoutMs: 20000 });
  await page.waitForExpr(fotosProntas, { timeoutMs: 20000 });
  await H.sleep(600);
  log.depoisDoClique = await page.eval(medir);

  for (const w of [1100, 1800, 1366]) {
    await tamanho(page, w);
    log[`janela_${w}`] = await page.eval(medir);
  }

  const canto = await page.eval(`(() => { const r = (${rolagem}).getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height / 2 }; })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: canto.x, y: canto.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: canto.x, y: canto.y, button: 'left', clickCount: 1 });
  await H.sleep(300);
  log.depoisDoCliqueNoCanto = await page.eval(medir);
} finally {
  await ctx.close();
  await srv.close();
}

const perto = (a, b) => Math.abs(a - b) <= TOLERANCIA;
const base = log.depoisDoClique.topoDaAncora;
const checagens = {
  cliqueSeguraALeitura: perto(log.antesDoClique.topoDaAncora, base),
  tamanhosSeguramALeitura: [1100, 1800, 1366].every((w) => perto(log[`janela_${w}`].topoDaAncora, base)),
  nativaDesligadaEnquantoSegura: [1100, 1800, 1366].every((w) => log[`janela_${w}`].overflowAnchor === 'none'),
  cliqueDoUsuarioDevolveANativa: log.depoisDoCliqueNoCanto.overflowAnchor === '',
};
const resultado = { build: H.dist(), ...log, checagens, passou: Object.values(checagens).every(Boolean) };
H.salvarJson('_rolagem-redimensionar/resultado.json', resultado);
console.log(JSON.stringify(resultado, null, 2));
process.exit(resultado.passou ? 0 : 1);
