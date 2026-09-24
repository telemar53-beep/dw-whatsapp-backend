// M6 — esqueleto do Suspense. Segura o chunk do AppShell (e, noutro cenario, o
// do DashboardPage) por 5 s na interceptacao, tira print aos ~1,5 s e mede cor
// das barras x fundo efetivo (computado e em pixels do print).
// O chunk e achado pelo manifesto do Vite (build com --manifest), pela fonte;
// sem manifesto, pelo nome do arquivo. Se nada for segurado, a etapa FALHA
// (antes, um chunk renomeado so fazia a metrica sumir do RESUMO).
import fs from 'node:fs';
import path from 'node:path';
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';
import { lerCor, fundoEfetivo, compor, contraste, hex, paraOklch } from '../lib/cores.mjs';
import { decodePng, modeColor } from '../lib/png.mjs';

const SEGURAR_MS = 5000;
const PRINT_EM_MS = 1500;
const PASTA = H.garantirPasta(path.join(H.RES, 'm6'));
const DIST = H.dist();

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function padraoDoChunk({ fonte, nome }) {
  const arqManifesto = path.join(DIST, '.vite', 'manifest.json');
  if (fs.existsSync(arqManifesto)) {
    const manifesto = JSON.parse(fs.readFileSync(arqManifesto, 'utf8'));
    const item = manifesto[fonte];
    if (item && item.file) return { padrao: new RegExp('/' + escapar(item.file) + '$'), chunk: item.file, via: 'manifesto' };
  }
  return { padrao: new RegExp(`/assets/${escapar(nome)}-[^/]+\\.js$`), chunk: `${nome}-*.js`, via: 'nome do arquivo' };
}
const CENARIOS = G.CHUNKS_M6.map((c) => ({ id: c.id, ...padraoDoChunk(c) }));

const COLETA = `(() => {
  const barras = ${G.exprBarrasDoEsqueleto};
  const sel = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
  return {
    agora: performance.now(),
    raizFilhos: document.getElementById('root').children.length,
    cascaMontada: ${G.exprCascaMontada},
    barras: barras.map((b) => {
      const r = b.getBoundingClientRect();
      const s = getComputedStyle(b);
      const cadeia = [];
      for (let a = b.parentElement; a; a = a.parentElement) {
        const sa = getComputedStyle(a);
        cadeia.push({ sel: sel(a), bg: sa.backgroundColor, img: sa.backgroundImage === 'none' ? null : sa.backgroundImage.slice(0, 120), opacity: sa.opacity });
      }
      return {
        caixa: { x: r.left, y: r.top, w: r.width, h: r.height },
        classe: b.className,
        backgroundColor: s.backgroundColor,
        opacityAnimada: s.opacity,
        animacao: s.animationName + ' ' + s.animationDuration + ' ' + s.animationIterationCount,
        ancestrais: cadeia,
      };
    }),
  };
})()`;

async function rodar(cenario, servidor) {
  const ctx = await H.abrirSessao({
    nome: 'm6-' + cenario.id,
    servidor,
    perfil: 'atendente',
    cacheDisabled: true,
    segurar: [{ padrao: cenario.padrao, ms: SEGURAR_MS }],
  });
  try {
    const { page } = ctx;
    const t0 = Date.now();
    await page.send('Page.navigate', { url: ctx.origin + G.ROTAS.atendimento });
    const falta = PRINT_EM_MS - (Date.now() - t0);
    if (falta > 0) await H.sleep(falta);
    const arq = path.join(PASTA, `m6-${cenario.id}-1500ms.png`);
    const png = await page.screenshot(arq);
    const tPrint = Date.now() - t0;
    const dom = await page.eval(COLETA);
    const img = decodePng(png);
    if (!ctx.est.segurados.length) {
      throw new Error(`M6/${cenario.id}: nenhum pedido casou com ${cenario.padrao} (${cenario.via}) — o chunk mudou de nome/fonte? Ajuste CHUNKS_M6 em lib/ganchos.mjs.`);
    }

    const barras = dom.barras.map((b) => {
      const corBarra = lerCor(b.backgroundColor);
      const op = parseFloat(b.opacityAnimada);
      // Cadeia do html para dentro; sem fundo nenhum = branco do canvas.
      const fundos = [...b.ancestrais].reverse().map((a) => a.bg);
      const fundo = fundoEfetivo(fundos);
      const temFundoDeclarado = b.ancestrais.some((a) => lerCor(a.bg) && lerCor(a.bg).alpha > 0);
      const barraComOpacidadeMax = compor({ ...corBarra, alpha: corBarra.alpha }, fundo);
      const barraNaOpacidadeAtual = compor({ ...corBarra, alpha: corBarra.alpha * op }, fundo);
      // Pixels do print: moda dentro da barra e na faixa logo abaixo (espaco entre barras).
      const { x, y, w, h } = b.caixa;
      const pxBarra = modeColor(img, x + 4, y + 3, x + w - 4, y + h - 3);
      const pxFundo = modeColor(img, x + 4, y + h + 2, x + w - 4, y + h + 8);
      const cPix = pxBarra && pxFundo ? contraste(lerCor(`rgb(${pxBarra.rgb.join(',')})`), lerCor(`rgb(${pxFundo.rgb.join(',')})`)) : null;
      return {
        caixa: b.caixa,
        backgroundColorComputado: b.backgroundColor,
        barraHex: hex(corBarra),
        barraAlpha: +corBarra.alpha.toFixed(3),
        opacityAnimadaNoPrint: op,
        animacao: b.animacao,
        ancestraisComFundo: b.ancestrais.filter((a) => (lerCor(a.bg) && lerCor(a.bg).alpha > 0) || a.img).map((a) => ({ sel: a.sel, bg: a.bg, img: a.img })),
        fundoEfetivo: { hex: hex(fundo), oklch: paraOklch(fundo), origem: temFundoDeclarado ? 'fundos declarados nos ancestrais' : 'nenhum ancestral tem fundo: branco do canvas' },
        barraComposta: { opacidade1: hex(barraComOpacidadeMax), opacidadeAtual: hex(barraNaOpacidadeAtual) },
        contrasteWCAG: {
          computado_opacidade1: +contraste(barraComOpacidadeMax, fundo).toFixed(3),
          computado_opacidadeAtual: +contraste(barraNaOpacidadeAtual, fundo).toFixed(3),
          pixels_do_print: cPix ? +cPix.toFixed(3) : null,
        },
        pixels: { barra: pxBarra, fundoAbaixo: pxFundo },
      };
    });

    // Depois de soltar o chunk, a tela chega normalmente?
    await H.esperarLista(page, 30000);
    const marcos = await page.eval('window.__marcos');
    return {
      cenario: cenario.id,
      chunkSegurado: cenario.chunk,
      chunkAchadoPor: cenario.via,
      segurarMs: SEGURAR_MS,
      segurados: ctx.est.segurados,
      printAposNavegarMs: tPrint,
      print: path.relative(H.RES, arq).replaceAll('\\', '/'),
      noMomentoDoPrint: { performanceNow: dom.agora, cascaMontada: dom.cascaMontada, barras: dom.barras.length },
      barras,
      marcosDepois: marcos,
    };
  } finally {
    await ctx.close();
  }
}

const srv = await H.subirServidores();
try {
  const saida = { data: new Date().toISOString(), cenarios: [] };
  for (const c of CENARIOS) {
    const r = await rodar(c, srv.h2);
    saida.cenarios.push(r);
    const b0 = r.barras[0];
    console.log(
      `${c.id}: ${r.barras.length} barras | barra ${b0 && b0.backgroundColorComputado} op ${b0 && b0.opacityAnimadaNoPrint} | fundo ${b0 && b0.fundoEfetivo.hex} (${b0 && b0.fundoEfetivo.origem}) | contraste ${b0 && JSON.stringify(b0.contrasteWCAG)}`
    );
  }
  const a = saida.cenarios[0].barras;
  saida.veredito = {
    afirmacao: 'barras brancas a 8% sobre fundo branco, invisíveis',
    appshell: a.length
      ? {
          barraBranca8: a.every((b) => b.barraHex === '#ffffff' && Math.abs(b.barraAlpha - 0.08) < 0.005),
          fundoBranco: a.every((b) => b.fundoEfetivo.hex === '#ffffff'),
          contrasteMaximo: Math.max(...a.map((b) => b.contrasteWCAG.computado_opacidade1)),
          contrastePixels: a.map((b) => b.contrasteWCAG.pixels_do_print),
        }
      : 'nenhuma barra encontrada no momento do print',
    dashboardpage: saida.cenarios[1].barras.length
      ? {
          fundo: saida.cenarios[1].barras[0].fundoEfetivo.hex,
          contrasteComputado: saida.cenarios[1].barras.map((b) => b.contrasteWCAG.computado_opacidadeAtual),
          contrastePixels: saida.cenarios[1].barras.map((b) => b.contrasteWCAG.pixels_do_print),
        }
      : 'nenhuma barra encontrada',
  };
  H.salvarJson('M6.json', saida);
  console.log(JSON.stringify(saida.veredito, null, 2));
} finally {
  await srv.close();
}
