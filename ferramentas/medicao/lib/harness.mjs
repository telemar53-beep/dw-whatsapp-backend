// Pecas comuns a todas as medicoes.
import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer } from './static-server.mjs';
import { newBrowser } from './cdp.mjs';
import { prepararPagina, navegar, sleep } from './session.mjs';
import { certificadoLocalhost } from './cert.mjs';
import * as CFG from './config.mjs';
import * as G from './ganchos.mjs';

export const RES = CFG.RES;
export const PORTA_H2 = CFG.PORTA_H2;
export const PORTA_H1 = CFG.PORTA_H1;
// O build medido (so resolvido quando alguem pede: resumir/comparar nao precisam).
export const dist = () => CFG.dist();

export function garantirPasta(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function salvarJson(rel, obj) {
  const f = path.join(RES, rel);
  garantirPasta(path.dirname(f));
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  return f;
}

export async function subirServidores() {
  const DIST = dist();
  const h2 = await startStaticServer({ root: DIST, port: PORTA_H2, gzip: true, h2: certificadoLocalhost() });
  let h1;
  try {
    h1 = await startStaticServer({ root: DIST, port: PORTA_H1, gzip: true });
  } catch (err) {
    await h2.close();
    throw err;
  }
  return { h2, h1, close: () => Promise.all([h2.close(), h1.close()]) };
}

// Registra uma vez por pasta de saida o ambiente da rodada (vai para o RESUMO).
function registrarAmbiente(versao) {
  const f = path.join(RES, 'ambiente.json');
  if (fs.existsSync(f)) return;
  const DIST = dist();
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  salvarJson('ambiente.json', {
    chrome: versao.product,
    node: process.version,
    plataforma: `${process.platform}-${process.arch}`,
    dist: DIST,
    entrada: (html.match(/<script[^>]+type=["']module["'][^>]*src=["']([^"']+)/) || [])[1] || null,
  });
}

let contador = 0;
export async function abrirSessao({ nome = 'sessao', servidor, width = 1366, height = 768, ...opts }) {
  contador++;
  const profileDir = path.join(CFG.PERFIS, `${nome}-${process.pid}-${contador}`);
  const b = await newBrowser({ profileDir, width, height });
  registrarAmbiente(b.version);
  const est = await prepararPagina(b.page, { origin: servidor.origin, width, height, ...opts });
  return {
    b,
    page: b.page,
    est,
    origin: servidor.origin,
    async close() {
      await b.close();
      try {
        fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (err) {
        console.warn(`aviso: perfil do Chrome nao apagado (${err.code}): ${profileDir}`);
      }
    },
  };
}

export { navegar, sleep };

// ---------- esperas ----------
export const esperarLista = (page, timeoutMs = 60000) => page.waitForExpr(G.exprTemItem, { timeoutMs });

export async function esperarEstavel(page, extraMs = 700) {
  await page.waitForExpr("document.fonts.status === 'loaded' && [...document.images].every(i => i.complete)", { timeoutMs: 20000 }).catch(() => {});
  await sleep(extraMs);
}

// "Conversa rolada ate o fim" e um ESTADO do roteiro, nao um efeito colateral.
// Sem fixar, a posicao dependia de quando a foto terminou de carregar e de o
// painel ter mudado a largura da coluna: o selo de hora sobre a foto entrava ou
// nao na tela, e contagens de elementos visiveis mudavam entre rodadas da mesma
// build (visto no estado "SGP automatico" a 1920 px). Rola duas vezes porque a
// primeira pode disparar novo layout.
export async function fixarFimDaConversa(page, conversa) {
  const ultima = conversa.textos[1];
  for (let i = 0; i < 2; i++) {
    await page.eval(`(() => { const t = ${G.exprRolagemDe(ultima)}; if (t) t.scrollTop = t.scrollHeight; })()`);
    await sleep(250);
  }
}

// O socket bloqueado liga o aviso "Reconectando…" (faixa por 3 s + indicador fixo
// no menu). Espera a faixa passar para nao contaminar os prints.
export async function esperarFaixaDeConexaoSumir(page) {
  await page.waitForExpr(G.exprIndicadorReconectando, { timeoutMs: 15000 }).catch(() => {});
  await page.waitForExpr(`!(${G.exprFaixaReconectando})`, { timeoutMs: 15000 });
}

// ---------- mouse de verdade (nao aciona :focus-visible como element.click()) ----------
export async function clicar(page, exprElemento, { descricao = exprElemento } = {}) {
  const pos = await page.eval(`(() => {
    const el = ${exprElemento};
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!pos) throw new Error('elemento nao encontrado: ' + descricao);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
  // Tira o ponteiro de cima de tudo: sem hover nos prints e nas cores.
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
}

export const elConversa = G.elConversa;
export const elAba = G.elAba;
export const elBotao = G.elBotao;
export const exprSgpCarregado = G.exprSgpCarregado;
export const exprSgpFechado = G.exprSgpFechado;

// conv = G.CONVERSAS.A | G.CONVERSAS.B
export async function abrirConversa(page, conv) {
  await clicar(page, G.elConversa(conv.nome), { descricao: 'conversa ' + conv.nome });
  await page.waitForExpr(G.exprConversaAberta(conv), { timeoutMs: 30000 });
}

export async function metricasDePerformance(page) {
  const { metrics } = await page.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}
