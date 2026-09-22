const { hasAdminLevelAccess } = require('../auth/auth.middleware');

/**
 * Resposta de conversa para a INTERFACE — e só para ela.
 *
 * A ADR-008 pede uma resposta específica para o frontend em vez de enriquecer
 * um objeto compartilhado. É o caso aqui: `getConversationWithContact` também
 * traz a nota interna, mas é chamada pela IA, pelo SGP e pelos workers, então
 * ela não é lugar de decidir quem enxerga o quê. Esta função fica no caminho
 * das rotas HTTP do atendente e em mais nenhum.
 *
 * A nota interna é dado administrativo: texto que a equipe escreve SOBRE o
 * cliente, e que o cliente nunca deveria ler. Quem recebe:
 *
 *   - quem tem acesso de nível administrativo (admin e gerente), que já vê
 *     qualquer conversa pelo painel;
 *   - o atendente responsável pela conversa.
 *
 * Quem não se encaixa recebe a conversa SEM a chave — não `null`, não string
 * vazia: a chave não existe no JSON. Assim ninguém confunde "não tenho acesso"
 * com "não há nota escrita".
 *
 * Protocolo e responsável não passam por esse filtro: são o que identifica o
 * atendimento, aparecem no cabeçalho e o cliente já os recebe por mensagem.
 */
function podeVerNotaInterna(conversation, agent) {
  if (!agent) return false;
  if (hasAdminLevelAccess(agent)) return true;
  return Boolean(conversation.assignedAgentId) && conversation.assignedAgentId === agent.agentId;
}

function apresentarConversa(conversation, agent) {
  if (!conversation) return conversation;
  if (podeVerNotaInterna(conversation, agent)) return conversation;
  const { contactInternalNote, ...semNota } = conversation;
  return semNota;
}

function apresentarConversas(conversations, agent) {
  return (conversations || []).map((c) => apresentarConversa(c, agent));
}

module.exports = { apresentarConversa, apresentarConversas, podeVerNotaInterna };
