const Queue = require('bull');
const { loadConfig } = require('../config/env');

let queue;

function getCampaignQueue() {
  if (!queue) {
    const config = loadConfig();
    queue = new Queue('campaign-messages', config.redisUrl, {
      limiter: { max: 20, duration: 60000 },
    });
  }
  return queue;
}

// Mesmo padrao das demais filas: o job concluido nao e lido por ninguem. O
// estado de cada destinatario vive em `campaign_recipients`, que o worker
// atualiza; manter o job no Redis so acumula copia do conteudo da campanha.
function enqueueCampaignRecipient(data) {
  return getCampaignQueue().add(data, { attempts: 1, removeOnComplete: true, removeOnFail: true });
}

function processCampaignQueue(handler) {
  getCampaignQueue().process(async (job) => handler(job.data));
}

async function closeCampaignQueue() {
  if (queue) {
    await queue.close();
    queue = undefined;
  }
}

module.exports = { getCampaignQueue, enqueueCampaignRecipient, processCampaignQueue, closeCampaignQueue };
