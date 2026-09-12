const { processAiQueue } = require('./ai-queue');
const { runAiTurn } = require('../ai/ai-orchestrator');
const { createSuggestion } = require('../ai/ai-suggestion.repository');
const { getAiConfig } = require('../ai/ai-config.repository');
const { getConversationWithContact } = require('../conversations/conversation.repository');
const { findContactById } = require('../conversations/contact.repository');
const { emitToAgent } = require('../realtime/socket-server');
const { mensagemSegura } = require('../ai/safe-error-log');

async function handleAiJob({ conversationId }) {
  const conversation = await getConversationWithContact(conversationId);
  if (!conversation || conversation.status === 'closed' || conversation.status === 'silent') return;

  const config = await getAiConfig();
  if (!config || config.mode === 'disabled') return;

  // Assistente só faz sentido com atendente designado: é para ele que a sugestão vai.
  if (config.mode === 'assistant' && !conversation.assignedAgentId) return;
  // Automático para no instante em que um humano assume.
  if (config.mode === 'automatic' && conversation.assignedAgentId) return;

  const contact = await findContactById(conversation.contactId);
  if (!contact) return;

  const { texto } = await runAiTurn({ conversation, contact });
  if (!texto) return;

  if (config.mode === 'assistant') {
    const suggestion = await createSuggestion({ conversationId, messageId: null, content: texto });
    emitToAgent(conversation.assignedAgentId, 'ai:suggestion', { conversationId, suggestion });
    return;
  }

  // Modo automático entra na Fase 2; por ora o job termina sem enviar nada.
}

function startAiWorker() {
  processAiQueue(async (data) => {
    try {
      await handleAiJob(data);
    } catch (err) {
      console.error(`AI job failed for conversation ${data.conversationId}: ${mensagemSegura(err)}`);
    }
  });
}

module.exports = { startAiWorker, handleAiJob };
