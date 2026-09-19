import { isOfficialChannelType } from './channelTypes';

// A janela de atendimento da Meta: fora das 24 horas contadas da última
// mensagem DO CLIENTE, só template aprovado é entregue (erro 131047).
//
// Duas regras que pegam todo mundo de surpresa e por isso estão explícitas aqui:
// mandar template NÃO abre a janela — só a resposta do cliente abre — e o
// relógio conta da última mensagem recebida, não do início da conversa.
//
// Vale só para canal oficial: no Baileys não existe essa restrição.
//
// São TRÊS estados, e não um booleano, porque existe um caso em que a resposta
// honesta é "não sei": a mensagem mais recente do cliente está lá, mas a data
// dela não dá para interpretar. O booleano antigo ignorava essa mensagem em
// silêncio e caía numa inbound ANTERIOR — e com isso anunciava "fechada" com
// toda a confiança, sobre uma conta que nem era da última mensagem.
//
// A decisão final é sempre do canal. Isto aqui é conselho, não autoridade.
const WINDOW_MS = 24 * 60 * 60 * 1000;

export const JANELA_ABERTA = 'aberta';
export const JANELA_FECHADA = 'fechada';
export const JANELA_INDETERMINADA = 'indeterminada';

// null quando não dá para saber que instante é esse. Cuidado com dois casos que
// não são "valor falso": `new Date('lixo').getTime()` devolve NaN em vez de
// lançar, e `new Date(null)` devolve 1970 — uma data válida e absurda, que
// fecharia a janela de qualquer conversa.
function instanteDe(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const quando = new Date(valor).getTime();
  return Number.isFinite(quando) ? quando : null;
}

export function estadoDaJanela({ channelType, messages = [], now = new Date() }) {
  if (!isOfficialChannelType(channelType)) return JANELA_ABERTA;

  // Entre as inbounds com data legível vale a MAIS RECENTE pela data, não pela
  // posição — a lista pode chegar fora de ordem. Já a inbound ilegível não tem
  // data para comparar: a única pista de recência dela é a posição na lista,
  // que vem do backend em ordem cronológica.
  let ultimaValida = null;
  let posicaoDaValida = -1;
  let posicaoDaIlegivel = -1;

  messages.forEach((message, posicao) => {
    if (!message || message.direction !== 'inbound') return;
    const quando = instanteDe(message.createdAt);
    if (quando === null) {
      posicaoDaIlegivel = posicao;
      return;
    }
    if (ultimaValida === null || quando > ultimaValida) {
      ultimaValida = quando;
      posicaoDaValida = posicao;
    }
  });

  // Existe inbound mais recente que a última legível, e não dá para lê-la:
  // "não sei". Nunca cair caladamente numa inbound anterior — é daí que vinha
  // o "fechada" falso. Uma ilegível ANTERIOR à última legível não atrapalha:
  // a conta que interessa é a da mais recente, e essa nós temos.
  if (posicaoDaIlegivel > posicaoDaValida) return JANELA_INDETERMINADA;
  // Nenhuma mensagem do cliente: a janela nunca chegou a abrir. Isto é
  // diferente de "não sei" — aqui sabe-se, e a resposta é fechada.
  if (ultimaValida === null) return JANELA_FECHADA;
  return now.getTime() - ultimaValida >= WINDOW_MS ? JANELA_FECHADA : JANELA_ABERTA;
}
