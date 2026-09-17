import { isOfficialChannelType } from './channelTypes';

// A janela de atendimento da Meta: fora das 24 horas contadas da última
// mensagem DO CLIENTE, só template aprovado é entregue (erro 131047).
//
// Duas regras que pegam todo mundo de surpresa e por isso estão explícitas aqui:
// mandar template NÃO abre a janela — só a resposta do cliente abre — e o
// relógio conta da última mensagem recebida, não do início da conversa.
//
// Vale só para canal oficial: no Baileys não existe essa restrição.
const WINDOW_MS = 24 * 60 * 60 * 1000;

export function isServiceWindowClosed({ channelType, messages = [], now = new Date() }) {
  if (!isOfficialChannelType(channelType)) return false;

  const ultimaDoCliente = messages.reduce((maisRecente, message) => {
    if (message.direction !== 'inbound') return maisRecente;
    const quando = new Date(message.createdAt).getTime();
    // Data ilegível é ignorada: virar "janela fechada" poria o aviso na tela do
    // atendente num canal que está funcionando.
    if (!Number.isFinite(quando)) return maisRecente;
    return quando > maisRecente ? quando : maisRecente;
  }, 0);

  if (!ultimaDoCliente) return true;
  return now.getTime() - ultimaDoCliente >= WINDOW_MS;
}
