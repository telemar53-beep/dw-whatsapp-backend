const Queue = require('bull');
const { loadConfig } = require('../config/env');

let queue;

function getMediaCompressionQueue() {
  if (!queue) {
    const config = loadConfig();
    queue = new Queue('media-compression', config.redisUrl);
  }
  return queue;
}

/**
 * Comprimir vídeo leva segundos a minutos — por isso ele sai do caminho do
 * webhook e vem para cá. O original já foi gravado e a mensagem já apareceu no
 * chat quando este job roda; se ele falhar, o vídeo original simplesmente fica.
 *
 * `attempts: 1` de propósito: um vídeo que o ffmpeg não conseguiu comprimir na
 * primeira não vai conseguir na segunda, e repetir só gastaria CPU.
 */
async function enqueueMediaCompression({ messageId }) {
  await getMediaCompressionQueue().add(
    { messageId },
    { attempts: 1, removeOnComplete: true, removeOnFail: true }
  );
}

function processMediaCompressionQueue(handler) {
  getMediaCompressionQueue().process(async (job) => handler(job.data));
}

async function closeMediaCompressionQueue() {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

module.exports = {
  getMediaCompressionQueue,
  enqueueMediaCompression,
  processMediaCompressionQueue,
  closeMediaCompressionQueue,
};
