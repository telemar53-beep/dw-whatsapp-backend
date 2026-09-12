const Queue = require('bull');
const { loadConfig } = require('../config/env');

const AI_DEBOUNCE_MS = 4000;

let queue;

function getAiQueue() {
  if (!queue) {
    const config = loadConfig();
    queue = new Queue('ai-replies', config.redisUrl);
  }
  return queue;
}

/**
 * Sem jobId fixo por conversa: cada mensagem gera seu próprio job, atrasado
 * AI_DEBOUNCE_MS. N mensagens em rajada produzem N jobs, mas o handler (em
 * ai-worker.js) confere se o messageId do job ainda é a última mensagem
 * inbound da conversa antes de gastar uma chamada à OpenAI — só o job da
 * mensagem mais recente faz trabalho de verdade; os anteriores saem baratos.
 *
 * Uma versão anterior usava jobId = conversationId, removendo o job pendente
 * antes de agendar o próximo (debounce "de verdade", via reset do timer). Foi
 * abandonada: o script addJob do Bull silencia add() sempre que já existe um
 * job com aquele id em QUALQUER estado, inclusive 'active'. Isso tornava a
 * mensagem chegada durante um turno de IA em andamento (a janela mais comum,
 * já que o turno leva segundos) incapaz de agendar um novo ciclo — o
 * "agendamos mesmo assim" virava um no-op silencioso, e a IA emudecia pra
 * aquele cliente sem erro nenhum. "A mensagem mais nova ganha" tem um modo de
 * falha visível (a IA responder duas vezes) em vez de invisível.
 */
async function enqueueAiReply({ conversationId, messageId }) {
  await getAiQueue().add(
    { conversationId, messageId },
    {
      delay: AI_DEBOUNCE_MS,
      attempts: 1,
      removeOnComplete: true,
      // Mantém a fila limpa mesmo sem jobId fixo: um job falho não deve
      // acumular no failed set indefinidamente.
      removeOnFail: true,
    }
  );
}

function processAiQueue(handler) {
  getAiQueue().process(async (job) => handler(job.data));
}

async function closeAiQueue() {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

module.exports = { getAiQueue, enqueueAiReply, processAiQueue, closeAiQueue, AI_DEBOUNCE_MS };
