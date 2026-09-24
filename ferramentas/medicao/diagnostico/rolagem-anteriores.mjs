// "Carregar mensagens anteriores" no navegador de verdade (o jsdom não calcula
// layout, então só aqui se prova que a posição de leitura fica).
//   MEDICAO_DIST=<build> node ferramentas/medicao/diagnostico/rolagem-anteriores.mjs
//
// Duas rodadas, cada uma numa sessão nova:
//   - "nativa": o Chrome como ele é, com a ancoragem de rolagem própria dele
//     (overflow-anchor: auto);
//   - "sem-nativa": a mesma coisa com `overflow-anchor: none` na linha do
//     tempo — é como o Safari se comporta (ele não tem ancoragem nativa).
// Em cada rodada, dois cliques na conversa A:
//   1. com a linha do tempo no topo (scrollTop 0);
//   2. com ela um pouco rolada (scrollTop 30).
// O trecho que entra tem fotos (1 em cada 4), que não reservam altura e
// terminam de carregar DEPOIS de o trecho entrar: a medida "depois" só é tirada
// com todas as fotos carregadas.
// Cada clique passa se: (1) a linha do tempo NÃO foi para o fim; e (2) a
// mensagem que estava no topo continua no mesmo lugar da tela (±4 px).
// Sai 0 se tudo passou, 1 se não.
import path from 'node:path';
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';

// 60 mensagens mais antigas antes das 50 da conversa A: a abertura traz as 50
// mais novas; o 1º clique traz as antigas 11 a 60; o 2º, as antigas 1 a 10.
process.env.MEDICAO_HISTORICO_LONGO = '60';

const BOTAO = 'Carregar mensagens anteriores';
const ultimaDaFixture = G.CONVERSAS.A.textos[1];
const rolagem = G.exprRolagemDe(ultimaDaFixture);

const medir = (textoDaAncora) => `(() => {
  const t = ${rolagem};
  if (!t) return null;
  const b = ${G.exprBolhaCom(textoDaAncora)};
  const rt = t.getBoundingClientRect();
  const rb = b ? b.getBoundingClientRect() : null;
  const fotos = [...t.querySelectorAll('img')].filter((i) => !i.closest('button[aria-label*="perfil"]'));
  return {
    scrollTop: Math.round(t.scrollTop),
    scrollHeight: t.scrollHeight,
    clientHeight: t.clientHeight,
    // 24 e não 4: o marcador de fim da tela fica acima do padding de baixo da
    // lista (8 px), e "ir para o fim" pára nele, não no último pixel.
    noFim: t.scrollHeight - t.scrollTop - t.clientHeight < 24,
    topoDaAncora: rb ? Math.round(rb.top - rt.top) : null,
    fotosNaLinhaDoTempo: fotos.length,
    fotosCarregadas: fotos.filter((i) => i.complete && i.naturalHeight > 0).length,
  };
})()`;

const fotosProntas = `(() => {
  const t = ${rolagem};
  return Boolean(t) && [...t.querySelectorAll('img')].every((i) => i.complete);
})()`;

async function clicarEComparar(page, pasta, { nome, scrollTop, ancora, esperarDepois }) {
  await page.eval(`(() => { const t = ${rolagem}; t.scrollTop = ${scrollTop}; })()`);
  await H.sleep(400);
  const antes = await page.eval(medir(ancora));
  await page.screenshot(path.join(pasta, `${nome}-1-antes.png`));

  await H.clicar(page, H.elBotao(BOTAO), { descricao: BOTAO });
  await page.waitForExpr(esperarDepois, { timeoutMs: 20000 });
  await page.waitForExpr(fotosProntas, { timeoutMs: 20000 });
  await H.sleep(600);
  const depois = await page.eval(medir(ancora));
  await page.screenshot(path.join(pasta, `${nome}-2-depois.png`));

  const naoFoiParaOFim = depois.noFim === false;
  const deslocamento = depois.topoDaAncora - antes.topoDaAncora;
  const posicaoMantida = Math.abs(deslocamento) <= 4;
  return { ancora, antes, depois, naoFoiParaOFim, deslocamentoPx: deslocamento, posicaoMantida, passou: naoFoiParaOFim && posicaoMantida };
}

async function rodada(modo) {
  const pasta = H.garantirPasta(path.join(H.RES, '_rolagem-anteriores', modo));
  const srv = await H.subirServidores();
  const ctx = await H.abrirSessao({ nome: `rolagem-anteriores-${modo}`, servidor: srv.h2, perfil: 'atendente' });
  try {
    const { page } = ctx;
    await H.navegar(page, ctx.origin + G.ROTAS.atendimento);
    await H.esperarLista(page);
    await H.esperarFaixaDeConexaoSumir(page);
    if (modo === 'sem-nativa') {
      await page.eval(`(() => {
        const s = document.createElement('style');
        s.textContent = '.chat-workspace-timeline{overflow-anchor:none !important}';
        document.head.appendChild(s);
      })()`);
    }
    await H.abrirConversa(page, G.CONVERSAS.A);
    await page.waitForExpr(`Boolean(${H.elBotao(BOTAO)})`, { timeoutMs: 20000 });
    await H.esperarEstavel(page);
    const ancoragem = await page.eval(`getComputedStyle(${rolagem}).overflowAnchor`);

    // O atendente rola até o topo para ler o começo e clica no botão.
    const noTopo = await clicarEComparar(page, pasta, {
      nome: '1-no-topo',
      scrollTop: 0,
      ancora: G.CONVERSAS.A.textos[0],
      esperarDepois: `document.body.innerText.includes('Mensagem antiga 60')`,
    });

    // Segundo trecho, clicando com a lista um pouco rolada. A âncora é a
    // primeira do trecho que acabou de entrar ("Mensagem antiga 11").
    const quaseNoTopo = await clicarEComparar(page, pasta, {
      nome: '2-quase-no-topo',
      scrollTop: 30,
      ancora: 'Mensagem antiga 11',
      esperarDepois: `!${H.elBotao(BOTAO)}`,
    });
    // Enquanto a correção segura a âncora, a ancoragem nativa fica desligada;
    // quando o usuário rola (roda de verdade, pelo CDP), ela tem de voltar.
    const duranteASegura = await page.eval(`getComputedStyle(${rolagem}).overflowAnchor`);
    const centro = await page.eval(`(() => { const r = (${rolagem}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: centro.x, y: centro.y, deltaX: 0, deltaY: 120 });
    await H.sleep(400);
    const depoisDaRoda = await page.eval(`getComputedStyle(${rolagem}).overflowAnchor`);
    const ancoragemVolta = depoisDaRoda === ancoragem;
    return {
      overflowAnchor: ancoragem,
      ancoragemNativa: { duranteASegura, depoisDaRoda, volta: ancoragemVolta },
      noTopo,
      quaseNoTopo,
      passou: noTopo.passou && quaseNoTopo.passou && ancoragemVolta,
    };
  } finally {
    await ctx.close();
    await srv.close();
  }
}

const nativa = await rodada('nativa');
const semNativa = await rodada('sem-nativa');
const resultado = { build: H.dist(), nativa, semNativa, passou: nativa.passou && semNativa.passou };
H.salvarJson('_rolagem-anteriores/resultado.json', resultado);
console.log(JSON.stringify(resultado, null, 2));
process.exit(resultado.passou ? 0 : 1);
