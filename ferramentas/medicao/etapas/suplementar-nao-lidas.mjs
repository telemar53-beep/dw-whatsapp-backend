// SUPLEMENTAR — estado "nao lida" e socket conectado. FORA da regra de bloqueio
// do socket.io: aqui o transporte polling e emulado na interceptacao para
// entregar 4 eventos message:new (2 em Andamento, 2 na Espera). Serve so para
// medir o que o bloqueio torna impossivel: marca de nao lida e menu sem o
// indicador "Reconectando…". Resultados em <saida>/suplementar/.
import fs from 'node:fs';
import path from 'node:path';
import * as H from '../lib/harness.mjs';
import * as G from '../lib/ganchos.mjs';
import * as F from '../lib/fixtures.mjs';
import { SocketEmulado } from '../lib/socket-emulado.mjs';
import { coletarEstilos, coletarItens, comoExpressao } from '../lib/coleta-dom.mjs';
import { analisarSuperficies, analisarCores, analisarProfundidade, analisarItens } from '../lib/analise.mjs';

const PASTA = H.garantirPasta(path.join(H.RES, 'suplementar'));
const BRUTOS = H.garantirPasta(path.join(H.RES, 'brutos'));

function evento(conv, n, texto) {
  const createdAt = F.quando(0, '14:30');
  const message = {
    id: F.uuid(`evento-${conv.id}-${n}`),
    conversationId: conv.id,
    direction: 'inbound',
    content: texto,
    messageType: 'text',
    mediaPath: null,
    status: 'received',
    sentBy: null,
    metadata: null,
    createdAt,
    repliedToPreview: null,
  };
  const conversation = { ...conv, lastMessageContent: texto, lastMessageType: 'text', lastMessageStatus: 'received', lastMessageDirection: 'inbound', lastMessageAt: createdAt, updatedAt: createdAt };
  return ['message:new', { conversation, message }];
}
const minhas = F.minhasConversas(F.EU_ATENDENTE);
const fila = F.fila();
const EVENTOS = [
  evento(minhas.find((c) => c.contactDisplayName === 'Ana'), 1, 'Oi, o boleto veio com valor diferente'),
  evento(minhas.find((c) => c.contactDisplayName === 'Raimundo Nonato Ferreira'), 1, 'agora parou de vez'),
  evento(fila.find((c) => c.contactDisplayName === 'Carlos'), 1, 'alguém pode me ajudar?'),
  evento(fila.find((c) => c.contactDisplayName === 'Irene'), 1, 'preciso da segunda via'),
];

async function registrar(page, nome, { itens }) {
  const arq = path.join(PASTA, `atendente-1366-${nome}.png`);
  await page.screenshot(arq);
  const coleta = await page.eval(comoExpressao(coletarEstilos, { artefatos: [] }));
  fs.writeFileSync(path.join(BRUTOS, `suplementar-${nome}.json`), JSON.stringify(coleta));
  const r = {
    estado: nome,
    print: path.relative(H.RES, arq).replaceAll('\\', '/'),
    totalElementos: coleta.totalElementos,
    indicadorReconectandoPresente: await page.eval(G.exprIndicadorReconectando),
    M2: analisarSuperficies(coleta),
    M3: analisarCores(coleta),
    M5: analisarProfundidade(coleta),
  };
  if (itens) r.M4 = analisarItens(await page.eval(comoExpressao(coletarItens)));
  const naoLidas = await page.eval(G.exprNaoLidas);
  H.salvarJson(`suplementar/atendente-1366-${nome}.json`, r);
  console.log(`${nome}: familias ${r.M3.familiasVisiveis} (${r.M3.quais.join(', ')}) | reconectando: ${r.indicadorReconectandoPresente}` + (r.M4 ? ` | itens ${r.M4.itens}, nao lidos ${naoLidas.length}` : ''));
  return r;
}

const srv = await H.subirServidores();
let socket;
const ctx = await H.abrirSessao({
  nome: 'suplementar',
  servidor: srv.h2,
  perfil: 'atendente',
  socketEmulado: (socket = new SocketEmulado({ origin: srv.h2.origin, eventos: EVENTOS })),
});
const saida = { aviso: 'Medição suplementar com socket.io EMULADO (fora da regra de bloqueio). Não substitui M1–M5.', eventos: EVENTOS.map(([n, p]) => `${n} → ${p.conversation.contactDisplayName}`) };
try {
  const { page } = ctx;
  await H.navegar(page, ctx.origin + G.ROTAS.atendimento);
  await H.esperarLista(page);
  await page.waitForExpr(`${G.exprNaoLidas}.length >= 2`, { timeoutMs: 20000 });
  await H.esperarEstavel(page, 800);
  saida.naoLidasEmAndamento = await page.eval(G.exprNaoLidas);
  saida.lista = await registrar(page, 'socket-emulado-0-lista-nao-lidas', { itens: true });

  await H.abrirConversa(page, G.CONVERSAS.A);
  await page.waitForExpr(H.exprSgpCarregado, { timeoutMs: 20000 });
  await H.clicar(page, H.elBotao(G.NOMES.fecharSgp));
  await page.waitForExpr(H.exprSgpFechado);
  await H.esperarEstavel(page, 800);
  saida.conversa = await registrar(page, 'socket-emulado-1-conversa', { itens: true });

  await H.clicar(page, H.elAba(G.NOMES.abas.espera));
  await page.waitForExpr(`${G.exprItens}.length >= 14`);
  await H.esperarEstavel(page, 800);
  saida.naoLidasNaEspera = await page.eval(G.exprNaoLidas);
  saida.espera = await registrar(page, 'socket-emulado-2-aba-espera', { itens: true });
  saida.socketLog = socket.log;
  saida.naoAtendidos = ctx.est.naoAtendidos;
} finally {
  await ctx.close();
  await srv.close();
}
H.salvarJson('SUPLEMENTAR-nao-lidas.json', {
  aviso: saida.aviso,
  eventos: saida.eventos,
  naoLidasEmAndamento: saida.naoLidasEmAndamento,
  naoLidasNaEspera: saida.naoLidasNaEspera,
  resumo: ['lista', 'conversa', 'espera'].map((k) => ({
    estado: saida[k].estado,
    print: saida[k].print,
    familias: saida[k].M3.familiasVisiveis,
    quais: saida[k].M3.quais,
    indicadorReconectando: saida[k].indicadorReconectandoPresente,
    M4: saida[k].M4 ? { itens: saida[k].M4.itens, pecas: saida[k].M4.pecasVisiveis, elementos: saida[k].M4.elementosDOM, tipos: saida[k].M4.tiposDePeca } : null,
  })),
  socketLog: saida.socketLog,
  naoAtendidos: saida.naoAtendidos,
});
console.log('nao lidas', saida.naoLidasEmAndamento, saida.naoLidasNaEspera);
