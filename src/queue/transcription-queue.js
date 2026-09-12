const Queue = require('bull');
const { loadConfig } = require('../config/env');

let queue;

function getTranscriptionQueue() {
  if (!queue) {
    const config = loadConfig();
    queue = new Queue('audio-transcriptions', config.redisUrl);
  }
  return queue;
}

/**
 * Sem jobId customizado: cada áudio é um job independente, e dois áudios em
 * sequência devem ser transcritos os dois — diferente do turno de IA, onde só a
 * última mensagem interessa. Sem repetição automática: uma transcrição que falhou
 * fica registrada na própria mensagem, que é onde o atendente e o painel a procuram.
 */
async function enqueueTranscription({ conversationId, messageId }) {
  await getTranscriptionQueue().add(
    { conversationId, messageId },
    { attempts: 1, removeOnComplete: true, removeOnFail: true }
  );
}

function processTranscriptionQueue(handler) {
  getTranscriptionQueue().process(async (job) => handler(job.data));
}

async function closeTranscriptionQueue() {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

module.exports = {
  getTranscriptionQueue, enqueueTranscription, processTranscriptionQueue, closeTranscriptionQueue,
};
