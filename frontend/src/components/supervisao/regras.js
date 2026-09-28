// Regras da Supervisão sem React: filtros, busca única, ordem da Espera e o
// texto do tempo decorrido. Os significados dos filtros são os de antes.

// Valor sintético no filtro de Atendentes: a IA não é um agente, mas o admin
// precisa ver o que ela atendeu — encerrou sozinha (boleto/PIX entregue e
// cliente satisfeito), concluiu para uma fila, ou ainda está triando.
export const AI_AGENT_FILTER = 'ai';

export function isHandledByAi(conversation) {
  if (conversation.assignedAgentId) return false;
  return Boolean(
    conversation.aiTriageResolvedByAi
    || conversation.aiTriageCompletedAt
    || conversation.triageState === 'pending'
  );
}

export function correspondeAosFiltros(conversation, { channelIds, agentIds, sectorIds }) {
  if (channelIds.length > 0 && !channelIds.includes(conversation.channelId)) return false;
  if (agentIds.length > 0) {
    const porAgente = agentIds.includes(conversation.assignedAgentId);
    const porIa = agentIds.includes(AI_AGENT_FILTER) && isHandledByAi(conversation);
    if (!porAgente && !porIa) return false;
  }
  if (sectorIds.length > 0 && !sectorIds.includes(conversation.sectorId)) return false;
  return true;
}

const PROTOCOLO_DO_DIA = /^\d{8}-\d{4,}$/;
const PROTOCOLO_ANTIGO = /^\d{1,7}$/;
const SO_TELEFONE = /^[\d\s()+.-]+$/;

const semAcento = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const soDigitos = (texto) => String(texto || '').replace(/\D/g, '');

// O que o Enter da busca faz. Protocolo do dia (AAAAMMDD-XXXX) e protocolo
// antigo (só números, até 7) abrem o atendimento; telefone (8 dígitos ou mais)
// traz todos os atendimentos do cliente; nome só filtra a lista, sem Enter.
export function tipoDaBusca(texto) {
  const valor = String(texto || '').trim();
  if (!valor) return null;
  if (PROTOCOLO_DO_DIA.test(valor) || PROTOCOLO_ANTIGO.test(valor)) return 'protocolo';
  if (SO_TELEFONE.test(valor) && soDigitos(valor).length >= 8) return 'telefone';
  return 'nome';
}

// Filtro local enquanto se digita: nome (sem acento e sem caixa), protocolo e
// os dígitos do telefone. Devolve null quando não há busca — a lista inteira.
export function criarBusca(texto) {
  const valor = String(texto || '').trim();
  if (!valor) return null;
  const nome = semAcento(valor);
  const digitos = soDigitos(valor);
  return (conversation) => {
    if (semAcento(conversation.contactDisplayName).includes(nome)) return true;
    if (conversation.protocolNumber != null && String(conversation.protocolNumber).includes(valor)) return true;
    return digitos.length >= 3 && soDigitos(conversation.contactPhoneNumber).includes(digitos);
  };
}

const instante = (iso) => (iso ? new Date(iso).getTime() : Number.NaN);

// Espera: quem espera há mais tempo vem primeiro (chegada mais antiga).
export function ordenarEspera(conversas) {
  return [...conversas].sort((a, b) => {
    const ta = instante(a.createdAt);
    const tb = instante(b.createdAt);
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb;
  });
}

// De onde a linha conta o tempo: na Espera, desde a chegada; nas outras, desde
// a última mensagem. Sem SLA inventado — o número é só o que passou.
export function inicioDoTempo(conversation) {
  if (conversation.status === 'waiting' && conversation.triageState !== 'pending') return conversation.createdAt || conversation.lastMessageAt;
  return conversation.lastMessageAt || conversation.createdAt;
}

export function textoDoTempo(desdeIso, agora) {
  const desde = instante(desdeIso);
  if (Number.isNaN(desde)) return '';
  const minutos = Math.max(0, Math.floor((agora - desde) / 60000));
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) {
    const resto = minutos % 60;
    return resto ? `${horas} h ${resto} min` : `${horas} h`;
  }
  return `${Math.floor(horas / 24)} d`;
}

// Encerrados: a hora do encerramento, com "ontem" quando passou da meia-noite
// (a janela é de 24 h, não "hoje").
export function horaDoEncerramento(iso, agora) {
  const quando = instante(iso);
  if (Number.isNaN(quando)) return '';
  const data = new Date(quando);
  const hoje = new Date(agora);
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return data.toDateString() === hoje.toDateString() ? hora : `ontem ${hora}`;
}
