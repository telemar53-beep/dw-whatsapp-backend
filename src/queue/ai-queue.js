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
 * Debounce por conversa: o jobId é o id da conversa, então três mensagens
 * seguidas do cliente viram uma resposta só. Um job que já começou a rodar não
 * pode ser removido — nesse caso agendamos outro ciclo mesmo assim, senão a
 * última mensagem ficaria sem resposta.
 */
async function enqueueAiReply({ conversationId }) {
  const q = getAiQueue();
  const pendente = await q.getJob(conversationId);
  if (pendente) {
    try {
      await pendente.remove();
    } catch (err) {
      // Já estava rodando; segue para agendar o próximo ciclo.
    }
  }
  await q.add(
    { conversationId },
    {
      jobId: conversationId,
      delay: AI_DEBOUNCE_MS,
      attempts: 1,
      removeOnComplete: true,
      // Bull ignora add() em silêncio quando já existe um job com o mesmo
      // jobId em QUALQUER estado, inclusive 'failed'. Como o jobId aqui é o
      // id da conversa, um job que falhasse ficaria parado no failed set
      // para sempre sob esse id, e toda mensagem seguinte dessa conversa
      // seria descartada sem erro nenhum em lugar nenhum. Não remova isto
      // achando redundante — é exatamente essa falha que ele evita.
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
